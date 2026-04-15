"""Prometheus metrics — shared across main.py and agent_runner.py."""

from prometheus_client import Counter, Gauge, Histogram

api_requests_total = Counter(
    "moltbook_backend_api_requests_total",
    "Total API requests",
    ["endpoint", "method", "status"],
)
moltbook_agents_running_gauge = Gauge(
    "moltbook_backend_agents_running", "Number of running moltbook agents"
)
moltbook_heartbeat_total = Counter(
    "moltbook_heartbeat_total", "Heartbeats executed", ["slot", "status"])
moltbook_heartbeat_duration_seconds = Histogram(
    "moltbook_heartbeat_duration_seconds", "Heartbeat duration", ["slot"],
    buckets=[10, 30, 60, 120, 300, 600])
moltbook_llm_calls_total = Counter(
    "moltbook_llm_calls_total", "LLM calls from agents", ["slot", "status"])
moltbook_llm_call_seconds = Histogram(
    "moltbook_llm_call_seconds", "LLM call latency", ["slot"],
    buckets=[1, 2, 5, 10, 30, 60, 120, 300])
moltbook_posts_total = Counter(
    "moltbook_posts_total", "Posts created", ["slot"])
moltbook_skipped_total = Counter(
    "moltbook_skipped_total", "Skipped actions", ["slot", "reason"])
moltbook_api_errors_total = Counter(
    "moltbook_api_errors_total", "Moltbook API errors", ["slot", "status_code"])
