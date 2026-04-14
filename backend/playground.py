"""Playground: run individual agent operations with live data, returning rich structured results."""

import asyncio
import logging
import random
import re
import time
import uuid

import asyncpg
import httpx

import db
from config import AgentConfig, config_from_db
from llm_queue import queue_chat
from moltbook_client import MoltbookClient

logger = logging.getLogger(__name__)


# ── Async task store ─────────────────────────────────────────────────────────

_tasks: dict[str, dict] = {}
MAX_TASKS = 50  # ring buffer — evict oldest when full


def create_task(action: str, slot: int) -> str:
    task_id = f"pg-{uuid.uuid4().hex[:12]}"
    _tasks[task_id] = {
        "id": task_id,
        "action": action,
        "slot": slot,
        "status": "running",
        "progress": "Starting...",
        "result": None,
        "error": None,
        "created_at": time.time(),
    }
    # Evict oldest if over limit
    if len(_tasks) > MAX_TASKS:
        oldest = min(_tasks, key=lambda k: _tasks[k]["created_at"])
        del _tasks[oldest]
    return task_id


def get_task(task_id: str) -> dict | None:
    return _tasks.get(task_id)


def update_progress(task_id: str, msg: str):
    if task_id in _tasks:
        _tasks[task_id]["progress"] = msg


def complete_task(task_id: str, result: dict):
    if task_id in _tasks:
        _tasks[task_id]["status"] = "completed"
        _tasks[task_id]["result"] = result
        _tasks[task_id]["progress"] = "Done"


def fail_task(task_id: str, error: str):
    if task_id in _tasks:
        _tasks[task_id]["status"] = "failed"
        _tasks[task_id]["error"] = error
        _tasks[task_id]["progress"] = f"Failed: {error}"


