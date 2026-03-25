"""
Moltbook Backend API.
Self-contained FastAPI service for moltbook agent management.
Runs on port 8082.
"""
import asyncio
import logging
import os
import re
import socket
from contextlib import asynccontextmanager
from typing import Optional

import asyncpg
import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    generate_latest,
)
from pydantic import BaseModel

import db
from config import (
    AgentConfig, AgentPersona, AgentSchedule, AgentBehavior,
    config_from_db, state_from_db,
)
from agent_runner import AgentRunner
from moltbook_client import MoltbookClient

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

AGENT_PSK = os.environ.get("LLM_MANAGER_AGENT_PSK", "")
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://llm:llm@localhost:5432/llmmanager")
NODE = socket.gethostname()
API_BASE = "https://www.moltbook.com/api/v1"

# Global agent runners (slot 1-6)
runners: dict[int, AgentRunner] = {}
# Dedicated connection for advisory locks (survives pool recycling)
_lock_conn: Optional[asyncpg.Connection] = None
# Global heartbeat lock — only one agent runs a heartbeat at a time
_heartbeat_gate = asyncio.Lock()
# Lock namespace: 0xECD1 (ecdysis) to avoid collisions with other apps
LOCK_NAMESPACE = 0xECD1

# ── Prometheus metrics ────────────────────────────────────────────────────────

api_requests_total = Counter(
    "moltbook_backend_api_requests_total",
    "Total API requests",
    ["endpoint", "method", "status"],
)
moltbook_agents_running_gauge = Gauge(
    "moltbook_backend_agents_running", "Number of running moltbook agents"
)


def _inc_request(endpoint: str, method: str, status: int):
    api_requests_total.labels(endpoint=endpoint, method=method, status=str(status)).inc()


async def _validate_submolts(pool, api_key: str, names: list[str]) -> tuple[list[str], list[str]]:
    """Validate submolt names against cache + Moltbook API. Returns (valid, invalid)."""
    if not names or not api_key:
        return [], []
    cached = await db.get_validated_submolts(pool, names)
    valid = list(cached & set(names))
    invalid = []
    client = MoltbookClient(api_key)
    for name in names:
        if name in cached:
            continue
        try:
            if await client.check_submolt(name):
                valid.append(name)
                await db.cache_valid_submolt(pool, name)
            else:
                invalid.append(name)
        except Exception:
            valid.append(name)  # assume valid on error
    return valid, invalid


# ── Runner helpers ────────────────────────────────────────────────────────────

LLM_MANAGER_URL = os.environ.get(
    "LLM_MANAGER_URL",
    "http://llm-manager-backend.llm-manager.svc.cluster.local:8081",
)


async def _get_runners_from_llm_manager() -> list[dict]:
    """Fetch active runners from llm-manager API."""
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(f"{LLM_MANAGER_URL}/api/runners")
        resp.raise_for_status()
        return resp.json()


async def _get_runner_ollama_base(runner_id: Optional[int] = None) -> str:
    """Get Ollama URL for a runner. Replaces the runner port with 11434.
    Ollama always uses plain HTTP regardless of agent protocol."""
    try:
        runners_list = await _get_runners_from_llm_manager()
    except Exception as e:
        logger.error("Failed to fetch runners from llm-manager: %s", e)
        raise HTTPException(503, "Cannot reach llm-manager for runner info")
    if not runners_list:
        raise HTTPException(503, "No active llm-runners available")
    if runner_id is not None:
        r = next((x for x in runners_list if x["id"] == runner_id), None)
        if not r:
            r = runners_list[0]
    else:
        # Pick the runner with the most VRAM (most likely to have models)
        def _runner_vram(runner):
            caps = runner.get("capabilities", {})
            if isinstance(caps, dict):
                return caps.get("gpu_vram_total_bytes", 0)
            return 0
        r = max(runners_list, key=_runner_vram)
    # runner address is like https://10.x.x.x:8090
    # ollama is on the same host at port 11434, always plain HTTP
    addr = r["address"]
    # Strip scheme and port, rebuild as http with Ollama port
    host = re.sub(r'^https?://', '', addr)
    host = re.sub(r':\d+$', '', host)
    return f"http://{host}:11434"


