"""Submit LLM calls via llm-manager's queue API, wait via SSE stream."""

import json
import logging

import httpx

logger = logging.getLogger(__name__)

# Timeout for the full SSE wait (submit + model load + inference)
SSE_TIMEOUT = 300  # 5 minutes


async def queue_chat(
    llm_base: str,
    api_key: str,
    model: str,
    messages: list[dict],
    metadata: dict | None = None,
) -> dict:
    """Submit a chat completion job to the queue and wait for the result via SSE.

    Returns the OpenAI-format result dict (with choices, usage, etc.),
    or raises on failure/timeout.
    """
    headers = {"Authorization": f"Bearer {api_key}"}

    # Submit job
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

    # Wait for completion via SSE stream
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
                if status == "completed":
                    return data["result"]
                elif status in ("failed", "cancelled"):
                    error = data.get("error", "unknown error")
                    raise RuntimeError(f"Queue job {job_id} {status}: {error}")
                # queued, loading_model, running — keep waiting

    raise TimeoutError(f"Queue job {job_id} SSE stream ended without result")
