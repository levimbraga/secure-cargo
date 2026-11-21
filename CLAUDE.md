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
SecureCargo is a **physical AI** system that checks, before a trip, whether a truck's cargo is well distributed
and properly secured. The loop is **perceive → simulate → plan**:

1. **Perceive:** from a photo of the truck bed (Claude vision) or the manual load editor, obtain the cargo units
   (size, weight, position) and the restraints already in place.
2. **Simulate:** MuJoCo applies hard braking, cornering, potholes and whole trips to the truck bed and records
   what slides, tips, rolls or overloads. The same model runs in two places: live in the browser (MuJoCo
   WebAssembly, "live, not certified") and on the server (Python bindings, the source of truth).
3. **Plan:** find the smallest change (placement, number, position and type of restraints) that passes Brazilian
   rules and every simulated event, and prove it in simulation.
4. **Record:** produce a shareable "load certificate" (plan + simulation + checks + timestamp).

Product flow (direction set on 2026-11-20):
1. **Gallery** `/app/examples`: ready-made examples, no login, covering every supported option; each has "as
   loaded" and "fixed", a one-sentence story, "Open in explorer" and a raw MuJoCo render video.
   `docs/coverage.md` (generated, shown on the page) proves every option appears in at least one example.
2. **Explorer** `/app/explorer`: any combination simulated live; one selector per dimension, a top-down load
   editor (drag units, tap to add straps, live axle loads), configuration in a shareable URL.
3. **New load:** from a photo (login, quota) or manual (no API cost); both land in the explorer prefilled.
4. **Fix it:** the planner. 5. **Certificate.**

Supported dimensions (every one must appear in the gallery):
- Truck body (physics): flatbed, box truck, curtain-sider; the driver picks one of five body styles that map to
  them: open with low sides, open with a tall rack, platform (flatbeds), box truck, curtain-sider (2026-11-21).
  Size: VUC, 3/4, toco, truck, semi (axles and limits per CONTRAN 882).
- Cargo: wood pallet, plastic pallet, crate, drum, steel coil, machine, tall cabinet, sacks, long pipes,
  stacked boxes.
- Position: against the headboard, with a gap, at the rear, to one side, stacked.
- Restraint: none, top-over strap, direct/diagonal, chain, rope, blocking, anti-slip mat, coil cradle.
- Speed 20–100 km/h. Road: straight highway, curvy highway, mountain descent, dirt/gravel, potholed asphalt,
  urban with speed bumps. Surface/weather: dry, wet, heavy rain, mud, fog.
- Event: emergency braking, lane change, sharp curve, pothole, speed bump, long descent, long vibration; plus a
  full trip as a sequence of events.
- Outcomes: slide, tip-over, roll, hit headboard/wall, fall off the side, strap overload, axle overload,
  pretension loss.

Users: owner-operator truck drivers and small/mid-size carriers (free for the driver). Payers: carriers,
cargo insurers (mandatory RCTR-C insurance) and risk-management companies.

## Main goal and roles (refocus of 2026-11-20)
**Any judge opens the link on a phone, photographs a load (or uses a sample photo) and, in under 2 minutes, sees in
a 3D simulation whether the load arrives intact; and if not, what happens, why and how to fix it.**

SecureCargo is a cargo-inspection system used by companies. Roles:
- `member` (driver/inspector): creates inspections (photos + information), sees the result, simulation and fix.
  Reads **only their own** inspections. UI mobile-first, at `/app`.
- `org_admin` (manager at an insurer or a carrier): reads every inspection of their organization, invites
  members. UI desktop-first, at `/app/org`.
- `platform_admin` (the project owner): costs, quotas, kill switch, reads everything. UI desktop-first, at
  `/app/admin`. Identified by email from the `PLATFORM_ADMIN_EMAILS` secret; **no personal email in the repo**.
An organization has a type: `insurer` or `carrier`. Gallery, explorer and lab stay public and in the menu.

Demo access: "Enter as demo driver" / "Enter as demo insurer" on the sign-in page, no signup, into the seeded
organization "Demo Insurer" (a few drivers, inspections from the sample photos and gallery examples: passes,
fails, fixes). Demo accounts spend nothing except analyzing a new photo of their own, from a small shared quota.

