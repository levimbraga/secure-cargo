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

**Live:** <https://securecargo.app> · API health: <https://api.securecargo.app/health>

## Status

The project is being built in phases during the hackathon. What exists today:

- `backend/` — FastAPI service with a storage interface (SQLite and in-memory) and a linux/amd64 Docker
  image. Endpoints:
  - `POST /simulate` — a load scenario plus a trip event in; verdict, per-unit slide and tilt, peak lashing
    forces and 30 fps keyframes out. Deterministic, cached by the hash of the inputs.
  - `GET /scenarios/demo` — the four demo scenarios, each "as loaded" and "fixed".
  - `GET /health` — API and MuJoCo versions.
- **Physics core** — a MuJoCo simulation of the truck bed, cargo units and lashings under seven trip
  events (emergency braking, lane change, sharp curve, pothole, speed bump, mountain descent, long
  vibration) on five road surfaces. It is validated against the closed-form calculations of EN 12195-1:
  the number of straps the formula asks for is where the simulation flips from fail to pass, and the
  sliding threshold agrees within 0.3 %. See [docs/validation.md](docs/validation.md) for the tables and
  [docs/physics-model.md](docs/physics-model.md) for the model and the source of every number.
- `frontend/` — Next.js app with the landing page at `/`, the app at `/app` and a 3D replay of each demo
  scenario at `/app/scenarios/<id>` (as loaded / fixed toggle, timeline, verdict and margins), in English
  and Brazilian Portuguese. The simulated scenarios ship as static JSON in `frontend/public/demo/`, so they
  replay even when the API is cold or down, and the page still shows every number without WebGL.
- `docs/design.md` — the design system: tokens, type, layout, components, imagery and motion, plus the
  keyframes contract for the 3D replay.
- `backend/worker/` — Cloudflare Worker that starts the API container on demand and forwards requests to it.
- CI on every push to `main`.

CONTRAN rules, planner, photo analysis, certificate and dashboard come next.

## Stack

| Part     | Technology                                                                                   |
| -------- | -------------------------------------------------------------------------------------------- |
| Backend  | Python 3.11, FastAPI, Pydantic, MuJoCo, [uv](https://docs.astral.sh/uv/), ruff, mypy, pytest |
| Frontend | Next.js (App Router), TypeScript (strict), Tailwind CSS, shadcn/ui, next-intl, React Three Fiber, Vitest |
| Hosting  | Vercel (frontend), Cloudflare Containers (backend), Cloudflare R2 (photos and certificates)  |
| CI       | GitHub Actions                                                                               |

## Repository layout

```
backend/            FastAPI service
  app/              API routes, configuration, storage interface
    scenario/       load scenario schema (Pydantic, versioned)
    demo/           loader of the demo fixtures
  scene/            scenario -> MJCF scene generator
  physics/          MuJoCo simulation, event profiles, metrics, verdict, EN 12195-1 formulas
  rules/            axle loads (CONTRAN checks come next)
  planner/          load advisor and lashing planner
  perception/       photo -> cargo and strap suggestions
  scenarios/demo/   the four demo scenarios as JSON fixtures
  scripts/          fixture generator, static demo precompute
  tests/
  worker/           Cloudflare Worker that routes requests to the API container
frontend/           Next.js app
  app/[locale]/     pages (landing at /, app at /app)
  components/       UI components (site chrome, landing sections, base components)
  content/          hand-made placeholder keyframes (used by tests only)
  public/demo/      simulated demo scenarios as static JSON (written by the backend)
  scripts/          photo treatment, placeholder keyframes generator
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

Simulate a demo scenario from the command line:

```bash
curl -s localhost:8000/scenarios/demo \
  | jq '{scenario: .scenarios[0].as_loaded, event: .scenarios[0].event}' \
  | curl -s -X POST localhost:8000/simulate -H 'content-type: application/json' -d @- \
  | jq '{cpu_time_s, verdict: .result.verdict}'
```

After changing the physics or the demo scenarios, regenerate the fixtures and the static results the
site ships with (a test fails if they are stale):

```bash
uv run python -m scripts.build_demo_fixtures   # backend/scenarios/demo/*.json
uv run python -m scripts.precompute_demo       # frontend/public/demo/*.json
uv run python -m physics.validation            # tables of docs/validation.md
```

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

### Landing-page photographs

The photographs are free-license images (see [Photo credits](#photo-credits)) turned into black and white
with grain, or into duotones, by a script. To regenerate them from the originals:

```bash
cd frontend
node scripts/process-photos.mjs /path/to/originals
```

This needs `ffmpeg`. The originals are not in this repository.

### Backend container

```bash
cd backend
docker build -t securecargo-api .
docker run --rm -p 8000:8080 securecargo-api
```

The image is pinned to linux/amd64, the platform Cloudflare Containers run.

## Deployment

- **Frontend** — Vercel builds the `frontend/` directory on every push to `main` and serves it at
  `securecargo.app`. The API base URL is the `NEXT_PUBLIC_API_URL` environment variable of the Vercel project.
- **Backend** — the Docker image runs on [Cloudflare Containers](https://developers.cloudflare.com/containers/)
  behind the Worker in `backend/worker/`, at `api.securecargo.app`. The container starts on the first request
  and stops after ten minutes without traffic, so the first call after a pause takes a few seconds longer.
  The landing page sends a background request to `/health` to start it before the visitor opens the app.

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

## Photo credits

The photographs on the site come from [Unsplash](https://unsplash.com) and are used under the
[Unsplash License](https://unsplash.com/license). They were cropped and converted to black and white or
duotone, with grain added.

| Image | Photographer | Source |
| ----- | ------------ | ------ |
| Hero (cargo straps) | [Haberdoedas](https://unsplash.com/@haberdoedas) | [photo](https://unsplash.com/photos/a-truck-with-a-bunch-of-wires-on-the-back-of-it-520ffcaITVM) |
| Loading dock | [Hannes Egler](https://unsplash.com/@egla) | [photo](https://unsplash.com/photos/closeup-photo-of-parking-lot-nT4k2JDtwTQ) |
| Emergency braking | [Riley Crawford](https://unsplash.com/@ricrawfo) | [photo](https://unsplash.com/photos/white-truck-on-gray-road-during-daytime-99HLgU4IHLY) |
| Weigh station | [iridial](https://unsplash.com/@iridial_) | [photo](https://unsplash.com/photos/three-tires-on-a-large-vehicle-0fiAHT8u48Y) |
| Rope lashing | [Mugabi Owen](https://unsplash.com/@spenz_official) | [photo](https://unsplash.com/photos/thick-rope-tied-with-a-knot-on-metal-bar-KZC9qnKD_-4) |
| Sharp curve | [Zoshua Colah](https://unsplash.com/@zoshuacolah) | [photo](https://unsplash.com/photos/truck-on-a-winding-mountain-road-black-and-white-wmgLXFpLvqo) |

## License

[MIT](LICENSE)