def _make_runner(config: AgentConfig, pool: asyncpg.Pool, ollama_base: str) -> AgentRunner:
    return AgentRunner(
        config,
        pool=pool,
        ollama_base=ollama_base,
        ollama_model=config.model,
        psk=AGENT_PSK,
        lock_conn=_lock_conn,
        heartbeat_gate=_heartbeat_gate,
    )


# ── Lifespan ──────────────────────────────────────────────────────────────────


async def _try_acquire_agent_lock(conn: asyncpg.Connection, slot: int) -> bool:
    """Try to acquire a Postgres advisory lock for an agent slot.
    Returns True if lock acquired, False if another pod holds it."""
    row = await conn.fetchrow(
        "SELECT pg_try_advisory_lock($1, $2) AS acquired",
        LOCK_NAMESPACE, slot,
    )
    return row["acquired"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _lock_conn
    pool_min = int(os.environ.get("DB_POOL_MIN", "2"))
    pool_max = int(os.environ.get("DB_POOL_MAX", "10"))
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=pool_min, max_size=pool_max)
    app.state.db = pool
    await db.init_db(pool)
    logger.info("Database connected: %s", DATABASE_URL)

    # Set up DB logging handler (captures logs from all loggers to DB)
    from log_handler import setup_db_logging
    db_log_handlers = setup_db_logging(pool)
    for h in db_log_handlers:
        await h.start_flush_loop()
    app.state.db_log_handlers = db_log_handlers

    # Dedicated connection for advisory locks (not from pool)
    _lock_conn = await asyncpg.connect(DATABASE_URL)
    logger.info("Advisory lock connection established")

    # Auto-start enabled agents, acquiring advisory locks first
    # Retry lock acquisition — old pod's locks may take a few seconds to release
    unacquired = []
    for row in await db.get_all_moltbook_configs(pool):
        if row["enabled"] and row["api_key"]:
            slot = row["slot"]
            if not await _try_acquire_agent_lock(_lock_conn, slot):
                unacquired.append(row)
                logger.info("Slot %d locked on first attempt, will retry", slot)
                continue
            config = config_from_db(row)
            try:
                ollama_base = await _get_runner_ollama_base(row.get("llm_runner_id"))
            except HTTPException:
                logger.warning(
                    "No runners available for slot %d, deferring start", slot
                )
                continue
            r = _make_runner(config, pool, ollama_base)
            runners[config.slot] = r
            r.start()
            logger.info(
                "Auto-started moltbook agent %d (%s) [lock acquired]",
                config.slot, config.persona.name,
            )

    # Retry unacquired slots after a delay (old pod connections closing)
    if unacquired:
        logger.info("Retrying %d unacquired slot(s) in 10s...", len(unacquired))
        await asyncio.sleep(10)
        for row in unacquired:
            slot = row["slot"]
            if slot in runners:
                continue
            if not await _try_acquire_agent_lock(_lock_conn, slot):
                logger.info("Slot %d still locked — running on another replica", slot)
                continue
            config = config_from_db(row)
            try:
                ollama_base = await _get_runner_ollama_base(row.get("llm_runner_id"))
            except HTTPException:
                logger.warning("No runners available for slot %d, deferring start", slot)
                continue
            r = _make_runner(config, pool, ollama_base)
            runners[config.slot] = r
            r.start()
            logger.info("Auto-started moltbook agent %d (%s) [lock acquired on retry]", config.slot, config.persona.name)

    yield

    for r in runners.values():
        r.stop()
    if _lock_conn:
        await _lock_conn.close()  # releases all advisory locks
    await pool.close()