### Auth and backend split (decided 2026-11-20)
- **Clerk** holds identities, organizations, org roles (`org:admin` → `org_admin`, `org:member` → `member`) and
  invitations. Sign-in: email + password only (two tabs, "Forgot password?" by an emailed code), our own
  form on Clerk's hooks (`components/app/auth-panel.tsx`); no social login, email link, username, phone or
  MFA (2026-11-21). A new account without an organization picks "I was invited by my company" or "Create my
  company" (`org-choice.tsx`; Clerk marks that session "pending", which the app treats as signed in).
  **Demo access has no Clerk account (2026-11-21):** "Enter as demo driver/insurer" gets a Worker-issued
  session (`backend/worker/src/demo.ts`): an HMAC-signed token in an httpOnly, Secure, SameSite=Lax cookie
  for 24 hours, with its own `sandbox_id`. A demo visitor sees the seeded Demo Insurer inspections plus only
  their sandbox's (same authorization layer, `authz.ts`); driver and insurer in one browser share the
  sandbox; sandbox data is purged after 24 h. The demo people and org are D1 rows only (`seed/demo.ts`).
  The UI shows "Demo · Exit" instead of Clerk's user menu.
- **The Worker (`backend/worker`, TypeScript + Hono) is the application backend:** it verifies the Clerk session
  JWT, enforces authorization, owns D1 (`migrations/`), R2, quotas, the budget cap and (Phase 6) the Anthropic
  call. The FastAPI container is a stateless physics engine reached only through the Worker. The authorization
  tests run in Vitest against the same SQL migrations on `node:sqlite`.

### Authorization (enforced in the backend on every endpoint, each rule tested)
- a member reads and changes only inspections they authored;
- an org_admin reads every inspection of their organization;
- nobody reads another organization's data (answer 404, not 403, so ids do not leak);
- the platform admin reads everything.
The UI hides what a role cannot do, but the backend is the only enforcement.

### Data model (Cloudflare D1 = SQLite; photos in a private R2 bucket)
`organizations` (name, type insurer|carrier, quota overrides) · `users` (email, name, platform role, blocked,
quota override) · `memberships` (user, org, role member|org_admin) · `invitations` · `inspections` (org,
author, created_at, status draft|analyzed|confirmed|simulated, truck body/size, cargo weight, notes, optional
plate, off by default) · `photos` (inspection, R2 key, SHA-256, EXIF stripped) · `analyses` (AI output, model,
tokens, cost, cached by photo hash) · `scenarios` (the user-confirmed load draft) · `results` (per situation:
verdict, metrics, keyframes reference) · `fixes` · `usage` (per user, per call, estimated cost) ·
`settings` (kill switch, monthly cap). An inspection's payload is the explorer's load draft (`#draft=` /
`POST /explorer/draft`); a saved inspection opens directly in the editor, replay and lab.

### Credit protection (Anthropic API)
Only real photo analysis spends credits. Quota: 5 analyses per day per user (overridable per user and per
org). Monthly cap US$80 computed from the `usage` table; at the cap or with the kill switch on, analysis answers
`demo_mode` and the UI offers the sample photos. Results cached by photo hash (a repeated photo is never
re-billed). Anonymous endpoints rate-limited by IP. Secrets only in Cloudflare/Vercel secret stores.

## Driver result experience (refocus of 2026-11-21; details in the workspace CLAUDE.md)
Perception accuracy is parked; the product must be complete, intuitive and correct for whatever perception
returns. Flow on a phone, one question per screen: guided capture (silhouette overlay, client-side quality
checks: blur, dark, cut off, too far) → truck cards (size, then body style, our own SVG side views with the axle
count; saved trucks first; the AI preselects) → weight (kg, read from the DANFE invoice, or "I don't know" =
an estimated range, simulated at its upper bound and labelled "weight estimated") → straight to the result.
- **Verdict, three states, the same in every list, dashboard and certificate:** `approved` (every situation
  holds and every rule passes), `holds_noncompliant` (every situation holds, a rule fails: CONTRAN 945, axle or
  total weight limits of CONTRAN 882, or the legal dimensions), `fails` (any situation fails for a physical
  reason: slide, tip, roll, hit the headboard, lashing overload; an axle overload is a rule, not physics).
  Stored in `inspections.verdict` as pass / warning / fail. Never red when every situation holds.
- **Checklist by theme:** securing (CONTRAN 945), weight and axles (CONTRAN 882), trip physics (7 situations),
  protection (anti-slip mat, edge protectors, headboard height), dimensions. Art. 8 is never failed on a
  headboard height nobody gave: it is "to confirm" until the saved truck, the AI or the driver gives one.
