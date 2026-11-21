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
  - `GET /scenarios/demo` — the nine gallery examples, each "as loaded" and "fixed".
  - `GET /explorer?<configuration>` and `POST /explorer/draft` — the explorer: one choice per dimension
    (body, truck, cargo, position, securing, speed, road, weather, event) or an edited load draft, turned
    into a scenario, a trip event and the live model the browser steps.
  - `POST /mjcf` and `GET /scenarios/{id}/mjcf` — the exact MJCF the server simulates for a scenario and
    event, with its run plan (bed motion for every 2 ms step, lashing parameters, thresholds, rule
    checks), so that a second MuJoCo can repeat the run. `?format=xml` returns the MJCF alone.
  - `GET /health` — API and MuJoCo versions.
- **Physics core** — a MuJoCo simulation of the truck bed, cargo units and lashings under seven trip
  events (emergency braking, lane change, sharp curve, pothole, speed bump, mountain descent, long
  vibration) and full trips made of several of them, on five road surfaces. Cargo can be boxes or
  cylinders (coils roll, drums stand), held by straps, chains, rope, chocks, beams or a coil cradle, on a
  flatbed, a box truck or a curtain-sider of four sizes (VUC, toco, truck, semi-trailer). It is validated against the closed-form calculations of EN 12195-1:
  the number of straps the formula asks for is where the simulation flips from fail to pass, and the
  sliding threshold agrees within 0.3 %; a coil's rolling rate and the braking at which it climbs a chock
  agree within 1.1 %. See [docs/validation.md](docs/validation.md) for the tables and
  [docs/physics-model.md](docs/physics-model.md) for the model and the source of every number.
- `frontend/` — Next.js app with the landing page at `/`, the app at `/app` and a replay of each demo
  scenario at `/app/scenarios/<id>`, in English and Brazilian Portuguese: as loaded / fixed toggle; a 3D
  scene where the road moves at the truck's speed, lashings are coloured by tension and each unit shows
  inertia against the friction available; a realistic and an engineering view; a clip of the same run
  drawn by MuJoCo's own renderer; three charts on the replay clock; verdict and margins. The simulated
  scenarios ship as static files in `frontend/public/demo/`, so they replay even when the API is cold or
  down, and the page keeps working without WebGL.
- **Live lab** at `/app/lab/<id>` — the same model stepped in the visitor's browser by the official
  MuJoCo WebAssembly build (`@mujoco/mujoco`, the version the server runs). Changing the speed, the road
  surface, the event, the straps per unit, their pretension, the mass or the anti-slip mat re-runs the
  simulation at once; a cargo unit can be pushed by hand to feel the lashing hold it. Every result shows
  the verdict, the reason in one sentence with the forces, and the EN 12195-1 check. Browser results
  are labelled "live, not certified": on the eighteen demo runs they equal the server's to the last rounded
  digit ([docs/validation.md](docs/validation.md), "Browser vs. server"), and a test in headless Chromium
  keeps it that way. Without WebAssembly, or on a device that is too slow, the page uses the server's
  simulation instead.
- **Explorer** at `/app/explorer` — any combination of the dimensions above, simulated live in the
  browser, with a top-down load editor: drag units on the bed, tap one to add a strap, and watch the axle
  loads and the centre of mass move. The configuration and the edits travel in the URL, so any load is a
  link. It also takes a load draft from outside (a photo analysis, a saved inspection).
- **Gallery** at `/app/examples` — nine examples, each as loaded and fixed, with MuJoCo's own render and the
  coverage matrix ([docs/coverage.md](docs/coverage.md)) of which example shows each option.
- `docs/design.md` — the design system: tokens, type, layout, components, imagery and motion, plus the
  keyframes contract for the 3D replay.
- `backend/worker/` — Cloudflare Worker that starts the API container on demand and forwards requests to it.
- CI on every push to `main`.

Next: photo analysis with accounts and quotas, the planner and the certificate.

## Stack

| Part     | Technology                                                                                   |
| -------- | -------------------------------------------------------------------------------------------- |
| Backend  | Python 3.11, FastAPI, Pydantic, MuJoCo, [uv](https://docs.astral.sh/uv/), ruff, mypy, pytest |
| Frontend | Next.js (App Router), TypeScript (strict), Tailwind CSS, shadcn/ui, next-intl, React Three Fiber, MuJoCo WebAssembly, Vitest, Playwright |
| Hosting  | Vercel (frontend), Cloudflare Containers (backend), Cloudflare R2 (photos and certificates)  |
| CI       | GitHub Actions                                                                               |

## Repository layout

```
backend/            FastAPI service
  app/              API routes, configuration, storage interface
    scenario/       load scenario schema (Pydantic, versioned)
    demo/           loader of the demo fixtures
  scene/            scenario -> MJCF scene generator
  physics/          MuJoCo simulation, event profiles, metrics, verdict, EN 12195-1 formulas,
                    live.py (the MJCF and run plan served to the browser)
  rules/            axle loads (CONTRAN checks come next)
  planner/          load advisor and lashing planner
  perception/       photo -> cargo and strap suggestions
  scenarios/demo/   the nine gallery examples as JSON fixtures (built from app/demo/gallery.py)
  scripts/          fixture generator, static demo precompute
  tests/
  worker/           Cloudflare Worker that routes requests to the API container
frontend/           Next.js app
  app/[locale]/     pages (landing at /, app at /app)
  components/       UI components (site chrome, landing sections, base components)
  content/          hand-made placeholder keyframes (used by tests only)
  lib/live/         MuJoCo WebAssembly engine (mirrors backend/physics/simulate.py), lab controls
  e2e/              Playwright: browser run against server run, in headless Chromium
  public/demo/      simulated demo scenarios and their live models as static JSON (written by the backend)
  scripts/          photo treatment, placeholder keyframes generator, MuJoCo WebAssembly copy
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
uv run python -m scripts.render_demo_videos    # frontend/public/demo/video/*.mp4 (needs EGL and ffmpeg)
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
pnpm exec playwright install chromium   # once
pnpm e2e                                # browser-vs-server parity, needs the build above
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

The sample photos of the inspection flow (`/app/new`, "Try with a sample photo") are shown in colour,
resized to 1568 px with all metadata removed. None shows a face or a readable plate. Unsplash photos are
under the [Unsplash License](https://unsplash.com/license), Pexels photos under the
[Pexels License](https://www.pexels.com/license/).

| Sample | Photographer | Source |
| ------ | ------------ | ------ |
| Crates tied with ropes | [JUNLIN ZOU](https://www.pexels.com/@fangyuanzhiwai/) | [Pexels photo](https://www.pexels.com/photo/colorful-crates-on-truck-in-urban-setting-32444472/) |
| Steel pipes with straps | [Jaime Maldonado](https://unsplash.com/@jamoandres2021) | [Unsplash photo](https://unsplash.com/photos/a-large-truck-with-a-bunch-of-green-pipes-on-the-back-of-it-N53wfGqwtNQ) |
| A backhoe on a low-bed | [Tayssir Kadamany](https://www.pexels.com/@sirokad/) | [Pexels photo](https://www.pexels.com/photo/yellow-construction-vehicle-on-flatbed-trailer-38095094/) |
| Lumber, strapped | [Riley Crawford](https://unsplash.com/@ricrawfo) | [Unsplash photo](https://unsplash.com/photos/white-truck-on-gray-road-during-daytime-99HLgU4IHLY) |

## License

[MIT](LICENSE)
