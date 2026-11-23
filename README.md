# SecureCargo

**Physics-tested cargo securement.**

SecureCargo ("Carga Segura" in Brazilian Portuguese) is a physical AI system that checks, before a trip,
whether a truck's cargo is well distributed and properly secured. It covers open bodies, platforms, box
trucks and curtain-siders, and checks the load against the rules of Brazil (the default), the United States
or the European Union.

The loop is **perceive → simulate → plan**:

1. **Perceive** — the driver takes one or two photos of the load; Claude vision reads the truck, the cargo
   units and the lashings already in place. The driver confirms the truck and gives the weight (a photo
   cannot show weight; the AI never guesses one).
2. **Simulate** — a [MuJoCo](https://mujoco.org) physics simulation runs the load through seven trip
   situations (emergency braking, lane change, sharp curve, pothole, speed bump, mountain descent in heavy
   rain, long vibration on a dirt road) and records what slides, tips, rolls or overloads a lashing.
3. **Plan** — a planner finds the smallest change that makes the load hold in all seven situations and
   comply with the rules, and proves it by simulating it again.

Every failure is explained (what happens, why, the consequence and the fix). The result can be shared,
turned into a load certificate with a verification hash, and followed by the carrier's or the insurer's
manager in a dashboard.

> SecureCargo is a decision-support tool, not an engineering certification.

Built for [Hack Brasil 2026](https://hackbrasil.com), Logistics & Automation track.

**Live:** <https://securecargo.app> · API health: <https://api.securecargo.app/health>

## Try it

No account and nothing to install:

- **Demo** — "Try the demo" on the landing page signs you in as a demo driver in one click and opens a new
  inspection; on the sign-in page (<https://securecargo.app/app/sign-in>), "Enter as demo driver" and "Enter
  as demo insurer" do the same for either role. Both open the seeded organization "Demo Fleet", with drivers
  and inspections already in it. What you create there is deleted after 24 hours.
- **Sample photos** — "New inspection" → "Try with a sample photo" runs six real photographs of loads end
  to end, from recorded analyses, even signed out.
- **Explorer** — <https://securecargo.app/app/explorer>: build any load and test it live in the browser.
- **Examples** — <https://securecargo.app/app/examples>: fourteen loads, each as loaded and fixed.

The site is in English and Brazilian Portuguese (`/pt-BR`).

## What it does

### Inspection (drivers, phone first)

One question per screen at `/app/new`:

- **Photo** — take or upload one to four photos ("full side" and "rear three-quarter" are suggested; one
  is enough). The guides that show how to frame the truck are drawn from the 3D truck model. Before
  anything is uploaded, the phone checks the photo for darkness, blur, distance and cargo cut off at the
  sides, and asks "Is the whole load in the photo?". The photo is re-encoded on the phone and its
  metadata (EXIF, GPS) stripped again by the API before it is stored.
- **Truck** — size cards (VUC, 3/4, toco, truck, semi-trailer, with length, axle count and gross weight),
  then body style (open with low sides, open with a tall rack, platform, box truck, curtain-sider), drawn to
  scale from the simulation's own truck catalog. The AI's guess is preselected; saved trucks ("My trucks",
  with bed length, headboard height and lashing points) come first.
- **Weight** — typed in kg, read from a photo of the DANFE invoice (shown for confirmation, never made up),
  or "I don't know": an estimated range, simulated at its upper bound and labelled "weight estimated".
- **Result** — straight away, with a one-line summary of what was read and "Wrong reading? Correct it",
  which opens the load editor.

Details: [docs/inspection.md](docs/inspection.md).

### Result

- **Three verdicts, the same everywhere** (lists, dashboard, share page, certificate): approved (arrives
  intact and complies), holds but out of compliance (the physics holds, a rule fails), does not arrive
  intact (any physical failure). Plus one sentence naming the main problem.
- **Simulation** — one tab per situation, next to the 3D replay: the speed, what happens and the reason in
  a plain sentence, with the forces from the run behind "Show the numbers". "Try another situation" offers
  the road, weather, speed and event choices that change the physics.
- **Checklist** — nested by theme and grouped by status: how the load is secured, weight and axles (with
  bars per axle group), the seven situations, protection (mat, edge protectors, headboard height) and
  dimensions. Each item has a plain explanation, the article or standard it comes from and the fix. A rule
  is never failed on a value nobody gave (a missing headboard height is "to confirm").
- **Fix** — "How to make it safe" lists the smallest set of changes: candidates are tried in order of
  effort (move units → more straps → anti-slip mat → diagonals → chains, or spread a stacked load) and any
  step that is not needed is dropped. "Simulate with the fix" shows the proof; "I fixed it: take a new photo"
  creates a linked re-inspection, and only an approved re-inspection marks the first one "fixed and proven".
- **Share** — a public summary link (no driver name unless the organization allows it) and a WhatsApp share.

### Explorer and examples

- **Explorer** (`/app/explorer`) — a load editor and a live simulation in one page. Pick the truck, road,
  weather, speed and event; add, duplicate, remove and drag units of any cargo type; set each lashing by
  hand (device, route over the load, anchor point, angles) or let the defaults place them. The axle loads
  and the centre of mass move as you edit, and the rules are checked on paper at once. "Test the whole
  trip" runs the seven situations on the server and marks the failing units and lashings in the top view.
  "Make it as safe as possible" asks the planner for a fix and, when the load cannot pass on its own truck,
  also tries a bigger truck of the same family and fewer units (the rest on a second trip), each proven by
  the planner and ranked. Any configuration is a shareable URL.
- **Examples** (`/app/examples`) — fourteen loads (pallets, a tall cabinet, ropes, a steel coil, a machine at
  the rear, a box truck of cartons, a dirt road, an anti-slip mat, a full mountain trip in the rain, a
  curtain-sider, a potholed road, an overloaded strap, US steel coils, EU pallets in a curtain-sider), each
  as loaded and fixed, with a clip of the realistic replay of both versions, a link to MuJoCo's own render
  and "Open in explorer". Every fixed version complies with its country's rules. The coverage matrix
  ([docs/coverage.md](docs/coverage.md)) shows that each of the 66 supported options appears in at least one
  example.

### 3D replay and live lab

- **Replay** (`/app/scenarios/<id>`) — the truck drives on a road rebuilt from the run's own accelerations
  (lane change, curve, grade, pothole and bump), with the road surface and the weather of the run, a sky,
  fields and roadside trees. Lashings are coloured by tension and drawn on the surface of round cargo.
  Each replay opens on the whole truck; it can be zoomed (buttons, Ctrl + scroll, pinch). A semi-trailer
  turns about its kingpin in the scene; this articulation is visual only, the simulation models the bed.
  A realistic and an engineering view, three charts on the replay clock, and the verdict with its margins.
- **Live lab** (`/app/lab/<id>`) — the same model stepped in the visitor's browser by the official MuJoCo
  WebAssembly build (`@mujoco/mujoco`, the version the server runs). Changing the speed, road surface,
  event, straps per unit, pretension, mass or anti-slip mat re-runs it at once; a unit can be pushed by
  hand. Browser results are labelled "live, not certified"; on the eight demo runs of
  [docs/validation.md](docs/validation.md) ("Browser vs. server") they equal the server's, and a headless
  Chromium test in CI keeps them within a documented tolerance. Without WebAssembly or WebGL, or on a slow
  device, the page falls back to the server's run and to static results.
- On phones and tablets the replays, the lab, the explorer and the example clips wait for a tap on Play;
  on a computer they start by themselves. The scene renders at a lower quality on phones and weak GPUs
  (no shadows, capped pixel ratio, paused when hidden). Frame rates have not been measured on a physical
  phone.

### Rules

Each check has a stable code, the article it comes from, an English message translated in the UI, and tests
for a passing and a failing case. Switching country re-runs only the rules; the physics is the same.

- **Brazil** (default) — CONTRAN Resolution 945/2022 (cargo securing, issued by Brazil's National Traffic
  Council): no ropes as lashings, a safety factor of 2 on lashing capacity, four lashing terminals per unit
  on open bodies, anchoring to the metal frame, diagonals or blocking on open bodies and wherever the load
  can travel, headboard strength and cargo above the headboard. CONTRAN Resolution 882/2021: axle group
  limits (including the semi's steer axle), gross weight and dimensions, with axle loads from beam statics.
- **United States** — 49 CFR 393 subpart I (cargo securement: lashings judged by working load limit and
  breaking strength, van front walls by 393.114), 23 CFR 658.17 and the bridge formula, 658.15 and 393.87; five US truck presets and US units
  (lb, ft/in, mph, lbf).
- **European Union** — Directive 2014/47/EU Art. 13 and Annex III (with EN 12195-1, EN 12642 L/XL and
  EN 12640), with the roadside deficiency class (minor, major, dangerous) of every failing check, and
  Directive 96/53/EC Annex I weights and dimensions; five EU presets, lashings in daN.
- **EN 12195-1** is shown on every result as advice: the number of lashings the standard's formula asks for.
  In Brazil mode it is labelled with ABNT NBR 15883-1:2022 (Brazil's lashing-force standard, voluntary, not
  law), whose foreword says it is based on EN 12195-1; the EN 12195-1 method and numbers are used.

Where a legal text gives no number (for example how far a gap must be to need diagonals), the reading is
ours, documented and tested; the remaining assumptions are listed at the end of
[docs/coverage.md](docs/coverage.md). The site explains the rules at `/rules` and the method at
`/methodology`.

### Managers, certificates and accounts

- **Manager dashboard** (`/app/org`, desktop first) — for a carrier or an insurer: numbers for 7, 30 or 90
  days, the weekly trend, the most common failures and one row per driver; alerts for loads that failed and
  have no proven fix after N hours; every inspection with filters, search and CSV export; members,
  invitations and policies (for example "require 2 photos" or "no certificate when out of compliance"); an
  audit trail of the AI reading against the driver's edits. Details: [docs/dashboard.md](docs/dashboard.md).
- **Certificate** — for an approved, or fixed and proven, inspection: the record (truck, cargo, photo hash,
  situations, every check with its article, axle loads, the fix) with the SHA-256 of its canonical JSON, a
  PDF made in the browser with a QR code, and a public page at `/verify/<id>` that recomputes the hash.
- **Accounts and roles** — sign-in by email and password ([Clerk](https://clerk.com)); a driver (`member`)
  sees only their own inspections, a manager (`org_admin`) every inspection of their organization, nobody
  another organization's data. A new account creates its company or joins by invitation, and can delete
  itself (the organization keeps its inspections, anonymized). Authorization is enforced in the API on
  every endpoint and each rule has a test.
- **Demo sessions** — the demo buttons get a 24-hour session issued by the API, with its own sandbox: no
  Clerk account, and what a visitor creates is purged after 24 hours.
- **Credit protection** — only a real photo analysis calls the Claude API. Answers are cached by photo
  hash; each user has a daily quota (5 by default, configurable per user and per organization); a monthly
  budget cap computed from recorded usage and a kill switch both turn analysis into "demo mode" with the
  sample photos. Anonymous endpoints are rate-limited by IP. The platform admin page (`/app/admin`) shows
  usage against the cap, usage per user, quotas, blocking and the kill switch.
- **Site** — landing page, privacy policy, terms, cookies, methodology and rules pages, and a contact form
  (Cloudflare Turnstile, a honeypot and an hourly limit per IP).

## How it works

```
browser (Next.js on Vercel)
  ├─ static results in /demo ............ replays, examples and samples work with the API down
  ├─ MuJoCo WebAssembly .................. live lab and explorer
  └─ api.securecargo.app ─► Cloudflare Worker (TypeScript, Hono)
                              ├─ Clerk session check, demo sessions, authorization
                              ├─ D1 (records) and a private R2 bucket (photos, results)
                              ├─ Claude API (photo and invoice reading), quotas, budget cap
                              └─ Cloudflare Containers: FastAPI + MuJoCo (stateless physics)
                                   one instance per situation, so a battery runs in parallel
```

- **Same model everywhere.** The server turns a scenario into an MJCF document and a run plan (bed motion
  for every 2 ms step, lashing parameters, thresholds) and simulates exactly that document; the browser
  loads the same document into MuJoCo WebAssembly. `frontend/lib/live/` mirrors
  `backend/physics/simulate.py` step for step.
- **Physics.** Cargo units are rigid bodies (boxes, or cylinders that roll or stand), lashings are tendons
  with pretension and a capacity, the bed is driven by the trip's accelerations. Bodies: flatbed, box truck
  and curtain-sider in five Brazilian sizes plus the US and EU presets. Restraints: top-over and direct
  (diagonal) straps, chains, rope, blocking, anti-slip mat, coil cradle, and combinations. Validated against
  the closed-form calculations of EN 12195-1: the number of straps the formula asks for is where the
  simulation flips from fail to pass, and the sliding threshold agrees within 0.3 %; a coil's rolling and
  the braking at which it climbs a chock agree within 1.1 %. Tables: [docs/validation.md](docs/validation.md);
  model and the source of every number: [docs/physics-model.md](docs/physics-model.md).
- **Perception.** One structured-JSON Claude vision call per inspection, with no weight field in its
  schema. The model was chosen by measurement on 21 photos at phone resolution:
  [docs/perception-eval.md](docs/perception-eval.md) (accuracy per measure and cost per photo).

### Known limits

- The simulation has been compared with the standard's own model, not with physical tests.
- Photo reading is imperfect: on the evaluation set the model counted the units exactly in 6 of 14 photos
  and named the kind of restraint right in 18 of 21. The result is built to stay correct for whatever is
  read, and the driver can correct the reading.
- Straps are drawn on the surface of round cargo, but the physics still anchors them at box corners.
- Cargo nets are not supported (no open source for their restraint was found).
- The planner tries a bounded set of candidates; some loads end "holds, but out of compliance" or with no
  proven fix.

## API

The physics service (FastAPI, reached only through the Worker in production; interactive docs at `/docs`
when run locally):

- `POST /simulate` — a load scenario and a trip event in; verdict, per-unit slide and tilt, peak lashing
  forces and 30 fps keyframes out. Deterministic, cached by the hash of the inputs.
- `GET /scenarios/demo`, `GET /scenarios/{id}/mjcf`, `POST /mjcf` — the gallery examples and the live model
  the browser steps (`?format=xml` returns the MJCF alone).
- `GET /explorer?<configuration>`, `POST /explorer/draft` — an explorer configuration or a load draft,
  turned into a scenario, a trip event and the live model.
- `POST /perception/draft` — a photo analysis turned into a load draft on the confirmed truck.
- `POST /battery`, `/battery/situation`, `/battery/checks` — the seven situations, one of them, or the rules
  only.
- `POST /plan`, `/plan/candidates` — the planner's proven fix, or what it would try.
- `GET /health` — API and MuJoCo versions.

The Worker adds the application routes: `/me`, `/demo/session`, `/inspections` (photos, analysis, invoice,
draft, country, simulate, fix, share, certificate, audit, CSV export), `/trucks`, `/org` (overview, alerts,
invitations, policies), `/orgs`, `/admin`, `/share/:token`, `/verify/:id`, `/certificates/:id` and
`/contact`. The public `/battery` and `/plan` (sample photos, the explorer) are rate-limited by IP.

## Stack

| Part     | Technology                                                                                   |
| -------- | -------------------------------------------------------------------------------------------- |
| Physics  | Python 3.11, FastAPI, Pydantic, MuJoCo, [uv](https://docs.astral.sh/uv/), ruff, mypy, pytest |
| API      | Cloudflare Workers (TypeScript, Hono), D1, R2, Rate Limiting, Email Routing, Clerk, Anthropic SDK, Vitest |
| Frontend | Next.js (App Router), TypeScript (strict), Tailwind CSS, shadcn/ui, next-intl, React Three Fiber, MuJoCo WebAssembly, pdf-lib, Vitest, Playwright |
| Hosting  | Vercel (frontend), Cloudflare Containers (physics), Cloudflare Workers (API)                 |
| CI       | GitHub Actions                                                                               |

## Repository layout

```
backend/            physics service (FastAPI) and the API Worker
  app/              API routes, configuration, storage interface
    scenario/       load scenario schema (Pydantic, versioned)
    explorer/       explorer configuration and load draft -> scenario
    inspection/     the seven-situation battery and the three-state verdict
    demo/           the gallery examples
  scene/            scenario -> MJCF scene generator
  physics/          MuJoCo simulation, trip conditions, metrics, verdict, explanations, EN 12195-1,
                    live.py (the MJCF and run plan served to the browser)
  rules/            CONTRAN 945 and 882 checks, FMCSA 393 and US weights, EU Annex III and 96/53/EC,
                    EN 12195-1, checklist themes per country
  planner/          minimal fix, proven in simulation
  perception/       photo analysis -> load draft
  scenarios/demo/   the gallery examples as JSON fixtures
  scripts/          fixtures, static demo results, sample photos, demo inspections, coverage, videos
  tests/
  worker/           Cloudflare Worker: auth, authorization, D1 migrations, R2, perception, quotas,
                    dashboard, certificate, contact; seed of the demo organization; Vitest tests
frontend/           Next.js app
  app/[locale]/     pages: landing, legal pages, /verify, and the app at /app
  components/       site chrome, landing, app areas, inspection flow, explorer, scene, lab
  lib/              API clients, inspection logic, explorer, live MuJoCo engine, scene motion and looks
  e2e/              Playwright: browser vs. server parity, explorer, inspection flow
  public/demo/      simulated examples, samples, clips and live models as static files
  scripts/          photo treatment, example clip recording, MuJoCo WebAssembly copy
  messages/         en.json (default) and pt-BR.json — every UI string lives here
docs/               inspection, dashboard, physics model, validation, perception evaluation,
                    coverage, design system
.github/workflows/  CI
```

## Run locally

Requirements: [uv](https://docs.astral.sh/uv/getting-started/installation/) (it installs Python 3.11 by
itself), Node.js 22+, [pnpm](https://pnpm.io/installation) and, for the container image and the Worker's
local container, Docker.

### Physics service

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Check it: <http://localhost:8000/health> returns `{"status":"ok","version":"…","mujoco_version":"…"}`.
Interactive API docs: <http://localhost:8000/docs>. Optional settings go in `backend/.env` (see
`backend/.env.example`).

Simulate a demo scenario from the command line:

```bash
curl -s localhost:8000/scenarios/demo \
  | jq '{scenario: .scenarios[0].as_loaded, event: .scenarios[0].event}' \
  | curl -s -X POST localhost:8000/simulate -H 'content-type: application/json' -d @- \
  | jq '{cpu_time_s, verdict: .result.verdict}'
```

After changing the physics, the rules or the demo scenarios, regenerate the fixtures and the static results
the site ships with (tests fail if they are stale):

```bash
uv run python -m scripts.build_demo_fixtures   # backend/scenarios/demo/*.json
uv run python -m scripts.precompute_demo       # frontend/public/demo/*.json and docs/coverage.md
uv run python -m scripts.render_demo_videos    # frontend/public/demo/video/*.mp4 (needs EGL and ffmpeg)
uv run python -m physics.validation            # tables of docs/validation.md
```

After a change to the 3D scene, re-record the example clips (`frontend/scripts/record-example-clips.mjs`)
and redraw the photo guides (`pnpm run guides` in `frontend/`).

### API Worker

```bash
cd backend/worker
pnpm install
cp .dev.vars.example .dev.vars   # then fill in the values
pnpm dev
```

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

Open <http://localhost:3000> (English) or <http://localhost:3000/pt-BR> (Brazilian Portuguese).

The API base URL comes from `NEXT_PUBLIC_API_URL` and defaults to `http://localhost:8000` (the physics
service: replays, lab, explorer). Sign-in, inspections and dashboards need the Worker; without the Clerk
keys (`frontend/.env.example`) the site runs with sign-in off. Copy `frontend/.env.example` to
`frontend/.env.local` to change them.

### Checks

```bash
# backend/
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest

# backend/worker/
pnpm typecheck && pnpm test

# frontend/
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm exec playwright install chromium   # once
pnpm e2e                                # needs the build above
```

CI runs the same commands on every push to `main`, plus a build of the container image.

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
  `securecargo.app`. The API base URL is the `NEXT_PUBLIC_API_URL` environment variable of the Vercel project;
  a production build without the Clerk keys fails on purpose.
- **API and physics** — the Worker in `backend/worker/` serves `api.securecargo.app` and starts the physics
  containers on [Cloudflare Containers](https://developers.cloudflare.com/containers/) on demand. Only the
  Worker can reach them. A container stops after a few idle minutes, so the first call after a pause takes
  a few seconds longer; the landing page sends a background request to `/health` to start one early. An
  hourly cron deletes demo data older than 24 hours.

Deploying the API needs Docker running locally and a Wrangler login (`pnpm exec wrangler login`):

```bash
cd backend/worker
pnpm install
pnpm run deploy
```

Secrets (Clerk, Anthropic, demo session key, platform admin emails, Turnstile) live only in the Cloudflare
and Vercel secret stores. The browser origins allowed to call the API are the `CORS_ORIGINS` variable in
`backend/worker/wrangler.jsonc`. Every deploy serves from fresh container instances; the previous ones stop
by themselves once idle.

### Git hooks

```bash
git config core.hooksPath .githooks
```

## AI usage

Hack Brasil allows and recommends AI tools. This project is built with
[Claude Code](https://claude.com/claude-code) using Anthropic's Claude Fable model as a coding assistant,
under the direction and review of the repository owner. At runtime, the product uses the Claude API only to
read cargo photos and the gross weight on an invoice photo; the physics simulation, the rule checks and the
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
| A backhoe on a semi-trailer | [Tayssir Kadamany](https://www.pexels.com/@sirokad/) | [Pexels photo](https://www.pexels.com/photo/yellow-construction-vehicle-on-flatbed-trailer-38095094/) |
| Lumber, strapped | [Riley Crawford](https://unsplash.com/@ricrawfo) | [Unsplash photo](https://unsplash.com/photos/white-truck-on-gray-road-during-daytime-99HLgU4IHLY) |
| Concrete pipes on a crane truck | MAK | [Unsplash photo](https://unsplash.com/photos/a-large-truck-driving-down-a-street-next-to-tall-buildings-DM5ZHQJvaE4) |
| Steel racks on a semi-trailer | X1ntao ZHOU | [Pexels photo](https://www.pexels.com/photo/truck-with-cargo-on-icelandic-road-32126810/) |

## License

[MIT](LICENSE)
