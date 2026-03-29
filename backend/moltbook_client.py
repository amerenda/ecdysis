"""Moltbook API client. All endpoints from skill.md / heartbeat.md / messaging.md."""

import asyncio
import logging
import httpx
from datetime import datetime, timezone

API_BASE = "https://www.moltbook.com/api/v1"
logger = logging.getLogger(__name__)


class RateLimitedError(Exception):
    """Raised when Moltbook returns 429."""
    def __init__(self, reset_at: datetime, retry_after: int):
        self.reset_at = reset_at
        self.retry_after = retry_after
        super().__init__(f"Rate limited until {reset_at.isoformat()} ({retry_after}s)")

MAX_RETRIES = 3
RETRY_BACKOFF = [2, 5, 10]  # seconds


class MoltbookClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    async def _request_with_retry(self, method: str, path: str, **kwargs) -> httpx.Response:
        """Make an HTTP request with retry on 5xx errors."""
        last_response = None
        for attempt in range(MAX_RETRIES):
            async with httpx.AsyncClient(timeout=30) as client:
                r = await getattr(client, method)(f"{API_BASE}{path}", headers=self._headers, **kwargs)
                if r.status_code < 500:
                    return r
                last_response = r
                wait = RETRY_BACKOFF[attempt] if attempt < len(RETRY_BACKOFF) else RETRY_BACKOFF[-1]
                logger.warning("Moltbook %d on %s %s — retry %d/%d in %ds", r.status_code, method.upper(), path, attempt + 1, MAX_RETRIES, wait)
                await asyncio.sleep(wait)
        return last_response

    def _check_rate_limit(self, r: httpx.Response) -> None:
        if r.status_code == 429:
            try:
                body = r.json()
                reset_at_str = body.get("reset_at", "")
                retry_after = body.get("retry_after_seconds", 3600)
                reset_at = datetime.fromisoformat(reset_at_str.replace("Z", "+00:00")) if reset_at_str else datetime.now(timezone.utc)
            except Exception:
                reset_at = datetime.now(timezone.utc)
                retry_after = 3600
            raise RateLimitedError(reset_at, retry_after)

    async def _get(self, path: str, params: dict = None) -> dict:
        r = await self._request_with_retry("get", path, params=params)
        self._check_rate_limit(r)
        if r.status_code >= 400:
            body = r.text[:500]
            logger.error("Moltbook API error %d on GET %s: %s", r.status_code, path, body)
        r.raise_for_status()
        return r.json()

    async def _post(self, path: str, data: dict = None) -> dict:
        r = await self._request_with_retry("post", path, json=data or {})
        self._check_rate_limit(r)
        if r.status_code >= 400:
            body = r.text[:500]
            logger.error("Moltbook API error %d on POST %s: %s", r.status_code, path, body)
        r.raise_for_status()
        return r.json()

    # ── Core ────────────────────────────────────────────────────────────────

    async def home(self) -> dict:
        """GET /home — everything you need in one call."""
        return await self._get("/home")

    async def feed(self, sort: str = "new", limit: int = 15) -> dict:
        return await self._get("/feed", {"sort": sort, "limit": limit})

    async def check_submolt(self, name: str) -> bool:
        """Check if a submolt exists on Moltbook. Returns True if valid."""
        try:
            await self._get(f"/submolts/{name}")
            return True
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return False
            raise

    async def list_submolts(self) -> list[dict]:
        """GET /submolts — list all available submolts."""
        data = await self._get("/submolts")
        return data.get("submolts", [])

    # ── Posts ───────────────────────────────────────────────────────────────

    async def create_post(
        self,
        submolt: str,
        title: str,
        content: str,
        challenge_answer: dict = None,
    ) -> dict:
        data = {"submolt_name": submolt, "title": title, "content": content}
        if challenge_answer:
            data["challenge_answer"] = challenge_answer
        return await self._post("/posts", data)

    async def get_comments(self, post_id: str, sort: str = "new", limit: int = 35) -> dict:
        return await self._get(f"/posts/{post_id}/comments", {"sort": sort, "limit": limit})

    async def create_comment(
        self,
        post_id: str,
        content: str,
        parent_id: str = None,
        challenge_answer: dict = None,
    ) -> dict:
        data: dict = {"content": content}
        if parent_id:
            data["parent_id"] = parent_id
        if challenge_answer:
            data["challenge_answer"] = challenge_answer
        return await self._post(f"/posts/{post_id}/comments", data)

    async def upvote_post(self, post_id: str) -> dict:
        return await self._post(f"/posts/{post_id}/upvote")

    async def upvote_comment(self, comment_id: str) -> dict:
        return await self._post(f"/comments/{comment_id}/upvote")

    async def mark_notifications_read(self, post_id: str) -> dict:
        return await self._post(f"/notifications/read-by-post/{post_id}")

    async def follow_agent(self, agent_name: str) -> dict:
        return await self._post(f"/agents/{agent_name}/follow")

    # ── DMs ────────────────────────────────────────────────────────────────

    async def dm_check(self) -> dict:
        return await self._get("/agents/dm/check")

    async def dm_requests(self) -> dict:
        return await self._get("/agents/dm/requests")

    async def dm_approve(self, conv_id: str) -> dict:
        return await self._post(f"/agents/dm/requests/{conv_id}/approve")

    async def dm_reject(self, conv_id: str, block: bool = False) -> dict:
        data = {"block": True} if block else {}
        return await self._post(f"/agents/dm/requests/{conv_id}/reject", data)

    async def dm_conversations(self) -> dict:
        return await self._get("/agents/dm/conversations")

    async def dm_read(self, conv_id: str) -> dict:
        return await self._get(f"/agents/dm/conversations/{conv_id}")

    async def dm_send(self, conv_id: str, message: str, needs_human: bool = False) -> dict:
        data: dict = {"message": message}
        if needs_human:
            data["needs_human_input"] = True
        return await self._post(f"/agents/dm/conversations/{conv_id}/send", data)

    async def dm_request(self, to: str = None, to_owner: str = None, message: str = "") -> dict:
        data: dict = {"message": message}
        if to:
            data["to"] = to
        elif to_owner:
            data["to_owner"] = to_owner
        return await self._post("/agents/dm/request", data)

    async def status(self) -> dict:
        """GET /agents/status — check claim status."""
        return await self._get("/agents/status")

    # ── Owner management ────────────────────────────────────────────────────

    async def setup_owner_email(self, email: str) -> dict:
        """POST /agents/me/setup-owner-email — sends verification email to owner."""
        return await self._post("/agents/me/setup-owner-email", {"email": email})

    # ── Registration (one-time) ─────────────────────────────────────────────

    # ── Dry run subclass ───────────────────────────────────────────────────


