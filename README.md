# ecdysis

React frontend for managing LLM agents on Moltbook. Provides a dashboard for monitoring agent status, configuring agent slots, and registering new agents with the Moltbook platform.

The name "ecdysis" refers to the shedding of an outer layer -- fitting for a management UI that wraps around the Moltbook agent system.

## What It Does

- **Dashboard** -- Overview of all agent slots (1-6), GPU status, loaded models, and VRAM usage
- **Setup** -- Configure agent parameters (model, temperature, etc.) and start/stop agents
- **Register** -- Register agents with the Moltbook platform and manage their lifecycle

The frontend talks to the `llm-manager` backend via nginx reverse proxy (`/api/*` requests are forwarded to the backend service).

## Tech Stack

- React 18 + TypeScript
- Vite (build tooling)
- Tailwind CSS (styling)
- TanStack React Query (data fetching)
- React Router (client-side routing)

## Development

```bash
# Install dependencies
npm install

# Start dev server (hot reload)
npm run dev

# Type-check and build for production
npm run build

# Preview production build
npm run preview
```

The dev server expects the llm-manager backend to be reachable. Configure a proxy or run the backend locally.

## Project Structure

```
src/
├── App.tsx              Main layout with nav bar and routes
├── pages/
│   ├── Dashboard.tsx    Agent overview, GPU stats
│   ├── Setup.tsx        Agent configuration
│   └── Register.tsx     Agent registration with Moltbook
├── hooks/
│   └── useBackend.ts    React Query hooks for all backend API calls
└── types.ts             TypeScript type definitions
```

## CI/CD

The GitHub Actions workflow (`.github/workflows/build.yaml`) runs on every push to `main`:

1. **Test** -- Runs `npm install` and `npm run build` to verify the project compiles.
2. **Build** -- Builds a Docker image using Kaniko on self-hosted ARC runners and pushes to `amerenda/ecdysis:frontend-<tag>`.
3. **Deploy** -- Opens a PR against the `k3s-dean-gitops` repo, updating the image tag in `apps/ecdysis/deployment-frontend.yaml`. Merging the PR triggers ArgoCD to roll out the new version.

Release tags (`release/v*`) produce a versioned image tag instead of a SHA-based one.

## Docker Image

The production image is a multi-stage build:

1. Node 20 Alpine builds the Vite project
2. nginx Alpine serves the static files with a custom `nginx.conf`

```bash
docker build -t amerenda/ecdysis:frontend-latest .
```
