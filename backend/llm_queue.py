"""Submit LLM calls via llm-manager's queue API, wait via SSE stream."""

import json
import logging
from typing import Callable, Optional

import httpx

logger = logging.getLogger(__name__)

SSE_TIMEOUT = 600  # 10 minutes (large model loads on AMD can take 5+min)


async def queue_chat(
    llm_base: str,
    api_key: str,
    model: str,
    messages: list[dict],
    metadata: dict | None = None,
    on_status: Optional[Callable[[str, str], None]] = None,
) -> dict:
    """Submit a chat completion job to the queue and wait for the result via SSE.

    on_status: optional callback(job_id, status) called on each status change.
    Returns the OpenAI-format result dict (with choices, usage, etc.),
    or raises on failure/timeout.
    """
    headers = {"Authorization": f"Bearer {api_key}"}

    async with httpx.AsyncClient(timeout=httpx.Timeout(10, read=30)) as http:
        r = await http.post(
            f"{llm_base}/api/queue/submit",
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
    logger.debug("Queued job %s (model=%s, position=%s)", job_id, model, job.get("position"))
    if on_status:
        on_status(job_id, "queued")

    wait_url = f"{llm_base}/api/queue/jobs/{job_id}/wait"
    async with httpx.AsyncClient(timeout=httpx.Timeout(10, read=SSE_TIMEOUT)) as http:
        async with http.stream("GET", wait_url, headers=headers) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = json.loads(line[6:])

                if "error" in data and "status" not in data:
                    raise RuntimeError(f"Queue job {job_id}: {data['error']}")

                status = data.get("status")
                if on_status and status:
                    on_status(job_id, status)

                if status == "completed":
                    return data["result"]
                elif status in ("failed", "cancelled"):
                    error = data.get("error", "unknown error")
                    raise RuntimeError(f"Queue job {job_id} {status}: {error}")

    raise TimeoutError(f"Queue job {job_id} SSE stream ended without result")
