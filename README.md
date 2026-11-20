# SecureCargo

**Physics-tested cargo securement.**

SecureCargo ("Carga Segura" in Brazilian Portuguese) is a physical AI system that checks, before a trip,
whether a truck's cargo is well distributed and properly secured. It targets open-body and flatbed trucks
and Brazilian road-freight rules.

The loop is **perceive → simulate → plan**:

1. **Perceive** — the driver takes a photo of the truck bed; AI suggests the cargo units and the straps
   already in place, and the driver confirms or edits them.
2. **Simulate** — a [MuJoCo](https://mujoco.org) physics simulation runs the truck bed through hard braking,
   curves, potholes and road conditions and records what slides or tips over.
3. **Plan** — a planner recommends placement and lashing that pass every simulated event and the Brazilian
   rules: CONTRAN Resolution 945/2022 (cargo lashing requirements issued by Brazil's National Traffic
   Council) and CONTRAN Resolution 882/2021 (axle load limits).

Every failure is explained (what happens, why, the consequence and the fix), and the result is a shareable
load certificate plus a dashboard for carriers and cargo insurers.

> SecureCargo is a decision-support tool, not an engineering certification.

Built for [Hack Brasil 2026](https://hackbrasil.com), Logistics & Automation track.

## Status

The project is being built in phases during the hackathon. What exists today:

- `backend/` — FastAPI service with `GET /health` (reports the API and MuJoCo versions), a storage
  interface with SQLite and in-memory backends, and a linux/amd64 Docker image.
- `frontend/` — Next.js app with the landing page at `/`, the app shell at `/app` (shows the API health),
  and an English / Brazilian Portuguese language switcher.
- `backend/worker/` — Cloudflare Worker that starts the API container on demand and forwards requests to it.
- CI on every push to `main`.

Physics, rules, planner, photo analysis, certificate and dashboard come next.

## Stack

| Part     | Technology                                                                                   |
| -------- | -------------------------------------------------------------------------------------------- |
| Backend  | Python 3.11, FastAPI, Pydantic, MuJoCo, [uv](https://docs.astral.sh/uv/), ruff, mypy, pytest |
| Frontend | Next.js (App Router), TypeScript (strict), Tailwind CSS, shadcn/ui, next-intl, Vitest        |
| Hosting  | Vercel (frontend), Cloudflare Containers (backend), Cloudflare R2 (photos and certificates)  |
| CI       | GitHub Actions                                                                               |

## Repository layout

```
backend/            FastAPI service
  app/              API routes, configuration, storage interface
  scene/            scenario JSON -> MJCF scene generator
  physics/          MuJoCo simulation
  rules/            CONTRAN checks and axle loads
  planner/          load advisor and lashing planner
  perception/       photo -> cargo and strap suggestions
  tests/
  worker/           Cloudflare Worker that routes requests to the API container
frontend/           Next.js app
  app/[locale]/     pages (landing at /, app at /app)
  components/       UI components
  i18n/             locale routing
  messages/         en.json (default) and pt-BR.json — every UI string lives here
.github/workflows/  CI
```

## Run locally

Requirements: [uv](https://docs.astral.sh/uv/getting-started/installation/) (it installs Python 3.11 by
itself), Node.js 22+, [pnpm](https://pnpm.io/installation) and, only for the container image, Docker.

### Backend

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Check it: <http://localhost:8000/health> returns `{"status":"ok","version":"…","mujoco_version":"…"}`.
Interactive API docs: <http://localhost:8000/docs>.

Optional settings go in `backend/.env` (see `backend/.env.example`).

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

Open <http://localhost:3000> (English) or <http://localhost:3000/pt-BR> (Brazilian Portuguese).
The app page at <http://localhost:3000/app> calls the backend's `/health`.

The API base URL comes from `NEXT_PUBLIC_API_URL` and defaults to `http://localhost:8000`. To change it,
copy `frontend/.env.example` to `frontend/.env.local`.

### Checks

```bash
# backend/
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest

# frontend/
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

### Backend container

```bash
cd backend
docker build -t securecargo-api .
docker run --rm -p 8000:8080 securecargo-api
```

The image is pinned to linux/amd64, the platform Cloudflare Containers run.

## Deployment

- **Frontend** — Vercel builds the `frontend/` directory on every push to `main`. The API base URL is the
  `NEXT_PUBLIC_API_URL` environment variable of the Vercel project.
- **Backend** — the Docker image runs on [Cloudflare Containers](https://developers.cloudflare.com/containers/)
  behind the Worker in `backend/worker/`. The container starts on the first request and stops after ten
  minutes without traffic, so the first call after a pause takes a few seconds longer.

Deploying the backend needs Docker running locally and a Wrangler login (`pnpm exec wrangler login`):

```bash
cd backend/worker
pnpm install
pnpm run deploy
```

The browser origins allowed to call the API are the `CORS_ORIGINS` variable in `backend/worker/wrangler.jsonc`.
Every deploy serves from a fresh container instance; the previous one stops by itself once it is idle.

### Git hooks

```bash
git config core.hooksPath .githooks
```

## AI usage

Hack Brasil allows and recommends AI tools. This project is built with
[Claude Code](https://claude.com/claude-code) using Anthropic's Claude Fable model as a coding assistant,
under the direction and review of the repository owner. At runtime, the product uses the Claude API only to
analyze cargo photos (and optionally to word explanations); the physics simulation, the rule checks and the
planner are deterministic code.

## License

[MIT](LICENSE)