class DryRunMoltbookClient(MoltbookClient):
    """Wraps MoltbookClient — reads are real, writes are intercepted."""

    def __init__(self, api_key: str, karma: int = 0):
        super().__init__(api_key)
        self.dry_actions: list[dict] = []
        self._karma = karma

    async def home(self) -> dict:
        return {"your_account": {"karma": self._karma}, "activity_on_your_posts": []}

    async def dm_check(self) -> dict:
        return {"has_activity": False}

    async def create_post(self, submolt: str, title: str, content: str, challenge_answer: dict = None) -> dict:
        self.dry_actions.append({"type": "post", "submolt": submolt, "title": title, "content": content})
        return {"id": "dry-run-post"}

    async def create_comment(self, post_id: str, content: str, parent_id: str = None, challenge_answer: dict = None) -> dict:
        self.dry_actions.append({"type": "comment", "post_id": post_id, "content": content, "parent_id": parent_id})
        return {"id": "dry-run-comment"}

    async def upvote_post(self, post_id: str) -> dict:
        self.dry_actions.append({"type": "upvote", "post_id": post_id})
        return {}

    async def upvote_comment(self, comment_id: str) -> dict:
        self.dry_actions.append({"type": "upvote_comment", "comment_id": comment_id})
        return {}

    async def dm_approve(self, conv_id: str) -> dict:
        self.dry_actions.append({"type": "dm_approve", "conversation_id": conv_id})
        return {}

    async def mark_notifications_read(self, post_id: str) -> dict:
        return {}


    @staticmethod
    async def register(name: str, description: str) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{API_BASE}/agents/register",
                json={"name": name, "description": description},
                headers={"Content-Type": "application/json"},
            )
            r.raise_for_status()
            return r.json()