app = FastAPI(title="Moltbook Backend", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    db_ok = app.state.db is not None
    db_name = None
    if db_ok:
        try:
            async with app.state.db.acquire() as conn:
                db_name = await conn.fetchval("SELECT current_database()")
        except Exception:
            pass
    return {
        "ok": True,
        "service": "moltbook-backend",
        "node": NODE,
        "db": db_ok,
        "is_uat": db_name is not None and "uat" in db_name.lower(),
    }


# ── System logs ──────────────────────────────────────────────────────────────

@app.get("/api/logs")
async def get_system_logs(source: Optional[str] = None, level: Optional[str] = None, slot: Optional[int] = None, limit: int = 200):
    """Get system logs from all pods. Filter by source, level, and agent slot."""
    logs = await db.get_logs(app.state.db, source=source, level=level, slot=slot, limit=min(limit, 500))
    return logs


# ── Moltbook agent config ────────────────────────────────────────────────────


@app.get("/api/agents")
async def get_moltbook_agents():
    pool = app.state.db
    configs = await db.get_all_moltbook_configs(pool)
    result = []
    for row in configs:
        state_row = await db.get_moltbook_state(pool, row["slot"])
        state = state_from_db(state_row)
        recent_error = await db.get_recent_error(pool, row["slot"])
        result.append({
            "slot": row["slot"],
            "has_recent_error": recent_error is not None,
            "enabled": row["enabled"],
            "model": row["model"],
            "api_key": row["api_key"],
            "registered": row["registered"],
            "claimed": row["claimed"],
            "llm_runner_id": row.get("llm_runner_id"),
            "running": row["slot"] in runners and runners[row["slot"]].running,
            "soul_md": row.get("soul_md", ""),
            "heartbeat_md": row.get("heartbeat_md", ""),
            "messaging_md": row.get("messaging_md", ""),
            "rules_md": row.get("rules_md", ""),
            "memory_md": row.get("memory_md", ""),
            "persona": {
                "name": row["name"],
                "description": row["description"],
                "tone": row["tone"],
                "topics": row["topics"],
            },
            "schedule": {
                "post_interval_minutes": row["post_interval_minutes"],
                "heartbeat_interval_minutes": row.get("heartbeat_interval_minutes", 30),
                "heartbeat_jitter_pct": row.get("heartbeat_jitter_pct", 20),
                "active_hours_start": row["active_hours_start"],
                "active_hours_end": row["active_hours_end"],
            },
            "behavior": {
                "max_post_length": row["max_post_length"],
                "auto_reply": row["auto_reply"],
                "auto_like": row["auto_like"],
                "reply_to_own_threads": row["reply_to_own_threads"],
                "post_jitter_pct": row["post_jitter_pct"],
                "karma_throttle": row["karma_throttle"],
                "karma_throttle_threshold": row["karma_throttle_threshold"],
                "karma_throttle_multiplier": row["karma_throttle_multiplier"],
                "target_submolts": row["target_submolts"],
                "exclude_submolts": row.get("exclude_submolts", []),
                "invalid_submolts": row.get("invalid_submolts", []),
                "auto_dm_approve": row["auto_dm_approve"],
                "receive_peer_likes": row["receive_peer_likes"],
                "receive_peer_comments": row["receive_peer_comments"],
                "send_peer_likes": row["send_peer_likes"],
                "send_peer_comments": row["send_peer_comments"],
                "log_skipped": row.get("log_skipped", True),
            },
            "state": state.model_dump(),
        })
    moltbook_agents_running_gauge.set(
        sum(1 for r in runners.values() if r.running)
    )
    return result


class AgentUpdateRequest(BaseModel):
    enabled: Optional[bool] = None
    model: Optional[str] = None
    llm_runner_id: Optional[int] = None
    api_key: Optional[str] = None
    soul_md: Optional[str] = None
    heartbeat_md: Optional[str] = None
    messaging_md: Optional[str] = None
    rules_md: Optional[str] = None
    memory_md: Optional[str] = None
    persona: Optional[dict] = None
    schedule: Optional[dict] = None
    behavior: Optional[dict] = None


@app.patch("/api/agents/{slot}")
async def update_moltbook_agent(slot: int, req: AgentUpdateRequest):
    if slot not in range(1, 7):
        raise HTTPException(status_code=404, detail="Slot must be 1-6")
    pool = app.state.db

    # Load current row to merge partial updates
    row = await db.get_moltbook_config(pool, slot)

    updates: dict = {}

    if req.enabled is not None:
        updates["enabled"] = req.enabled
    if req.model is not None:
        updates["model"] = req.model
    if req.llm_runner_id is not None:
        updates["llm_runner_id"] = req.llm_runner_id
    if req.api_key is not None:
        updates["api_key"] = req.api_key
        updates["registered"] = True
    if req.soul_md is not None:
        updates["soul_md"] = req.soul_md
    if req.heartbeat_md is not None:
        updates["heartbeat_md"] = req.heartbeat_md
    if req.messaging_md is not None:
        updates["messaging_md"] = req.messaging_md
    if req.rules_md is not None:
        updates["rules_md"] = req.rules_md
    if req.memory_md is not None:
        updates["memory_md"] = req.memory_md

    if req.persona:
        if "name" in req.persona:
            updates["name"] = req.persona["name"]
        if "description" in req.persona:
            updates["description"] = req.persona["description"]
        if "tone" in req.persona:
            updates["tone"] = req.persona["tone"]
        if "topics" in req.persona:
            updates["topics"] = req.persona["topics"]

    if req.schedule:
        for field in ("post_interval_minutes", "heartbeat_interval_minutes", "heartbeat_jitter_pct", "active_hours_start", "active_hours_end"):
            if field in req.schedule:
                updates[field] = req.schedule[field]

    if req.behavior:
        for field in (
            "max_post_length", "auto_reply", "auto_like", "reply_to_own_threads",
            "post_jitter_pct", "karma_throttle", "karma_throttle_threshold",
            "karma_throttle_multiplier", "target_submolts", "exclude_submolts", "auto_dm_approve",
            "receive_peer_likes", "receive_peer_comments", "send_peer_likes",
            "send_peer_comments", "log_skipped",
        ):
            if field in req.behavior:
                updates[field] = req.behavior[field]

    # Validate submolts if target_submolts changed
    submolt_warnings = []
    if "target_submolts" in updates and updates["target_submolts"]:
        row = await db.get_moltbook_config(pool, slot)
        api_key = updates.get("api_key") or row.get("api_key", "")
        if api_key:
            _, submolt_warnings = await _validate_submolts(pool, api_key, updates["target_submolts"])
        updates["invalid_submolts"] = submolt_warnings
    elif "target_submolts" in updates:
        updates["invalid_submolts"] = []

    if updates:
        await db.upsert_moltbook_config(pool, slot, **updates)

    # Restart runner if it's active
    if slot in runners:
        runners[slot].stop()
        del runners[slot]

    # Re-load updated config and restart if enabled
    updated_row = await db.get_moltbook_config(pool, slot)
    if updated_row["enabled"] and updated_row["api_key"]:
        config = config_from_db(updated_row)
        try:
            ollama_base = await _get_runner_ollama_base(updated_row.get("llm_runner_id"))
            r = _make_runner(config, pool, ollama_base)
            runners[slot] = r
            r.start()
        except HTTPException:
            logger.warning("No runners available for slot %d after update", slot)

    return {"ok": True, "invalid_submolts": submolt_warnings}


# ── Moltbook agent lifecycle ─────────────────────────────────────────────────


@app.post("/api/agents/{slot}/start")
async def start_moltbook_agent(slot: int):
    pool = app.state.db
    row = await db.get_moltbook_config(pool, slot)
    if not row["api_key"]:
        raise HTTPException(status_code=400, detail="Agent not registered — no API key")
    if slot in runners and runners[slot].running:
        return {"ok": True, "message": "Already running"}
    # Acquire advisory lock for this slot
    if _lock_conn and not await _try_acquire_agent_lock(_lock_conn, slot):
        raise HTTPException(409, "Agent is running on another pod")
    config = config_from_db(row)
    try:
        ollama_base = await _get_runner_ollama_base(row.get("llm_runner_id"))
    except HTTPException:
        raise HTTPException(503, "No active llm-runners available to start agent")
    r = _make_runner(config, pool, ollama_base)
    runners[slot] = r
    r.start()
    await db.upsert_moltbook_config(pool, slot, enabled=True)
    return {"ok": True, "message": f"Agent {slot} started"}


@app.post("/api/agents/{slot}/stop")
async def stop_moltbook_agent(slot: int):
    pool = app.state.db
    if slot in runners:
        runners[slot].stop()
        del runners[slot]
    # Release advisory lock
    if _lock_conn:
        await _lock_conn.execute(
            "SELECT pg_advisory_unlock($1, $2)", LOCK_NAMESPACE, slot
        )
    await db.upsert_moltbook_config(pool, slot, enabled=False)
    return {"ok": True, "message": f"Agent {slot} stopped"}




async def _ensure_runner(slot: int) -> AgentRunner:
    """Get or create a runner for one-off actions on enabled agents.
    Only creates a runner if this pod holds (or can acquire) the advisory lock."""
    if slot in runners:
        return runners[slot]
    # Check advisory lock — don't create a runner if another pod owns this slot
    if _lock_conn:
        if not await _try_acquire_agent_lock(_lock_conn, slot):
            raise HTTPException(status_code=409, detail=f"Agent {slot} is running on another replica")
    pool = app.state.db
    row = await db.get_moltbook_config(pool, slot)
    if not row or not row.get("api_key"):
        raise HTTPException(status_code=400, detail="Agent not registered — no API key")
    config = config_from_db(row)
    try:
        ollama_base = await _get_runner_ollama_base(row.get("llm_runner_id"))
    except HTTPException:
        raise HTTPException(status_code=400, detail="No runners available")
    r = _make_runner(config, pool, ollama_base)
    runners[slot] = r
    return r


@app.post("/api/agents/{slot}/heartbeat")
async def trigger_moltbook_heartbeat(slot: int):
    r = await _ensure_runner(slot)
    if r._heartbeat_lock.locked():
        return {"ok": True, "message": "Heartbeat already in progress"}
    asyncio.create_task(r.run_heartbeat())
    return {"ok": True}


@app.get("/api/agents/{slot}/posts")
async def get_agent_posts(slot: int, n: int = 50):
    """Return recent posts and comments by this agent with Moltbook links."""
    activity = await db.read_moltbook_activity(app.state.db, slot, n=200)
    post_actions = {'posted', 'manual_post', 'replied', 'thread_reply'}
    return [e for e in activity if e['action'] in post_actions][:n]


@app.post("/api/agents/{slot}/compact-memory")
async def compact_memory(slot: int):
    r = await _ensure_runner(slot)
    asyncio.create_task(r.compact_memory())
    return {"ok": True, "message": "Memory compaction started in background"}


@app.post("/api/agents/{slot}/interact-with-peers")
async def interact_with_peers(slot: int):
    r = await _ensure_runner(slot)
    peer_names = [
        runners[s].config.persona.name
        for s in runners
        if s != slot and runners[s].running
    ]
    if not peer_names:
        return {"ok": True, "message": "No other running agents to interact with"}
    asyncio.create_task(r.interact_with_peers(peer_names))
    return {"ok": True, "message": f"Interacting with posts by: {', '.join(peer_names)}"}


@app.get("/api/agents/{slot}/activity")
async def get_agent_activity(slot: int, n: int = 50):
    return await db.read_moltbook_activity(app.state.db, slot, n)


class PostRequest(BaseModel):
    submolt: str
    title: str
    content: str


@app.post("/api/agents/{slot}/post")
async def manual_post(slot: int, req: PostRequest):
    if slot not in runners:
        raise HTTPException(status_code=400, detail="Agent not running")
    r = runners[slot]
    try:
        result = await r._post_with_challenge(
            r.client.create_post, req.submolt, req.title, req.content
        )
        await r.log("manual_post", f"Posted: '{req.title}'")
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class RegisterRequest(BaseModel):
    name: str
    description: str


@app.post("/api/agents/{slot}/register")
async def register_moltbook_agent(slot: int, req: RegisterRequest):
    if slot not in range(1, 7):
        raise HTTPException(status_code=404)
    pool = app.state.db
    row = await db.get_moltbook_config(pool, slot)
    if row["registered"] and row["api_key"]:
        raise HTTPException(status_code=400, detail="Already registered")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{API_BASE}/agents/register",
                json={"name": req.name, "description": req.description},
                headers={"Content-Type": "application/json"},
            )
            r.raise_for_status()
            data = r.json()
        # Moltbook nests credentials under "agent"
        agent = data.get("agent", {})
        api_key = (
            agent.get("api_key")
            or data.get("api_key")
            or data.get("token")
            or data.get("key")
        )
        if not api_key:
            raise HTTPException(status_code=502, detail=f"No API key in response: {data}")
        claim_url = agent.get("claim_url", "")
        await db.upsert_moltbook_config(
            pool,
            slot,
            api_key=api_key,
            registered=True,
            name=req.name,
            description=req.description,
        )
        return {
            "ok": True,
            "api_key_preview": api_key[:8] + "...",
            "claim_url": claim_url,
            "message": data.get("message", "Registered!"),
        }
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)


