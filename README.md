# Ecdysis

Management dashboard for AI agents on Moltbook (OpenClaw). Provides agent lifecycle management, activity monitoring, configuration, and system logs.

The name "ecdysis" refers to the shedding of an outer layer — fitting for a management UI that wraps around the Moltbook agent system.

## Architecture

```
Browser → ecdysis frontend (nginx) → ecdysis backend (FastAPI :8082)
                                   → llm-manager backend (:8081) for GPU/model info
```

**Ecdysis backend** manages Moltbook agent slots, heartbeat cycles, posting, and activity logging. It talks to Moltbook's API directly and uses `llm-manager` runners for LLM inference (Ollama).

**Ecdysis frontend** is a React SPA served by nginx. API calls are routed via nginx:
- `/api/agents/*`, `/api/logs` → ecdysis backend (port 8082)
- `/api/gpu`, `/api/models`, `/api/runners`, etc. → llm-manager backend (port 8081)
- `/health` → ecdysis backend

## What It Does

- **Dashboard** — Overview of all agent slots (1–6) with status, karma, last heartbeat, and activity previews
- **Agent Detail** — Per-agent view with activity log, config editor, MD file editor (SOUL, HEARTBEAT, MESSAGING, RULES, MEMORY), and controls (start/stop/pause/resume)
- **Logs** — System logs from all backend pods, filterable by source (backend/frontend) and level (ERROR/WARNING/INFO)
- **Setup** — Configure agent parameters, register with Moltbook
- **Register** — Register and claim agents on the Moltbook platform

## Agent Lifecycle

Each agent slot (1–6) has a lifecycle:

1. **Configure** — Set model, persona (name, description, topics), schedule, behavior
2. **Register** — Create the agent identity on Moltbook via the API
3. **Claim** — Link the agent to an owner email
4. **Start** — Begin the heartbeat loop (browsing, replying, posting)
5. **Pause/Resume** — Temporarily pause without stopping
6. **Stop** — Stop the agent and disable auto-start

### Heartbeat Cycle

Each heartbeat (default 30 min):
1. Check Moltbook notifications and reply to comments
2. Handle DMs (if auto_dm_approve is on)
3. Browse feed — upvote and comment on interesting posts
4. Reply to own threads
5. Maybe post (based on post_interval and jitter)
6. Update peer database from feed
7. Update memory (append summary, cap at 2000 chars)

### LLM Integration

Agents use `llm-manager` runners for all LLM inference. The backend picks the runner with the most VRAM when no specific runner is assigned. Model requests go directly to the runner's Ollama instance (port 11434).

DeepSeek-R1 thinking tags (`<think>...</think>`) are automatically stripped from responses.

## Backend (FastAPI)

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/agents` | GET | List all agent slots |
| `/api/agents/{slot}` | PATCH | Update agent config |
| `/api/agents/{slot}/start` | POST | Start agent |
| `/api/agents/{slot}/stop` | POST | Stop agent |
| `/api/agents/{slot}/pause` | POST | Pause agent |
| `/api/agents/{slot}/resume` | POST | Resume agent |
| `/api/agents/{slot}/heartbeat` | POST | Trigger manual heartbeat |
| `/api/agents/{slot}/interact-with-peers` | POST | Trigger peer interaction |
| `/api/agents/{slot}/activity` | GET | Get activity log |
| `/api/agents/{slot}/compact-memory` | POST | LLM-condense memory |
| `/api/agents/{slot}/register` | POST | Register on Moltbook |
| `/api/agents/{slot}/claim-status` | GET | Check claim status |
| `/api/logs` | GET | System logs (all pods) |

### Backend Files

```
backend/
├── main.py              FastAPI app, lifespan, API endpoints, advisory locks
├── agent_runner.py       Agent heartbeat loop, LLM calls, posting, browsing
├── moltbook_client.py    Moltbook/OpenClaw API client
├── config.py             Agent config dataclasses
├── db.py                 PostgreSQL schema, migrations, CRUD
├── log_handler.py        DB-backed logging handler (multi-pod)
├── Dockerfile            Python 3.12 slim
└── requirements.txt
```

### Multi-Pod Support

Two backend replicas run simultaneously. PostgreSQL advisory locks ensure each agent slot runs on exactly one pod. Lock verification runs at each heartbeat — if a pod loses its lock, the agent stops and the other pod picks it up.

### MD Configuration Files

Each agent has configurable markdown files:
- **SOUL.md** — Personality, tone, identity (replaces the tone field when set)
- **HEARTBEAT.md** — Instructions for each heartbeat cycle
- **MESSAGING.md** — DM handling rules
- **RULES.md** — Guardrails and content policies
- **MEMORY.md** — Auto-written persistent context (capped at 2000 chars)

## Frontend (React)

### Tech Stack

- React 18 + TypeScript
- Vite (build tooling)
- Tailwind CSS (styling)
- TanStack React Query (data fetching, 5s polling)
- React Router (client-side routing)
- Lucide React (icons)

### Project Structure

```
src/
├── App.tsx                 Main layout, nav bar, routes
├── pages/
│   ├── Dashboard.tsx       Agent grid with status cards
│   ├── AgentDetail.tsx     Activity log, config, MD files, controls
│   ├── Logs.tsx            System logs viewer with filters
│   ├── Setup.tsx           Agent configuration
│   └── Register.tsx        Moltbook registration
├── hooks/
│   └── useBackend.ts       React Query hooks for all API calls
├── components/
│   ├── StatCard.tsx         Dashboard stat cards
│   └── StatusDot.tsx        Online/offline indicator
└── types.ts                TypeScript type definitions
```

## Development

```bash
# Frontend
npm install
npm run dev        # dev server with hot reload
npm run build      # type-check + production build

# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8082
```

The dev server expects both the ecdysis backend and llm-manager backend to be reachable.

## CI/CD

GitHub Actions workflow (`.github/workflows/build.yaml`) runs on Mac Mini ARM64 runner:

1. **Test** — `npm install && npm run build` (type-check)
2. **Build** — Docker build + push for frontend (`amerenda/ecdysis-frontend`) and backend (`amerenda/ecdysis-backend`)
3. **Deploy** — PR to `k3s-dean-gitops` updating image tags → ArgoCD syncs

### Deployments

| Component | Image | Replicas | Namespace |
|-----------|-------|----------|-----------|
| Frontend | `amerenda/ecdysis-frontend` | 2 | ecdysis |
| Backend | `amerenda/ecdysis-backend` | 2 | ecdysis |
| Frontend UAT | `amerenda/ecdysis-frontend` | 1 | ecdysis |
| Backend UAT | `amerenda/ecdysis-backend` | 1 | ecdysis |

### Nginx Routing (ConfigMap)

The frontend nginx config is managed via a ConfigMap (`ecdysis-nginx`) in the gitops repo, NOT the Dockerfile's `nginx.conf`. Update `k3s-dean-gitops/apps/ecdysis/frontend/configmap-nginx.yaml` to change routing.

## UAT Environment

UAT runs alongside prod in the same namespace with separate services, databases, and nginx routing.

| Component | Prod Service | UAT Service |
|-----------|-------------|-------------|
| Frontend | `ecdysis.amer.dev` | `ecdysis-uat.amer.dev` |
| Backend | `ecdysis-backend:8082` | `ecdysis-backend-uat:8082` |
| Database | `ecdysis` | `ecdysis_uat` |

UAT nginx routes to UAT backend services and the llm-manager UAT backend (not prod).

### Resetting UAT Database

A k8s Job wipes and seeds the UAT database with test data (6 agent slots, sample activity, system logs). The seed SQL has a safety check that aborts if the database name doesn't contain "uat".

```bash
# Delete previous job run (if any), then create new one
kubectl delete job ecdysis-uat-db-reset -n ecdysis --ignore-not-found
kubectl apply -f k3s-dean-gitops/apps/ecdysis/ecdysis-backend-uat/jobs/reset-db-job.yaml
kubectl logs -n ecdysis -l app=ecdysis-uat-db-reset -f
```

Seed data includes:
- 6 agent slots with test personas (TestBot Alpha through Zeta)
- Karma values and state for each slot
- Sample activity log entries (heartbeats, posts, comments, errors)
- Sample system logs (INFO, WARNING, ERROR)

### Prerequisites

The UAT database and credentials must exist:
- Cloud SQL database: `ecdysis_uat` with user `ecdysis_uat`
- Bitwarden secret: `dean-cloud-sql-ecdysis-uat-password` (synced via ExternalSecret to `cloud-sql-postgres-credentials-uat` in the ecdysis namespace)

## Database

PostgreSQL (Cloud SQL) with tables:
- `moltbook_configs` — Agent slot configuration (6 rows)
- `moltbook_state` — Runtime state (karma, post times, heartbeat)
- `moltbook_activity` — Activity log entries
- `moltbook_peer_posts` — Tracked peer posts for engagement
- `moltbook_peer_interactions` — Like/comment tracking
- `system_logs` — DB-backed system logs from all pods
