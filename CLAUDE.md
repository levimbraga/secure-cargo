# CLAUDE.md — SecureCargo (Hack Brasil 2026, Logistics & Automation track)

Repository: github.com/levimbraga/secure-cargo. Product name: SecureCargo ("Carga Segura" in the pt-BR UI).
Domain: securecargo.app (Cloudflare Registrar/DNS). `securecargo.app` = landing, `securecargo.app/app` = app,
`api.securecargo.app` = backend.

## Git rules (non-negotiable)
- **Never** add `Co-Authored-By`, `Claude-Session`, "Generated with Claude Code" or any other AI attribution
  to commit messages, PR titles or PR descriptions. The only author of every commit is the repository owner.
- Commit messages: short imperative English subject (max ~72 chars), optional body explaining why.
- Work directly on `main`: no feature branches, no pull requests. Commit small, run tests, push to `main`.
- Never rewrite published history, never force-push to `main`.

## Language policy (applies to everything)
- **English is the primary language of the entire project:** code, comments, identifiers, commit messages,
  README, docs, UI copy, API messages, the video and the pitch.
- The app has a **language switcher: English (default) and Brazilian Portuguese (pt-BR)**.
  All user-facing strings live in translation files (`frontend/messages/en.json`, `frontend/messages/pt-BR.json`);
  never hard-code UI text. Backend messages return a stable code + English text; the frontend translates by code.
- Brazilian legal names stay as proper nouns (e.g. "CONTRAN Resolution 945/2022"), with a short English
  explanation next to them the first time they appear.

## What the project is
SecureCargo is a **physical AI** system that checks, before a trip, whether a truck's cargo
(open-body / flatbed trucks) is well distributed and properly secured. The loop is **perceive → simulate → plan**:

1. **Perceive:** from a form or a photo of the truck bed, obtain the cargo units (size, weight, position)
   and the straps already in place.
2. **Simulate:** a physics engine (MuJoCo, Python bindings) applies hard braking, cornering and a pothole
   to the truck bed and records what slides or tips over.
3. **Plan:** recommend unit placement (axle loads within legal limits) and lashing (number, position and type
   of straps) following Brazilian rules, validating every candidate plan in simulation.
4. **Record:** produce a shareable "load certificate" (plan + simulation + checks + timestamp) and show trips
   on a dashboard for carriers / insurers.

Users: owner-operator truck drivers and small/mid-size carriers (free for the driver). Payers: carriers,
cargo insurers (mandatory RCTR-C insurance) and risk-management companies.

## Hackathon rules the code must respect
- Public GitHub repository created after 2026-11-04 21:00 (Brasília), all commits from then on.
  **Never** fork, import history, or copy pre-existing private code.
- Third-party open-source code only as dependencies, respecting licenses.
- AI use is allowed and recommended by the rules; the README has a short "AI usage" section
  (built with Claude Code and Fable). This is the only place AI tools are mentioned — never in commits.
- Deadline: 2026-11-30 23:59 (Brasília). Requires a **working online demo** (judges install nothing),
  a video of up to 3 minutes viewable without login, and a clear README. The repo is frozen between
  submission and the final (2026-12-12): no commits in that window.
- MIT license. No real personal data in the demo (no real plates, faces or names).

## Architecture
```
secure-cargo/
├── backend/            # Python 3.11, FastAPI, Pydantic
│   ├── app/            # API routes: /simulate, /scenarios/demo, /plan, /check, /certificate, /trips, /health
│   │   ├── scenario/   # load scenario schema (Pydantic, versioned): bed, units, lashings, trip event
│   │   └── demo/       # loader of the demo fixtures
│   ├── scene/          # scenario -> MJCF (scene generator)
│   ├── physics/        # MuJoCo run, event profiles (conditions/), metrics, verdict, EN formulas, validation
│   ├── rules/          # CONTRAN 945/2022 (lashing) + axle load limits (CONTRAN 882/2021), config with sources
│   ├── planner/        # placement + lashing search with simulation in the loop
│   ├── perception/     # photo -> suggestions (Claude vision) + manual marking support
│   ├── scenarios/demo/ # 4 demo scenarios (JSON): braking, weigh station, rope, sharp curve — also used as
│   │                   # tests. Inside backend/ because the Docker build context is backend/.
│   ├── scripts/        # build_demo_fixtures, precompute_demo (writes frontend/public/demo/)
│   └── tests/
├── frontend/           # Next.js (TypeScript), Tailwind, shadcn/ui, React Three Fiber, next-intl
│   ├── messages/       # en.json (default), pt-BR.json
│   ├── app/driver/     # 5-step flow: truck -> cargo/photo -> straps -> trip test -> fix
│   ├── app/certificate/[id]/
│   ├── app/dashboard/  # carrier / insurer view
│   └── components/viewer3d/
├── docs/               # design.md, physics-model.md (model + sources), validation.md (sim vs. EN 12195-1)
├── .github/workflows/ci.yml
└── README.md
```
- Simulation runs **on the server** and returns keyframes as JSON (position/rotation of each unit and tension
  of each strap per frame, 30 fps); the browser only replays them in 3D. This keeps the demo light and stable.
