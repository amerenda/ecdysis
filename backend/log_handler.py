"""
Custom logging handler that writes log records to PostgreSQL.

Captures WARNING and above from the application, plus INFO from
agent_runner (for heartbeat/post activity visibility).
"""
import asyncio
import logging
import os
import queue
import threading
from typing import Optional

import asyncpg

POD_NAME = os.environ.get("HOSTNAME", os.environ.get("POD_NAME", "unknown"))


class DbLogHandler(logging.Handler):
    """Async-safe logging handler that buffers records and writes to DB."""

    def __init__(self, pool: asyncpg.Pool, source: str = "backend"):
        super().__init__()
        self.pool = pool
        self.source = source
        self._queue: queue.Queue = queue.Queue(maxsize=500)
        self._flush_task: Optional[asyncio.Task] = None

    def emit(self, record: logging.LogRecord):
        try:
            msg = self.format(record)
            self._queue.put_nowait({
                "source": self.source,
                "level": record.levelname,
                "logger_name": record.name,
                "message": msg,
                "pod_name": POD_NAME,
            })
        except queue.Full:
            pass  # drop if buffer is full

    async def start_flush_loop(self):
        """Start background task that flushes log buffer to DB."""
        self._flush_task = asyncio.create_task(self._flush_loop())

    async def _flush_loop(self):
        while True:
            await asyncio.sleep(2)
            batch = []
            while not self._queue.empty() and len(batch) < 50:
                try:
                    batch.append(self._queue.get_nowait())
                except queue.Empty:
                    break
            if batch:
                try:
                    async with self.pool.acquire() as conn:
                        await conn.executemany(
                            """
                            INSERT INTO system_logs (source, level, logger_name, message, pod_name)
                            VALUES ($1, $2, $3, $4, $5)
                            """,
                            [(r["source"], r["level"], r["logger_name"],
                              r["message"], r["pod_name"]) for r in batch],
                        )
                except Exception:
                    pass  # don't recurse on log errors

    def stop(self):
        if self._flush_task:
            self._flush_task.cancel()


def setup_db_logging(pool: asyncpg.Pool) -> list[DbLogHandler]:
    """Attach DB log handlers to capture app logs. Returns all handlers for lifecycle."""
    handlers = []
    fmt = logging.Formatter("%(message)s")

    # Capture WARNING+ from all loggers
    warning_handler = DbLogHandler(pool, source="backend")
    warning_handler.setLevel(logging.WARNING)
    warning_handler.setFormatter(fmt)
    logging.getLogger().addHandler(warning_handler)
    handlers.append(warning_handler)

    # Capture INFO from agent_runner (heartbeats, posts, errors)
    info_handler = DbLogHandler(pool, source="backend")
    info_handler.setLevel(logging.INFO)
    info_handler.setFormatter(fmt)
    logging.getLogger("agent_runner").addHandler(info_handler)
    handlers.append(info_handler)

    # Capture INFO from __main__ (startup, lock, runner selection)
    main_handler = DbLogHandler(pool, source="backend")
    main_handler.setLevel(logging.INFO)
    main_handler.setFormatter(fmt)
    logging.getLogger("__main__").addHandler(main_handler)
    handlers.append(main_handler)

    # Capture HTTP request logs as "frontend" source
    access_handler = DbLogHandler(pool, source="frontend")
    access_handler.setLevel(logging.INFO)
    access_handler.setFormatter(logging.Formatter("%(client_addr)s - %(request_line)s %(status_code)s"))
    logging.getLogger("uvicorn.access").addHandler(access_handler)
    handlers.append(access_handler)

    return handlers