@app.post("/api/agents/{slot}/mark-claimed")
async def mark_claimed(slot: int):
    await db.upsert_moltbook_config(app.state.db, slot, claimed=True)
    return {"ok": True}


@app.get("/api/agents/{slot}/claim-status")
async def get_claim_status(slot: int):
    """Check claim status from Moltbook API. Returns claim_url and next steps."""
    pool = app.state.db
    row = await db.get_moltbook_config(pool, slot)
    if not row["registered"] or not row["api_key"]:
        return {"status": "not_registered", "message": "Agent not registered on Moltbook yet."}
    from moltbook_client import MoltbookClient
    client = MoltbookClient(row["api_key"])
    try:
        data = await client.status()
        status = data.get("status", "unknown")
        # Auto-update local DB if Moltbook says claimed
        if status == "claimed" and not row["claimed"]:
            await db.upsert_moltbook_config(pool, slot, claimed=True)
        return {
            "status": status,
            "message": data.get("message", ""),
            "claim_url": data.get("claim_url", ""),
            "agent_name": data.get("agent", {}).get("name", row["name"]),
            "next_step": data.get("next_step", ""),
            "hint": data.get("hint", ""),
        }
    except httpx.HTTPStatusError as e:
        return {"status": "error", "message": f"Moltbook API error: {e.response.status_code}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


class SetupEmailRequest(BaseModel):
    email: str


@app.post("/api/agents/{slot}/setup-owner-email")
async def setup_owner_email(slot: int, req: SetupEmailRequest):
    pool = app.state.db
    row = await db.get_moltbook_config(pool, slot)
    if not row["registered"] or not row["api_key"]:
        raise HTTPException(400, "Agent not registered")
    client = MoltbookClient(row["api_key"])
    try:
        result = await client.setup_owner_email(req.email)
        return {"ok": True, "message": "Verification email sent. Check your inbox."}
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, e.response.text)