class PlaygroundRunner:
    """Runs agent operations without starting the agent loop.
    Uses the agent's real API key for Moltbook reads, real LLM for generation,
    but does NOT write to Moltbook unless explicitly asked (live methods)."""

    def __init__(self, config: AgentConfig, pool: asyncpg.Pool, llm_base: str, llm_api_key: str,
                 common_md_override: str | None = None):
        self.config = config
        self.slot = config.slot
        self.pool = pool
        self.llm_base = llm_base
        self.llm_api_key = llm_api_key
        self.client = MoltbookClient(config.api_key)
        self._common_md_override = common_md_override

    def _progress(self, task_id: str | None, msg: str):
        if task_id:
            update_progress(task_id, msg)

    async def _get_common_md(self) -> str:
        if self._common_md_override is not None:
            return self._common_md_override
        return await db.get_global_config(self.pool, "common_md") or ""

    def _build_base_system_prompt(self) -> str:
        p = self.config.persona
        soul = self.config.soul_md or ''
        tone_line = f"Tone: {p.tone}\n" if (p.tone and not soul) else ""
        base = (
            f"You are {p.name} on Moltbook, a social network for AI agents.\n"
            f"Description: {p.description}\n"
            f"{tone_line}"
            f"Topics: {', '.join(p.topics)}\n\n"
            "Be genuine, concise, and thoughtful. Don't be sycophantic or robotic. "
            "Write like a real community member who actually has opinions."
        )
        if soul:
            base += f"\n\n--- Soul ---\n{soul}"
        rules = self.config.rules_md or ''
        if rules:
            base += f"\n\n--- Rules ---\n{rules}"
        memory = self.config.memory_md or ''
        if memory:
            base += f"\n\n--- Memory ---\n{memory}"
        return base

    async def _llm(self, prompt: str, system: str | None = None) -> str:
        if system is None:
            system = self._build_base_system_prompt()
        common = await self._get_common_md()
        if common:
            system = f"--- Common Instructions ---\n{common}\n\n{system}"
        model = self.config.model
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ]
        try:
            max_retries = 3
            for attempt in range(max_retries):
                result = await queue_chat(
                    self.llm_base, self.llm_api_key, model,
                    messages=messages,
                    metadata={"source": "ecdysis-playground", "slot": self.slot},
                )
                content = result["choices"][0]["message"]["content"].strip()
                if "<think>" in content:
                    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
                if content:
                    break
                logger.info("[playground-%d] Think-only response (attempt %d/%d), retrying",
                            self.slot, attempt + 1, max_retries)
            return content
        except TimeoutError:
            logger.warning("Playground LLM queue timeout slot %d", self.slot)
            return ""
        except Exception as e:
            logger.error("Playground LLM error slot %d: %s", self.slot, e)
            return ""

    async def browse(self, task_id: str | None = None) -> dict:
        """Fetch live feed and determine what the agent would upvote/comment on.
        Uses a single batched LLM call for comment decisions instead of one per post."""
        self._progress(task_id, "Fetching feed...")
        feed = await self.client.feed(sort="new", limit=15)
        own_name = self.config.persona.name
        beh = self.config.behavior

        # Load peer names
        all_configs = await db.get_all_moltbook_configs(self.pool)
        peer_names = set(
            c["name"] for c in all_configs
            if c["registered"] and c["name"] != own_name
        )

        # Build candidate list (filter own posts, short posts)
        candidates = []
        for post in feed.get("posts", []):
            pid = post.get("id")
            if not pid:
                continue
            author = post.get("author", {}).get("name", "")
            if author == own_name:
                continue
            candidates.append(post)

        self._progress(task_id, f"Evaluating {len(candidates)} posts...")

        # Batch comment decision: one LLM call for all posts
        comment_worthy: set[int] = set()
        commentable = [
            (i, p) for i, p in enumerate(candidates)
            if len(p.get("content", "")) > 50
        ]
        if commentable:
            numbered = "\n\n".join(
                f'{i+1}. "{p.get("title")}" by {p.get("author", {}).get("name", "?")}:\n'
                f'{p.get("content", "")[:200]}'
                for i, (_, p) in enumerate(commentable)
            )
            batch_decision = await self._llm(
                f"Here are {len(commentable)} posts from your feed. "
                f"List ONLY the numbers of posts you'd comment on (interesting, "
                f"thought-provoking, or relevant to your topics). "
                f"Reply with just the numbers separated by commas, or NONE.\n\n{numbered}",
            )
            # Parse numbers from response
            for num_str in re.findall(r'\d+', batch_decision):
                idx = int(num_str) - 1
                if 0 <= idx < len(commentable):
                    comment_worthy.add(commentable[idx][0])

        # Generate comments only for selected posts (typically 0-3)
        if comment_worthy:
            self._progress(task_id, f"Generating {len(comment_worthy)} comment(s)...")
        generated_comments: dict[int, str] = {}
        for ci in comment_worthy:
            post = candidates[ci]
            comment = await self._llm(
                f'Write one thoughtful comment on this post (1-2 sentences):\n'
                f'"{post.get("title")}"\n{post.get("content", "")[:500]}',
            )
            if comment:
                generated_comments[ci] = comment

        # Build results
        results = []
        for i, post in enumerate(candidates):
            author = post.get("author", {}).get("name", "")
            is_peer = author in peer_names
            would_upvote = (beh.auto_like and not is_peer) or (is_peer and beh.send_peer_likes)
            upvote_reason = ""
            if would_upvote:
                upvote_reason = "peer agent (send_peer_likes)" if is_peer else "auto_like enabled"

            results.append({
                "id": post.get("id"),
                "title": post.get("title", ""),
                "content": post.get("content", ""),
                "author": author,
                "submolt": post.get("submolt", {}).get("name", "") if isinstance(post.get("submolt"), dict) else post.get("submolt_name", ""),
                "upvotes": post.get("upvotes", 0),
                "comment_count": post.get("comment_count", 0),
                "would_upvote": would_upvote,
                "upvote_reason": upvote_reason,
                "would_comment": i in comment_worthy,
                "generated_comment": generated_comments.get(i, ""),
            })

        return {"posts": results}

    async def generate_post(self, task_id: str | None = None) -> dict:
        """Generate a post the agent would create, without posting it."""
        beh = self.config.behavior
        topics = self.config.persona.topics
        max_len = beh.max_post_length

        self._progress(task_id, "Choosing submolt...")
        # Choose submolt
        submolt = None
        submolt_reason = ""
        if beh.target_submolts and random.random() < 0.7:
            submolt = random.choice(beh.target_submolts)
            submolt_reason = "from target list"
        if not submolt:
            try:
                all_submolts = await self.client.list_submolts()
                names = [s["name"] for s in all_submolts]
                excludes = set(beh.exclude_submolts) | set(beh.target_submolts)
                candidates = [n for n in names if n not in excludes]
                if candidates:
                    topics_lower = {t.lower() for t in topics}
                    matched = [n for n in candidates if n.lower() in topics_lower]
                    submolt = random.choice(matched) if matched else random.choice(candidates)
                    submolt_reason = "discovered (topic match)" if matched else "discovered"
                elif beh.target_submolts:
                    submolt = random.choice(beh.target_submolts)
                    submolt_reason = "fallback to target list"
                else:
                    return {"error": "No submolts available"}
            except Exception as e:
                if beh.target_submolts:
                    submolt = random.choice(beh.target_submolts)
                    submolt_reason = "fallback (API error)"
                else:
                    return {"error": f"Could not discover submolts: {e}"}

        # Gather recent titles to avoid repetition
        past_activity = await db.read_moltbook_activity(self.pool, self.slot, n=200)
        recent_titles = []
        for entry in past_activity:
            if entry["action"] == "posted":
                detail = entry.get("detail", "")
                if "'" in detail:
                    start = detail.index("'") + 1
                    rest = detail[start:]
                    if "'" in rest:
                        title_text = rest[:rest.index("'")]
                        if title_text:
                            recent_titles.append(title_text)
            if len(recent_titles) >= 20:
                break

        avoid_text = ""
        if recent_titles:
            titles_list = "\n".join(f"- {t}" for t in recent_titles)
            avoid_text = (
                f"\n\nYou have already posted about these topics recently — "
                f"do NOT repeat or rephrase any of them. Write about something fresh:\n{titles_list}"
            )

        # Build post-specific system prompt (without memory, matching agent_runner)
        p = self.config.persona
        soul = self.config.soul_md or ''
        tone_line = f"Tone: {p.tone}\n" if (p.tone and not soul) else ""
        post_system = (
            f"You are {p.name} on Moltbook, a social network for AI agents.\n"
            f"Description: {p.description}\n"
            f"{tone_line}"
            f"Topics: {', '.join(p.topics)}\n\n"
            "Be genuine, concise, and thoughtful. Don't be sycophantic or robotic. "
            "Write like a real community member who actually has opinions."
        )
        if soul:
            post_system += f"\n\n--- Soul ---\n{soul}"
        rules = self.config.rules_md or ''
        if rules:
            post_system += f"\n\n--- Rules ---\n{rules}"

        prompt = (
            f"Choose one topic from {topics} and write a genuine post.\n\n"
            f"You MUST use this exact format:\n"
            f"TITLE: Your title here\n"
            f"BODY: Your post content here\n\n"
            f"Max {max_len} chars total. No hashtags. No markdown.{avoid_text}"
        )

        self._progress(task_id, "Generating post...")
        title = ""
        body = ""
        for attempt in range(2):
            p_text = prompt
            if attempt > 0:
                p_text += (
                    "\n\nYour previous attempt was rejected. Make sure you use the exact format "
                    "TITLE: on one line, then BODY: on the next. The title must be a short "
                    f"headline (3-15 words), not a bullet point or paragraph. "
                    f"Keep the body under {max_len} characters."
                )
            content = await self._llm(p_text, system=post_system)
            if not content:
                return {"error": "LLM returned empty content"}

            title_match = re.search(r"^TITLE:\s*(.+)", content, re.MULTILINE)
            body_match = re.search(r"^BODY:\s*([\s\S]+)", content, re.MULTILINE)
            if title_match and body_match:
                title = title_match.group(1).strip()
                body = body_match.group(1).strip()
            else:
                lines = content.strip().splitlines()
                title = lines[0].strip()
                body = "\n".join(lines[1:]).strip()

            title = re.sub(r"^\*{1,2}(.*?)\*{1,2}$", r"\1", title)
            title = re.sub(r"^(Title|Subject)\s*:\s*", "", title, flags=re.IGNORECASE)
            title = title.lstrip("#").strip()
            title = re.sub(r"#\w+", "", title).strip()
            title = title[:200]

            if title and body and len(title.split()) >= 2:
                if not title.startswith("- ") and not title.startswith("* "):
                    break

        if not title or not body:
            return {"error": "LLM failed to generate valid post after retries"}

        if len(body) > max_len:
            shortened = await self._llm(
                f"This post body is {len(body)} chars but the limit is {max_len}. "
                f"Rewrite it shorter while keeping the same point. Return ONLY the shortened body.\n\n{body}",
                system=post_system,
            )
            if shortened and len(shortened) <= max_len:
                body = shortened
            else:
                truncated = body[:max_len]
                last_period = truncated.rfind('.')
                body = truncated[:last_period + 1] if last_period > max_len // 2 else truncated

        return {
            "submolt": submolt,
            "title": title,
            "content": body,
            "submolt_selection_reason": submolt_reason,
        }

    async def generate_comments(self, task_id: str | None = None) -> dict:
        """Find posts the agent would comment on and generate comments.
        Uses the same batched approach as browse — one LLM call for decisions."""
        self._progress(task_id, "Fetching feed...")
        feed = await self.client.feed(sort="new", limit=15)
        own_name = self.config.persona.name

        # Filter to commentable posts
        commentable = []
        for post in feed.get("posts", []):
            pid = post.get("id")
            if not pid:
                continue
            author = post.get("author", {}).get("name", "")
            if author == own_name:
                continue
            if len(post.get("content", "")) <= 50:
                continue
            commentable.append(post)

        if not commentable:
            return {"comments": []}

        # Batch decision
        self._progress(task_id, f"Evaluating {len(commentable)} posts...")
        numbered = "\n\n".join(
            f'{i+1}. "{p.get("title")}" by {p.get("author", {}).get("name", "?")}:\n'
            f'{p.get("content", "")[:200]}'
            for i, p in enumerate(commentable)
        )
        batch_decision = await self._llm(
            f"Here are {len(commentable)} posts. List ONLY the numbers of posts "
            f"you'd comment on (interesting, thought-provoking, relevant). "
            f"Reply with just the numbers separated by commas, or NONE.\n\n{numbered}",
        )

        selected: list[int] = []
        for num_str in re.findall(r'\d+', batch_decision):
            idx = int(num_str) - 1
            if 0 <= idx < len(commentable):
                selected.append(idx)

        # Generate comments for selected posts
        if selected:
            self._progress(task_id, f"Generating {len(selected)} comment(s)...")
        comments = []
        for idx in selected:
            post = commentable[idx]
            generated = await self._llm(
                f'Write one thoughtful comment on this post (1-2 sentences):\n'
                f'"{post.get("title")}"\n{post.get("content", "")[:500]}',
            )
            if not generated:
                continue

            submolt = ""
            if isinstance(post.get("submolt"), dict):
                submolt = post["submolt"].get("name", "")
            else:
                submolt = post.get("submolt_name", "")

            comments.append({
                "post_id": post.get("id"),
                "post_title": post.get("title", ""),
                "post_content": post.get("content", ""),
                "post_author": post.get("author", {}).get("name", ""),
                "post_submolt": submolt,
                "generated_comment": generated,
                "parent_comment": None,
            })

        return {"comments": comments}

    async def post_live(self, submolt: str, title: str, content: str) -> dict:
        """Actually create a post on Moltbook."""
        try:
            result = await self._post_with_challenge(
                self.client.create_post, submolt, title, content
            )
            await db.append_moltbook_activity(self.pool, self.slot, "manual_post", f"Playground post: '{title}' → m/{submolt}")
            await db.record_post(self.pool, self.slot, title)
            return {"ok": True, "result": result}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def comment_live(self, post_id: str, content: str, parent_id: str | None = None) -> dict:
        """Actually create a comment on Moltbook."""
        try:
            result = await self._post_with_challenge(
                self.client.create_comment, post_id, content, parent_id=parent_id
            )
            await db.append_moltbook_activity(self.pool, self.slot, "commented", f"Playground comment on {post_id}: {content[:100]}")
            return {"ok": True, "result": result}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def _solve_challenge(self, problem: str) -> str:
        answer = await self._llm(
            f"Solve this math problem. Return ONLY the numeric answer:\n{problem}",
            system="You are a precise math solver. Return only the number.",
        )
        nums = re.findall(r"\d+", answer)
        return nums[0] if nums else "0"

    async def _post_with_challenge(self, fn, *args, **kwargs) -> dict:
        try:
            result = await fn(*args, **kwargs)
            if isinstance(result, dict) and result.get("verification"):
                ch = result["verification"]
                kwargs["challenge_answer"] = {
                    "id": ch["id"],
                    "answer": await self._solve_challenge(ch.get("problem", "")),
                }
                result = await fn(*args, **kwargs)
            return result
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 422:
                try:
                    body = e.response.json()
                    if "verification" in body:
                        ch = body["verification"]
                        kwargs["challenge_answer"] = {
                            "id": ch["id"],
                            "answer": await self._solve_challenge(ch.get("problem", "")),
                        }
                        return await fn(*args, **kwargs)
                except Exception:
                    pass
            raise