- Fallback: the main demo scenarios are also exported as static JSON in the frontend, so the replay works
  even if the backend is down during judging.
- Deploy: own domain bought on Cloudflare Registrar, DNS on Cloudflare. Root = landing page, `/app` = driver
  app, certificate and dashboard (Vercel, one Next.js project); `api.<domain>` = FastAPI + MuJoCo in Docker on
  Cloudflare Containers (Workers Paid plan; a thin Worker routes requests to the container). Photos and
  certificates in Cloudflare R2. Fallback host for the backend: Render or Hugging Face Spaces.
  Containers scale to zero, so keep demo scenarios cached/static to hide cold starts.
  Until the domain exists, use the free *.vercel.app URL.
  Deploy a hello-world on day 1. Health route and cached demo scenarios. Must stay online through judging.

## Physics (backend/physics)
- Engine: MuJoCo. The scene is an MJCF generated by code from the scenario JSON (the same MJCF can be loaded
  in the browser via `@mujoco/mujoco` as a stretch goal).
- Truck bed = body driven by slide joints with prescribed acceleration; floor, rebatable side rails and a
  headboard (front panel), with dimensions per truck type.
- Cargo units = rigid boxes with mass and a configurable friction coefficient per material pair
  (wood-wood, metal-wood, anti-slip mat).
- Straps = MuJoCo spatial tendons between two anchor points, passing over the unit, with stiffness and a rest
  length shorter than the installed length (creates pretension, STF); log tension vs. lashing capacity (LC).
  Fallback if unstable: equivalent vertical clamping force.
