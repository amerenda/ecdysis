"""Runs a single Moltbook agent as an asyncio task. Extracted from original main.py."""
import asyncio
import logging
import random
import re
import time
from datetime import datetime, timezone

import asyncpg
import httpx

import db
from config import (
    AgentConfig, AgentState, PeerDatabase, PeerPost,
    config_from_db, state_from_db,
)
from moltbook_client import MoltbookClient

logger = logging.getLogger(__name__)

DEFAULT_HEARTBEAT_INTERVAL = 30 * 60  # 30 min fallback


class AgentRunner:
    def __init__(
        self,
        config: AgentConfig,
        pool: asyncpg.Pool,
        llm_base: str,
        llm_api_key: str,
        lock_conn: asyncpg.Connection | None = None,
        heartbeat_gate: asyncio.Lock | None = None,
    ):
        self.config = config
        self.slot = config.slot
        self.pool = pool
        self.llm_base = llm_base
        self.llm_api_key = llm_api_key
        self.client = MoltbookClient(config.api_key)
        # State is loaded lazily on first heartbeat
        self.state: AgentState = AgentState(slot=self.slot)
        self._task: asyncio.Task | None = None
        self.running = False
        self._heartbeat_lock = asyncio.Lock()
        self._heartbeat_gate = heartbeat_gate or asyncio.Lock()
        self._lock_conn = lock_conn

    async def log(self, action: str, detail: str):
        await db.append_moltbook_activity(self.pool, self.slot, action, detail)
        logger.info("[agent-%d] [%s] %s", self.slot, action, detail)

    async def _llm(self, prompt: str, system: str | None = None) -> str:
        p = self.config.persona
        soul = getattr(self.config, 'soul_md', '') or ''
        # If SOUL.md is set, it replaces tone entirely
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
        # RULES.md — guardrails
        rules = getattr(self.config, 'rules_md', '') or ''
        if rules:
            base += f"\n\n--- Rules ---\n{rules}"
        # MEMORY.md — persistent context from past interactions
        memory = getattr(self.config, 'memory_md', '') or ''
        if memory:
            base += f"\n\n--- Memory ---\n{memory}"
        sys_prompt = system or base
        model = self.config.model
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10, read=120)) as http:
                r = await http.post(
                    f"{self.llm_base}/v1/chat/completions",
                    headers={"Authorization": f"Bearer {self.llm_api_key}"},
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": sys_prompt},
                            {"role": "user", "content": prompt},
                        ],
                        "stream": False,
                    },
                )
                r.raise_for_status()
                content = r.json()["choices"][0]["message"]["content"].strip()
                # Strip deepseek-r1 thinking tags if present
                if "<think>" in content:
                    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
                return content
        except httpx.ReadTimeout:
            logger.warning("LLM timeout slot %d (model=%s, prompt=%d chars)", self.slot, model, len(prompt))
            return ""
        except Exception as e:
            logger.error("LLM error slot %d: %s (%s)", self.slot, type(e).__name__, e)
            return ""

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

    async def _load_state(self) -> None:
        """Load state from DB into self.state."""
        row = await db.get_moltbook_state(self.pool, self.slot)
        self.state = state_from_db(row)

    async def _save_state(self) -> None:
        """Persist self.state to DB."""
        # Ensure last_heartbeat is a datetime for asyncpg TIMESTAMPTZ column
        hb = self.state.last_heartbeat
        if isinstance(hb, str):
            hb = datetime.fromisoformat(hb)
        await db.upsert_moltbook_state(
            self.pool,
            self.slot,
            karma=self.state.karma,
            last_heartbeat=hb,
            last_post_time=self.state.last_post_time,
            next_post_time=self.state.next_post_time,
            pending_dm_requests=self.state.pending_dm_requests,
        )

    async def _load_peer_db(self) -> PeerDatabase:
        """Build PeerDatabase from DB tables."""
        raw_posts = await db.get_peer_posts(self.pool, self.slot)
        liked_ids = await db.get_interacted_post_ids(self.pool, self.slot, "liked")
        commented_ids = await db.get_interacted_post_ids(self.pool, self.slot, "commented")

        peers: dict[str, list[PeerPost]] = {}
        for peer_name, posts in raw_posts.items():
            peers[peer_name] = [
                PeerPost(
                    post_id=p["post_id"],
                    title=p["title"],
                    content_preview=p["content_preview"],
                    seen_at=(
                        p["seen_at"].isoformat()
                        if not isinstance(p["seen_at"], str)
                        else p["seen_at"]
                    ),
                )
                for p in posts
            ]

        return PeerDatabase(
            slot=self.slot,
            peers=peers,
            liked_post_ids=liked_ids,
            commented_post_ids=commented_ids,
        )

    async def _save_peer_db(self, peer_db: PeerDatabase) -> None:
        """Persist peer posts and interactions to DB."""
        for peer_name, posts in peer_db.peers.items():
            for pp in posts:
                await db.upsert_peer_post(
                    self.pool,
                    self.slot,
                    peer_name,
                    pp.post_id,
                    pp.title,
                    pp.content_preview,
                )

        # Prune to keep_per_peer=20
        await db.prune_peer_posts(self.pool, self.slot, keep_per_peer=20)

        # Interactions are recorded in place during operations — nothing extra to flush here

    async def run_heartbeat(self):
        if self._heartbeat_lock.locked():
            logger.info("[agent-%d] Heartbeat already in progress, skipping", self.slot)
            return
        async with self._heartbeat_lock:
            if self._heartbeat_gate.locked():
                await self.log("heartbeat", "Queued — waiting for another agent")
            async with self._heartbeat_gate:
                await self._run_heartbeat_inner()

    async def _run_heartbeat_inner(self):
        # Load fresh state from DB each heartbeat
        await self._load_state()
        hb_md = getattr(self.config, 'heartbeat_md', '') or ''
        detail = "Starting"
        if hb_md:
            detail += f" (heartbeat.md: {len(hb_md)} chars)"
        await self.log("heartbeat", detail)
        try:
            # Auto-detect claim status from Moltbook if not claimed locally
            if not self.config.claimed:
                try:
                    status = await self.client.status()
                    if status.get("status") == "claimed":
                        await db.upsert_moltbook_config(self.pool, self.slot, claimed=True)
                        self.config.claimed = True
                        await self.log("heartbeat", "Agent claimed on Moltbook — updated local status")
                except Exception:
                    pass  # Non-critical, will retry next heartbeat

            home = await self.client.home()
            self.state.karma = home.get("your_account", {}).get("karma", self.state.karma)
            self.state.last_heartbeat = datetime.now(timezone.utc)
            await self._save_state()

            if self.config.behavior.auto_reply:
                reply_budget = [self.config.behavior.max_replies_per_heartbeat]
                for activity in home.get("activity_on_your_posts", []):
                    if reply_budget[0] <= 0:
                        break
                    await self._handle_post_activity(activity, reply_budget)

            dm_data = await self.client.dm_check()
            if dm_data.get("has_activity"):
                await self._handle_dms(dm_data)

            await self._browse_and_engage()
            if self.config.behavior.reply_to_own_threads:
                await self._reply_to_own_threads()
            await self._maybe_post_new()

            # Passive: keep peer database updated from feed observations
            await self._update_peer_db()

            # Update memory with what happened this heartbeat
            await self._update_memory()

            await self.log("heartbeat", f"Done — karma: {self.state.karma}")
        except httpx.HTTPStatusError as e:
            body = e.response.text[:300] if e.response else ""
            detail = f"{e.response.status_code} {e.response.reason_phrase} on {e.request.url.path} — {body}"
            logger.error("Heartbeat error slot %d: %s", self.slot, detail)
            await self.log("error", detail)
        except Exception as e:
            detail = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
            logger.error("Heartbeat error slot %d: %s", self.slot, detail)
            await self.log("error", detail)

    async def _update_memory(self):
        """Append a short summary of this heartbeat to MEMORY.md."""
        try:
            # Get recent activity to summarize
            recent = await db.read_moltbook_activity(self.pool, self.slot, 10)
            if not recent:
                return
            actions = [f"{a['action']}: {a['detail'][:80]}" for a in recent[:5]]
            actions_text = "\n".join(actions)

            summary = await self._llm(
                f"Based on these recent actions, write 1-2 sentences of what you should remember "
                f"for next time. Be concise — just key facts, not a narrative.\n\n{actions_text}",
            )
            if not summary or len(summary) < 5:
                return

            current = getattr(self.config, 'memory_md', '') or ''
            timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
            entry = f"\n- [{timestamp}] {summary.strip()}"
            updated = current + entry

            # Cap at 2000 chars — trim oldest entries (lines) if over
            if len(updated) > 2000:
                lines = updated.split('\n')
                while len('\n'.join(lines)) > 2000 and len(lines) > 3:
                    # Remove the oldest non-header line
                    for i, line in enumerate(lines):
                        if line.startswith('- ['):
                            lines.pop(i)
                            break
                    else:
                        break
                updated = '\n'.join(lines)

            await db.upsert_moltbook_config(self.pool, self.slot, memory_md=updated)
            self.config.memory_md = updated
        except Exception as e:
            logger.warning("Memory update failed slot %d: %s", self.slot, e)

    async def compact_memory(self):
        """Ask the LLM to summarize and condense the full memory into key facts."""
        current = getattr(self.config, 'memory_md', '') or ''
        if not current or len(current) < 100:
            return current  # Nothing to compact

        compacted = await self._llm(
            f"Summarize this agent memory into the most important facts and context. "
            f"Keep it under 800 chars. Use bullet points. Preserve key relationships, "
            f"preferences, and notable events. Drop routine details.\n\n{current}",
        )
        if not compacted or len(compacted) < 10:
            return current  # LLM failed, keep original

        header = "# Memory (compacted)\n\n"
        result = header + compacted.strip()
        await db.upsert_moltbook_config(self.pool, self.slot, memory_md=result)
        self.config.memory_md = result
        await self.log("memory", f"Compacted memory: {len(current)} → {len(result)} chars")
        return result

    async def _handle_post_activity(self, activity: dict, heartbeat_reply_budget: list[int]):
        """Handle replies to a post. heartbeat_reply_budget is a mutable [remaining] counter."""
        post_id = activity.get("post_id") or activity.get("id")
        if not post_id or heartbeat_reply_budget[0] <= 0:
            return
        max_per_post = self.config.behavior.max_comments_per_post
        try:
            # Use activity log to track replies — Moltbook API doesn't return nested comments
            past_activity = await db.read_moltbook_activity(self.pool, self.slot, n=200)
            reply_count = sum(
                1 for e in past_activity
                if e["action"] == "replied" and post_id in e.get("detail", "")
            )
            if reply_count >= max_per_post:
                await self.client.mark_notifications_read(post_id)
                if self.config.behavior.log_skipped:
                    await self.log("skipped_reply", f"Already replied {reply_count}/{max_per_post} times to {post_id}")
                return

            # Find last time we replied to this post
            last_reply_ts = None
            for e in past_activity:
                if e["action"] == "replied" and post_id in e.get("detail", ""):
                    last_reply_ts = e["created_at"]
                    break

            data = await self.client.get_comments(post_id, sort="new", limit=35)
            own_name = self.config.persona.name
            comments = data.get("comments", [])

            # Collect new comments worth considering
            candidates = []
            for comment in comments[:10]:
                author = comment.get("author", {}).get("name", "someone")
                if author == own_name:
                    continue
                # Skip comments that existed before our last reply
                comment_ts = comment.get("created_at", "")
                if last_reply_ts and comment_ts <= str(last_reply_ts):
                    continue
                content = comment.get("content", "")
                if content:
                    candidates.append((author, content, comment.get("id")))

            if not candidates:
                await self.client.mark_notifications_read(post_id)
                return

            # Let the LLM pick which comment is most worth replying to
            if len(candidates) > 1:
                options = "\n".join(f"{i+1}. {a}: \"{c[:100]}\"" for i, (a, c, _) in enumerate(candidates))
                pick = await self._llm(
                    f"These people replied to your post. Pick the ONE most interesting "
                    f"to reply to. Just respond with the number.\n\n{options}"
                )
                try:
                    idx = int(pick.strip().rstrip(".")) - 1
                    if 0 <= idx < len(candidates):
                        candidates = [candidates[idx]]
                    else:
                        candidates = [candidates[0]]
                except (ValueError, IndexError):
                    candidates = [candidates[0]]

            replied = 0
            for author, content, comment_id in candidates[:1]:
                reply = await self._llm(
                    f'{author} replied to your post:\n"{content}"\n\n'
                    "Write a thoughtful reply (1-3 sentences). No filler.",
                )
                if reply:
                    await self._post_with_challenge(
                        self.client.create_comment, post_id, reply,
                        parent_id=comment_id,
                    )
                    replied += 1
                    heartbeat_reply_budget[0] -= 1
                    await asyncio.sleep(25)
                elif self.config.behavior.log_skipped:
                    await self.log("skipped_reply", f"LLM returned empty reply to {author} on {post_id}")
            await self.client.mark_notifications_read(post_id)
            if replied:
                await self.log("replied", f"Replied to {replied} comment on {post_id}")
        except Exception as e:
            logger.error("Post activity error: %s", e)

    async def _handle_dms(self, dm_data: dict):
        for req in dm_data.get("requests", {}).get("items", []):
            requester = req.get("from", {}).get("name", "unknown")
            preview = req.get("message_preview", "")
            cid = req["conversation_id"]
            if self.config.behavior.auto_dm_approve:
                try:
                    await self.client.dm_approve(cid)
                    await self.log("dm_approved", f"Auto-approved DM from {requester}: '{preview}'")
                except Exception as e:
                    logger.error("Auto DM approve error: %s", e)
            else:
                await self.log("dm_request_pending", f"DM from {requester}: '{preview}'")
                if cid not in self.state.pending_dm_requests:
                    self.state.pending_dm_requests.append(cid)
        await self._save_state()

    async def _browse_and_engage(self):
        try:
            feed = await self.client.feed(sort="new", limit=15)
            own_name = self.config.persona.name
            upvoted = commented = 0
            peer_upvoted = 0
            peer_db = await self._load_peer_db()
            # Peers = other registered agents on this ecdysis instance
            all_configs = await db.get_all_moltbook_configs(self.pool)
            peer_names = set(
                c["name"] for c in all_configs
                if c["registered"] and c["name"] != own_name
            )
            for post in feed.get("posts", []):
                pid = post.get("id")
                if not pid:
                    continue
                post_author = post.get("author", {}).get("name", "")
                if post_author == own_name:
                    continue  # never upvote or comment on own posts
                is_peer = post_author in peer_names
                # Upvote if auto_like is enabled (or peer likes for peers)
                should_like = (self.config.behavior.auto_like and not is_peer) or (is_peer and self.config.behavior.send_peer_likes)
                if should_like and pid not in peer_db.liked_post_ids:
                    try:
                        await self.client.upvote_post(pid)
                        upvoted += 1
                        if is_peer:
                            peer_upvoted += 1
                    except Exception:
                        pass
                if commented < 2 and len(post.get("content", "")) > 50:
                    decision = await self._llm(
                        f'Post "{post.get("title")}" by {post.get("author", {}).get("name")}:\n'
                        f'{post.get("content", "")[:300]}\n\nComment? YES or NO.',
                    )
                    if decision.upper().startswith("YES"):
                        comment = await self._llm(
                            f'Write one thoughtful comment on this post (1-2 sentences):\n'
                            f'"{post.get("title")}"\n{post.get("content", "")[:500]}',
                        )
                        if comment:
                            try:
                                await self._post_with_challenge(self.client.create_comment, pid, comment)
                                commented += 1
                                await asyncio.sleep(25)
                            except Exception:
                                pass
                        elif self.config.behavior.log_skipped:
                            await self.log("skipped_comment", f"LLM returned empty comment on {pid}")
            if upvoted or commented:
                parts = [f"Upvoted {upvoted}"]
                if peer_upvoted:
                    parts[0] += f" ({peer_upvoted} peer{'s' if peer_upvoted != 1 else ''})"
                parts.append(f"commented {commented}")
                await self.log("browsed", ", ".join(parts))
        except Exception as e:
            logger.error("Browse error: %s", e)

    async def _reply_to_own_threads(self):
        """Continue agent's own recent posts as threads (max 1 per heartbeat)."""
        try:
            feed = await self.client.feed(sort="new", limit=30)
            own_name = self.config.persona.name
            own_posts = [
                p for p in feed.get("posts", [])
                if p.get("author", {}).get("name") == own_name
            ][:3]

            for post in own_posts:
                pid = post.get("id")
                if not pid:
                    continue
                # Check how many times we've replied to this post (from activity log)
                past_activity = await db.read_moltbook_activity(self.pool, self.slot, n=200)
                thread_count = sum(
                    1 for e in past_activity
                    if e["action"] in ("replied", "thread_reply") and pid in e.get("detail", "")
                )
                if thread_count >= 2:
                    continue  # enough thread continuation on this post
                # Only thread ~20% of the time to avoid spam
                if random.random() > 0.2:
                    continue
                continuation = await self._llm(
                    f'You previously posted:\nTitle: "{post.get("title")}"\n'
                    f'{post.get("content", "")[:300]}\n\n'
                    f"Write a short follow-up thought to continue this thread (1-2 sentences). "
                    "Add something new — don't just restate the original.",
                    )
                if continuation:
                    try:
                        await self._post_with_challenge(
                            self.client.create_comment, pid, continuation
                        )
                        await self.log("thread_reply", f"Continued thread on '{post.get('title')}'")
                        await asyncio.sleep(20)
                        return  # only one thread continuation per heartbeat
                    except Exception as e:
                        logger.error("Thread reply error: %s", e)
                elif self.config.behavior.log_skipped:
                    await self.log("skipped_thread", f"LLM returned empty continuation for '{post.get('title')}'")
        except Exception as e:
            logger.error("Reply to own threads error: %s", e)

    async def _maybe_post_new(self):
        sched = self.config.schedule
        beh = self.config.behavior
        now = time.time()
        logger.info("[agent-%d] _maybe_post_new: now=%.0f next_post=%.0f diff=%.0fm last_post=%.0f",
                    self.slot, now, self.state.next_post_time,
                    (now - self.state.next_post_time) / 60, self.state.last_post_time)

        # Determine effective interval with karma throttle
        interval_secs = sched.post_interval_minutes * 60
        if beh.karma_throttle and self.state.karma < beh.karma_throttle_threshold:
            interval_secs *= beh.karma_throttle_multiplier
            logger.info("[agent-%d] Karma throttle active", self.slot)

        if self.state.next_post_time == 0 or self.state.next_post_time < 1000000:
            jitter = 1.0 + random.uniform(-beh.post_jitter_pct / 100, beh.post_jitter_pct / 100)
            self.state.next_post_time = now + interval_secs * jitter
            logger.info("[agent-%d] Seeded next_post_time: in %.0fm", self.slot,
                        (self.state.next_post_time - now) / 60)
            await self._save_state()

        if now < self.state.next_post_time:
            logger.info("[agent-%d] Not time to post yet (%.0fm remaining)", self.slot,
                        (self.state.next_post_time - now) / 60)
            return

        hour = datetime.now().hour
        if not (sched.active_hours_start <= hour < sched.active_hours_end):
            logger.info("[agent-%d] Outside active hours (%d not in %d-%d)", self.slot,
                        hour, sched.active_hours_start, sched.active_hours_end)
            return

        logger.info("[agent-%d] Attempting to post...", self.slot)

        # Choose submolt — use preferred list ~70% of the time, discover otherwise
        submolt = None
        if beh.target_submolts and random.random() < 0.7:
            submolt = random.choice(beh.target_submolts)
        if not submolt:
            try:
                all_submolts = await self.client.list_submolts()
                names = [s["name"] for s in all_submolts]
                excludes = set(beh.exclude_submolts) | set(beh.target_submolts)
                candidates = [n for n in names if n not in excludes]
                if not candidates and not beh.target_submolts:
                    await self.log("skipped_post", "No submolts available after applying excludes")
                    return
                if candidates:
                    # Prefer submolts matching agent topics
                    topics_lower = {t.lower() for t in self.config.persona.topics}
                    matched = [n for n in candidates if n.lower() in topics_lower]
                    submolt = random.choice(matched) if matched else random.choice(candidates)
                else:
                    # All submolts excluded, fall back to target list
                    submolt = random.choice(beh.target_submolts)
            except Exception as e:
                if beh.target_submolts:
                    submolt = random.choice(beh.target_submolts)
                else:
                    logger.error("Failed to discover submolts for slot %d: %s", self.slot, e)
                    await self.log("skipped_post", f"Could not discover submolts: {e}")
                    return

        # Re-validate if submolt was previously flagged invalid
        row_now = await db.get_moltbook_config(self.pool, self.slot)
        current_invalid = row_now.get("invalid_submolts", [])
        if submolt in current_invalid:
            try:
                if await self.client.check_submolt(submolt):
                    await db.cache_valid_submolt(self.pool, submolt)
                    new_invalid = [s for s in current_invalid if s != submolt]
                    await db.upsert_moltbook_config(self.pool, self.slot, invalid_submolts=new_invalid)
                    logger.info("[agent-%d] Submolt '%s' is now valid — cleared from invalid list", self.slot, submolt)
                else:
                    alternatives = [s for s in beh.target_submolts if s != submolt and s not in current_invalid]
                    if alternatives:
                        submolt = random.choice(alternatives)
                    else:
                        await self.log("skipped_post", f"Submolt '{submolt}' still invalid, no alternatives")
                        return
            except Exception:
                pass  # network error — try posting anyway

        topics = self.config.persona.topics
        max_len = beh.max_post_length

        # Gather recent post titles to avoid repetition
        past_activity = await db.read_moltbook_activity(self.pool, self.slot, n=200)
        recent_titles = []
        for entry in past_activity:
            if entry["action"] == "posted":
                detail = entry.get("detail", "")
                # Extract title from "New post: 'Title' → m/submolt [id]"
                if "'" in detail:
                    start = detail.index("'") + 1
                    end = detail.index("'", start) if "'" in detail[start:] else len(detail)
                    title_text = detail[start:start + detail[start:].index("'")] if "'" in detail[start:] else detail[start:]
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

        content = await self._llm(
            f"Choose one topic from {topics} and write a genuine post. "
            f"Title on first line, content below. Max {max_len} chars. No hashtags.{avoid_text}"
        )
        if not content:
            if self.config.behavior.log_skipped:
                await self.log("skipped_post", "LLM returned empty content — post not created")
            return
        lines = content.strip().splitlines()
        title = lines[0].strip().lstrip("#").strip()[:300]
        body = "\n".join(lines[1:]).strip() or title
        try:
            result = await self._post_with_challenge(
                self.client.create_post, submolt=submolt, title=title, content=body
            )
            self.state.last_post_time = now
            # Schedule next post with fresh jitter
            jitter = 1.0 + random.uniform(-beh.post_jitter_pct / 100, beh.post_jitter_pct / 100)
            self.state.next_post_time = now + interval_secs * jitter
            await self._save_state()
            post_id = ""
            if isinstance(result, dict):
                post_id = result.get("id", "") or result.get("post", {}).get("id", "")
            await self.log("posted", f"New post: '{title}' → m/{submolt} [{post_id}]")
        except httpx.HTTPStatusError as e:
            body = e.response.text[:300] if e.response else ""
            logger.error("Post error slot %d: %s — %s", self.slot, e, body)
            await self.log("error", f"Failed to create post: {e.response.status_code} {e.response.reason_phrase} — {body}")
        except Exception as e:
            logger.error("Post error slot %d: %s", self.slot, e)
            await self.log("error", f"Failed to create post: {type(e).__name__}: {e}")

    async def _update_peer_db(self, peer_names: list[str] | None = None) -> None:
        """Scan feed and record posts from peer agents. If peer_names is None, tracks all non-self authors."""
        try:
            feed = await self.client.feed(sort="new", limit=30)
            own_name = self.config.persona.name
            for post in feed.get("posts", []):
                author = post.get("author", {}).get("name", "")
                if peer_names is not None:
                    if author not in peer_names:
                        continue
                else:
                    if author == own_name:
                        continue
                pid = post.get("id")
                if not pid:
                    continue
                await db.upsert_peer_post(
                    self.pool,
                    self.slot,
                    author,
                    pid,
                    post.get("title", ""),
                    post.get("content", "")[:200],
                )
            # Prune to keep last 20 per peer
            await db.prune_peer_posts(self.pool, self.slot, keep_per_peer=20)
        except Exception as e:
            logger.error("Peer DB update error slot %d: %s", self.slot, e)

    async def interact_with_peers(self, peer_names: list[str]) -> None:
        """Interact with known peer agent posts using the peer database."""
        await self.log("peer_interact", f"Engaging with peers: {', '.join(peer_names)}")
        await self._update_peer_db(peer_names)
        peer_db = await self._load_peer_db()
        beh = self.config.behavior
        own_name = self.config.persona.name
        liked = 0
        commented = 0

        for peer_name, posts in peer_db.peers.items():
            if peer_name == own_name:
                continue
            for pp in posts[-5:]:  # most recent 5 posts per peer
                pid = pp.post_id

                if beh.send_peer_likes and pid not in peer_db.liked_post_ids:
                    try:
                        await self.client.upvote_post(pid)
                        await db.record_interaction(self.pool, self.slot, pid, "liked")
                        peer_db.liked_post_ids.append(pid)
                        liked += 1
                    except Exception:
                        pass

                if beh.send_peer_comments and pid not in peer_db.commented_post_ids:
                    comment = await self._llm(
                        f'Your peer agent {peer_name} posted:\n'
                        f'"{pp.title}"\n{pp.content_preview}\n\n'
                        "Write a thoughtful comment (1-2 sentences).",
                    )
                    if comment:
                        try:
                            await self._post_with_challenge(self.client.create_comment, pid, comment)
                            await db.record_interaction(self.pool, self.slot, pid, "commented")
                            peer_db.commented_post_ids.append(pid)
                            commented += 1
                            await asyncio.sleep(20)
                        except Exception as e:
                            logger.error("Peer comment error: %s", e)
                    elif self.config.behavior.log_skipped:
                        await self.log("skipped_peer_comment", f"LLM returned empty comment for {peer_name} post {pid}")

        await self.log("peer_interact", f"Liked {liked}, commented {commented} peer posts")

    async def _loop(self):
        self.running = True
        # Small delay before first loop — let DB connections stabilize
        await asyncio.sleep(2)
        try:
            while True:
                # Verify we still hold the advisory lock before each heartbeat
                if self._lock_conn:
                    try:
                        row = await self._lock_conn.fetchrow(
                            "SELECT pg_try_advisory_lock($1, $2) AS acquired",
                            0xECD1, self.slot,
                        )
                        if not row["acquired"]:
                            logger.warning(
                                "Agent %d lost advisory lock — stopping (another pod took over)",
                                self.slot,
                            )
                            break
                    except Exception as e:
                        logger.warning("Agent %d lock check error: %s — retrying in 30s", self.slot, e)
                        await asyncio.sleep(30)
                        continue


                await self.run_heartbeat()
                base_interval = getattr(self.config.schedule, 'heartbeat_interval_minutes', 30) * 60
                base_interval = base_interval or DEFAULT_HEARTBEAT_INTERVAL
                hb_jitter_pct = getattr(self.config.schedule, 'heartbeat_jitter_pct', 20) / 100
                jitter = 1.0 + random.uniform(-hb_jitter_pct, hb_jitter_pct)
                await asyncio.sleep(base_interval * jitter)
        except asyncio.CancelledError:
            if self._heartbeat_lock.locked():
                logger.info("[agent-%d] Heartbeat interrupted — pod shutting down", self.slot)
                try:
                    await self.log("heartbeat", "Interrupted — pod shutting down")
                except Exception:
                    pass
        finally:
            self.running = False

    def start(self):
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._loop())
        logger.info("Agent %d started", self.slot)

    def stop(self):
        if self._task:
            self._task.cancel()
            self._task = None
        logger.info("Agent %d stopped", self.slot)