@app.post("/api/agents/{slot}/dm/approve/{conv_id}")
async def approve_dm(slot: int, conv_id: str):
    pool = app.state.db
    if slot not in runners:
        raise HTTPException(status_code=400, detail="Agent not running")
    r = runners[slot]
    result = await r.client.dm_approve(conv_id)
    if conv_id in r.state.pending_dm_requests:
        r.state.pending_dm_requests.remove(conv_id)
    await db.upsert_moltbook_state(
        pool,
        slot,
        pending_dm_requests=r.state.pending_dm_requests,
    )
    await r.log("dm_approved", f"Approved DM {conv_id}")
    return result


@app.delete("/api/agents/{slot}")
async def delete_moltbook_agent(slot: int):
    if slot not in range(1, 7):
        raise HTTPException(status_code=404, detail="Slot must be 1-6")
    if slot in runners:
        runners[slot].stop()
        del runners[slot]
    await db.delete_moltbook_config(app.state.db, slot)
    return {"ok": True}


# ── UAT database reset ────────────────────────────────────────────────────────


@app.post("/api/admin/reset-database")
async def reset_database():
    """Reset the database by dropping and recreating all moltbook tables.
    ONLY works if the database name contains 'uat' — hardcoded safety check."""
    pool = app.state.db

    # Safety: verify the database name contains 'uat'
    async with pool.acquire() as conn:
        db_name = await conn.fetchval("SELECT current_database()")
    if "uat" not in db_name.lower():
        raise HTTPException(
            status_code=403,
            detail=f"Reset refused: database '{db_name}' is not a UAT database",
        )

    # Stop all running agents
    for slot, runner in list(runners.items()):
        runner.stop()
    runners.clear()

    # Drop and recreate tables
    async with pool.acquire() as conn:
        await conn.execute("""
            DROP TABLE IF EXISTS moltbook_peer_interactions CASCADE;
            DROP TABLE IF EXISTS moltbook_peer_posts CASCADE;
            DROP TABLE IF EXISTS moltbook_activity CASCADE;
            DROP TABLE IF EXISTS moltbook_state CASCADE;
            DROP TABLE IF EXISTS moltbook_configs CASCADE;
        """)

    # Recreate tables
    await db.init_db(pool)

    logger.info("UAT database '%s' reset successfully", db_name)
    return {"ok": True, "database": db_name}


# ── Prometheus metrics ────────────────────────────────────────────────────────


@app.get("/metrics")
async def metrics_endpoint():
    running_count = sum(1 for r in runners.values() if r.running)
    moltbook_agents_running_gauge.set(running_count)

    backend_metrics = generate_latest().decode()
    return StreamingResponse(
        iter([backend_metrics]),
        media_type=CONTENT_TYPE_LATEST,
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8082, log_level="info")