- Trip-condition library (`backend/physics/conditions/`): every condition is data that maps to physics inputs,
  never new simulation code. Dimensions:
  - speed: 40 / 60 / 80 / 100 km/h (braking intensity; lateral accel = v^2 / r on curves);
  - road type: straight highway, curvy highway, mountain descent (long downhill, repeated braking),
    dirt/gravel road, potholed asphalt, urban with speed bumps (curve radii, vertical impulse frequency/amplitude);
  - road surface & weather: dry / wet (rain) / heavy rain with puddles / mud (wet dirt road) / fog.
    A wet road lowers the truck's max braking. It does **not** lower cargo-floor friction: the EN 12195-1
    friction table holds for surfaces "dry or wet but clean". Only a dirty deck does (mud: cap 0.2, gravel:
    cap 0.3, both assumptions documented in docs/physics-model.md). Fog does not change physics: model it
    as late reaction (harsher, later braking events);
  - events: emergency braking, sudden lane change, sharp curve, pothole, speed bump, mountain descent,
    long vibration (gradual loss of strap pretension — why CONTRAN requires re-tightening en route).
  - "Full test" caps loads at EN 12195-1 road reference values: forward 0.8 g, backward 0.5 g, sideways
    0.5 g (verified 2026-11-20 against Table 2 of the standard's public preview).
- Failure explanation (`backend/physics/explain.py`): for every failing event return
  (1) what happens (frames + force vectors: inertia vs. friction + straps), (2) why (one-sentence force balance
  with numbers from the sim), (3) consequence class: slides/damages cargo, hits the cab, falls on the road,
  tips over, exceeds axle limit, (4) the cheapest fix verified in simulation.
- Metrics per unit: max displacement, max rotation (tipping onset), loss of contact, peak strap tension.
  Result: OK / WARNING / FAIL with thresholds in config.
- Analytical validation: in simple cases (one box, frictional lashing) the simulation must agree with
  n >= (c_x - mu*c_z) * m * g / (2 * mu * F_T * sin(alpha)); this is an automated test.
- Fixed timestep (2 ms), fixed seed, 2–3 s per scenario; target < 1 s CPU per scenario.
- Always support running two variants in one call: "as loaded" vs. "recommended plan".

## Brazilian rules (backend/rules)
Each rule is an explicit check with an id, the legal article, an English message (translated in the UI) and tests
for a passing and a failing case. CONTRAN Resolution 945/2022:
- Art. 4: lashing devices with a safety factor of at least 2× the cargo weight; enough anchor points.
- Art. 4 §3: ropes are prohibited as lashing devices (allowed only to hold a tarp).
- Art. 5: open bodies / flatbeds with split cargo: each unit secured with at least 4 lashing terminals.
- Art. 6: with rebatable side rails, straps go inside the rails; anchoring on the metal body or chassis,
  never only on the wooden floor.
- Art. 7: cargo that does not fill the body length needs diagonal devices against forward/backward movement.
- Art. 8: cargo above the headboard height that could slide forward is prohibited.
Axle loads (CONTRAN Resolution 882/2021, art. 6, steel suspension), in a config file with sources:
single axle 2 tires 6,000 kg; single axle 4 tires 10,000 kg; tandem dual axle with dual tires 17,000 kg;
triple axle with dual tires 25,500 kg; enforcement tolerance per axle 12.5%.
Verify against the official text (Diário Oficial, 2021-12-24) and later amendments (e.g. Resolution 1015/2024)
before the video. Axle loads are computed with beam statics (moment balance over the axle groups) from the
vehicle tare and each unit's center of mass.

## Planner (backend/planner)
0. Load advisor (before loading): from a photo of the cargo on the ground (or a list) and the chosen truck,
   answer: does it fit (body volume, vehicle max weight, axle loads — say which limit binds first), a 3D
   arrangement (packing heuristic), a numbered loading order, and the lashing plan already tested under the
   chosen trip conditions. After loading, the truck-bed photo closes the loop (compare with the plan, run the trip test).
1. Placement: heaviest units low and centered; push cargo against the headboard when it acts as a stop;
   keep the combined center of mass inside the window that satisfies axle limits.
2. Initial lashing: analytical minimum straps per unit; terminals required by CONTRAN; diagonals when there is
   longitudinal free space.
3. Simulation in the loop: run all profiles; on failure apply the cheapest fix (add a strap, change anchor,
   add a diagonal, move a unit) and re-simulate. Max 30 iterations.
4. Explanations: every change in the final plan carries its reason ("unit 3 slid 18 cm under braking") and the
   CONTRAN article when applicable.
5. Stretch only: surrogate model (gradient boosting / small MLP) trained on simulated scenarios to pre-filter
   candidates; full simulation still confirms the final plan.

## Perception (backend/perception)
- **Photo-first UX:** the app opens on the camera. Typing everything is only a fallback.
- Claude vision returns structured JSON (unit count, cargo type, visible straps, body type, suggested
  bounding boxes) drawn over the photo; the user confirms or edits by tapping (adjust boxes, weights, add a
  missed strap, pick the truck). The known truck-bed length provides scale.
- The original photo is stored and attached to the certificate as a record.
- Claude API budget is US$100/month: cache results per photo hash (demo photos never re-billed), rate-limit
  per visitor, use the API only for photo analysis and optional explanation wording.
- Stretch: monocular depth to suggest dimensions. The flow must never block if perception fails.

## Product (frontend)
- Mobile-first for drivers, desktop for the dashboard. English by default, pt-BR via the switcher.
- Every screen answers "is it safe?" in one sentence before any technical detail; technical details sit behind
  "how we calculate this".
- Key demo screen: side by side, "as loaded" vs. "Carga Segura plan", running the braking test in 3D, with axle
  loads in green/yellow/red and the CONTRAN checks listed with their articles.
- Certificate: shareable page with plan, checks, simulation GIF/video, timestamp and a verification hash.
- Dashboard: ~200 synthetic trips (fictional plates), risk per trip, filters by driver and risk.

## Conventions
- Python: type hints, ruff, mypy, pytest. TypeScript: strict, ESLint, Vitest. Small, frequent commits with
  clear English messages. CI runs tests and lint on every push.
- Required tests: every CONTRAN check (pass + fail), axle loads vs. hand calculations, simulation vs. the
  analytical formula, simulation determinism, and all 4 demo scenarios ("as loaded" fails, the plan passes).
- Every number in the README/pitch needs a source. The system is a decision-support tool, not an engineering
  certification — state this clearly in the UI and README.

## Build order
1. Scene generator + physics + JSON replay (the heart of the demo).
2. CONTRAN rules + axle loads.
3. Planner with simulation in the loop; 4 scenarios passing.
4. 3D viewer + driver flow + side-by-side view; i18n (en default, pt-BR).
5. Photo marking + Claude vision assistant; certificate.
6. Dashboard, deploy, static fallback.
7. README, video.