- **Minimal fix:** candidates in order of effort (move units → add straps → anti-slip mat → diagonals → edge
  protectors), each unneeded step dropped after a re-check without it; never "push against the headboard" and
  "switch to diagonals" together when one is enough.
- **Re-inspection:** "I fixed it: take a new photo" creates a new inspection linked to the first
  (`reinspection_of`); the first becomes "fixed and proven" only when the new one is approved.
- **My trucks** (`trucks` table, per user), **sharing** (a public token link to a summary page without the driver's
  name unless the organization allows it, plus a WhatsApp intent).

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
│   ├── app/            # API routes: /simulate, /mjcf, /scenarios/demo, /scenarios/{id}/mjcf, /plan, /check,
│   │                   # /certificate, /health
│   │   ├── scenario/   # load scenario schema (Pydantic, versioned): bed, units, lashings, trip event
│   │   └── demo/       # loader of the demo fixtures
│   ├── scene/          # scenario -> MJCF (scene generator)
│   ├── physics/        # MuJoCo run, event profiles (conditions/), metrics, verdict, EN formulas, validation,
│   │                   # live.py (the "live model": MJCF + run plan the browser steps)
│   ├── rules/          # CONTRAN 945/2022 (lashing) + axle load limits (CONTRAN 882/2021), config with sources
│   ├── planner/        # placement + lashing search with simulation in the loop
│   ├── perception/     # photo -> suggestions (Claude vision) + manual marking support
│   ├── scenarios/demo/ # 4 demo scenarios (JSON): braking, weigh station, rope, sharp curve — also used as
│   │                   # tests. Inside backend/ because the Docker build context is backend/.
│   ├── scripts/        # build_demo_fixtures, precompute_demo (writes frontend/public/demo/)
│   └── tests/
├── frontend/           # Next.js (TypeScript), Tailwind, shadcn/ui, React Three Fiber, next-intl
│   ├── messages/       # en.json (default), pt-BR.json
│   ├── app/[locale]/app/  # scenarios/[id] (replay), lab/[id] (live lab), examples, explorer, certificate
│   ├── lib/live/       # MuJoCo WASM engine: the browser port of backend/physics/simulate.py
│   ├── components/scene/  # the 3D scene shared by the replay and the live lab
│   └── e2e/            # Playwright: browser-vs-server parity in headless Chromium
├── docs/               # design.md, physics-model.md (model + sources), validation.md (sim vs. EN 12195-1)
├── .github/workflows/ci.yml
└── README.md
```
- **Same model everywhere.** The server generates the MJCF and the run plan (bed motion sampled every 2 ms,
  lashing parameters, thresholds) for a scenario and an event: `GET /scenarios/{id}/mjcf` and `POST /mjcf`.
  The server simulates exactly that document (`POST /simulate`, keyframes as JSON at 30 fps), and the browser
  loads the same document into the official MuJoCo WebAssembly build (`@mujoco/mujoco`, same version as the
  Python package) and steps it live. `frontend/lib/live/` mirrors `backend/physics/simulate.py` step for step;
  when one changes, change the other and keep the parity test green.
- Browser results are labelled "live, not certified". Certificates only ever use the server's result.
- The WASM module (about 2.8 MB gzipped) loads lazily, only on pages that step the model.
- Fallback chain: WASM or WebGL unavailable, or the device too slow -> server `/simulate` + replay -> static
  JSON of the demo scenarios (works with the backend down) -> the raw MuJoCo video for precomputed cases.
- Deploy: own domain bought on Cloudflare Registrar, DNS on Cloudflare. Root = landing page, `/app` = driver
  app, certificate and dashboard (Vercel, one Next.js project); `api.<domain>` = FastAPI + MuJoCo in Docker on
  Cloudflare Containers (Workers Paid plan; a thin Worker routes requests to the container). Photos and
  certificates in Cloudflare R2. Fallback host for the backend: Render or Hugging Face Spaces.
  Containers scale to zero, so keep demo scenarios cached/static to hide cold starts.
  Until the domain exists, use the free *.vercel.app URL.
  Deploy a hello-world on day 1. Health route and cached demo scenarios. Must stay online through judging.

## Physics (backend/physics)
- Engine: MuJoCo. The scene is an MJCF generated by code from the scenario JSON; the browser loads the same
  MJCF through `@mujoco/mujoco`.
- Anything new (rolling cylinders, wall/curtain restraint strength, stacking, pretension loss) needs a source or
  a documented assumption in the workspace's `notes/physics-sources.md`, and a validation test where a
  closed-form check exists (e.g. rolling and tipping thresholds), listed in `docs/validation.md`.
- The truck is generated by code and parametric: body type (flatbed, box truck, curtain-sider) and size (VUC,
  toco, truck, semi), always drawn with the exact simulation dimensions. No third-party 3D models.
- Truck bed = body driven by slide joints with prescribed acceleration; floor, rebatable side rails and a
  headboard (front panel), with dimensions per truck type.
- Cargo units = rigid boxes with mass and a configurable friction coefficient per material pair
  (wood-wood, metal-wood, anti-slip mat).
- Straps = MuJoCo spatial tendons between two anchor points, passing over the unit, with stiffness and a rest
  length shorter than the installed length (creates pretension, STF); log tension vs. lashing capacity (LC).
  Fallback if unstable: equivalent vertical clamping force.
- Trip-condition library (`backend/physics/conditions/`): every condition is data that maps to physics inputs,
  never new simulation code. Dimensions:
  - speed: 20–100 km/h (braking intensity; lateral accel = v^2 / r on curves);
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

## US mode (backend/rules/country.py, 2026-11-21)
The same load can be checked against Brazil's rules or the US federal rules (the draft's `country`, BR by
default; `inspections.country`). Only the rules layer, the truck presets (`us_*` sizes) and the units
change; the physics is the same. US securing: 49 CFR 393 subpart I (`rules/fmcsa393.py`); weights:
23 CFR 658.17 and the bridge formula (`rules/us_weights.py`); dimensions: 658.15 and 393.87
(`rules/us_checklist.py`). Every battery carries both countries' rule sets; switching country re-runs only
the rules. Sources and worked examples: the workspace's `notes/us-rules.md`; details: `docs/inspection.md`
section 10.

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
- A new load starts from an inspection: 1–4 photos (front, sides, rear, login + quota, because it costs API
  money) plus the **required cargo weight** (a photo cannot show weight) and the confirmed truck type; or from
  the manual editor (free). Both land in the top-down editor prefilled, with numbered overlays on the photo.
- Claude vision answers structured JSON only, **never invents weights** (weights come from the user's total),
  and is cached by photo hash.
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
- Every result shows the verdict, the reason in one sentence with numbers (e.g. "Inertia 7.1 kN > friction
  4.0 kN: the pallet slides") and the EN 12195-1 check.
- Certificate: shareable page with plan, checks, simulation GIF/video, timestamp and a verification hash.
- **Mobile performance budget** (replay and live lab): mount the scene only when visible; render on demand when
  paused; cap devicePixelRatio at 1.5; no shadows or post-processing on low-end or mobile GPUs; pause when the
  tab is hidden. At 375 px the engineering view shows fewer labels, larger tap targets and details in a
  tap-to-open panel.

## Conventions
- Python: type hints, ruff, mypy, pytest. TypeScript: strict, ESLint, Vitest. Small, frequent commits with
  clear English messages. CI runs tests and lint on every push.
- Required tests: every CONTRAN check (pass + fail), axle loads vs. hand calculations, simulation vs. the
  analytical formula, simulation determinism, and all 4 demo scenarios ("as loaded" fails, the plan passes).
- Every number in the README/pitch needs a source. The system is a decision-support tool, not an engineering
  certification — state this clearly in the UI and README.

## Build order (dates in the workspace CLAUDE.md)
1. Scene generator + physics + JSON replay. **Done.**
2. Live MuJoCo in the browser: live model endpoints, WASM engine, lab page, parity test, fallback. **Done.**
3. Gallery (nine "must" examples), explorer, load editor, cargo library, box truck, full trip. **Done.**
4. (Phase 5) Auth, organizations, roles, demo accounts, D1 schema, authorization tests, credit protection,
   shells of `/app`, `/app/org`, `/app/admin`.
5. (Phase 6) Driver inspection flow: photos + weight + truck → Claude vision prefill → confirm → 7-situation
   battery → scorecard → "Apply fix and re-simulate" (planner) → saved.
6. (Phase 7) Manager dashboard and the certificate of a saved inspection (`docs/dashboard.md`).
7. (Phase 8) Polish: gallery examples 10–16 (the 8 uncovered options), full trip, EN 12642 code L check from a
   primary source, landing page featuring the inspection flow.
8. (Phase 9) Perception evaluation on a large photo set, README, video, submission.
Cut order if late: the Phase 8 list, then full trip, then certificate polish.
