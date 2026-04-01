"""Submit LLM calls via llm-manager's queue API instead of direct /v1/chat/completions."""

import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

# Poll interval and timeout for waiting on queue jobs
POLL_INTERVAL = 1.0  # seconds
POLL_TIMEOUT = 300   # 5 minutes max wait


async def queue_chat(
    llm_base: str,
    api_key: str,
    model: str,
    messages: list[dict],
    metadata: dict | None = None,
) -> dict:
    """Submit a chat completion job to the queue and wait for the result.

    Returns the OpenAI-format result dict (with choices, usage, etc.),
    or raises on failure/timeout.
    """
    submit_url = f"{llm_base}/api/queue/submit"
    headers = {"Authorization": f"Bearer {api_key}"}

    async with httpx.AsyncClient(timeout=httpx.Timeout(10, read=30)) as http:
        r = await http.post(
            submit_url,
            headers=headers,
            json={
                "model": model,
                "messages": messages,
                "stream": False,
                "metadata": metadata,
            },
        )
        r.raise_for_status()
        job = r.json()

    job_id = job["job_id"]
    status_url = f"{llm_base}/api/queue/jobs/{job_id}"
    logger.debug("Queued job %s (model=%s, position=%s)", job_id, model, job.get("position"))

    # Poll until complete
    elapsed = 0.0
    async with httpx.AsyncClient(timeout=10) as http:
        while elapsed < POLL_TIMEOUT:
            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

            r = await http.get(status_url, headers=headers)
            r.raise_for_status()
            data = r.json()
            status = data["status"]

            if status == "completed":
                return data["result"]
            elif status in ("failed", "cancelled"):
                error = data.get("error", "unknown error")
                raise RuntimeError(f"Queue job {job_id} {status}: {error}")

    raise TimeoutError(f"Queue job {job_id} timed out after {POLL_TIMEOUT}s")
