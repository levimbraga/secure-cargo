# Validation: simulation vs. EN 12195-1

SecureCargo's verdicts come from a MuJoCo simulation, not from a formula. This page shows that, on the
cases where a formula exists, the simulation gives the same answer.

The reference is EN 12195-1:2010, "Load restraining on road vehicles: Calculation of securing forces",
the European standard for cargo securing. Its equations are quoted from the European Commission's
*Cargo securing for road transport: 2014 European best practices guidelines* and the IRU's
*International Guidelines on Safe Load Securing for Road Transport*, which reproduce the standard. Our
implementation of the equations (`backend/physics/analytical.py`) reproduces the nine worked examples
printed in those two guides (`backend/tests/test_analytical.py`).

## Method

One box stands on the truck bed under `n` top-over (frictional) lashings. The bed brakes with a
constant deceleration: a 0.2 s ramp, then a 2 s hold. The standard's equation for this case is

```
n >= (c_x - mu * c_z) * m * g / (2 * mu * sin(alpha) * F_T) * f_s
```

with `c_x = 0.8` forward and `c_z = 1`, `mu` the friction factor, `alpha` the angle between strap and
floor, `F_T` the tension in each strap and `f_s` a safety factor (1.25 forward).

Without `f_s` this equation is the exact force balance: friction from the weight plus friction from
the clamping force of the straps against the inertia of the box. A physics simulation has to reproduce
that balance, so the comparison is made at `f_s = 1`. The number the standard itself would ask for,
with its safety factor, is shown next to it; a plan that follows the standard therefore passes the
simulation with margin.

### Which safety factor

EN 12195-1:2010 has **two** safety factors, and both belong to frictional (top-over) lashing only:

| Lashing method | Direction | Factor | Where it is written |
|---|---|---|---|
| Frictional (top-over) | forward | `f_s = 1.25` | EC guidelines, section 6.1.2, p. 44: "f_s = 1.25 forward and 1.1 sideways and backward" |
| Frictional (top-over) | sideways, rearward | `f_s = 1.1` | same |
| Direct (diagonal, spring, loop) | all | no `f_s`; the friction factor is multiplied by the conversion factor `f_mu = 0.75` | EN 12195-1:2010, 3.2.20 (p. 9) and 5.1; EC guidelines 6.1.3, p. 44 |

The standard's own public preview confirms the values and what they apply to: foreword, item d (p. 4),
"safety factors f_S = 1,1 and f_S = 1,25 and conversion factor = 0,75 for friction introduced";
definition 3.2.19 (p. 9), the safety factor covers "uncertainties of distribution of tension forces for
frictional lashing"; Table 1 (p. 10), "f_s: safety factor for frictional lashing". The pages that assign
each value to a direction are not in the preview, so that assignment is taken from the Commission's
guidelines, and checked numerically: their forward example (two lashings at 55°, S_TF 500 daN,
friction 0.45) prints 1.7 t, which our formula gives with 1.25 (1.72 t) and not with 1.1 (1.95 t). The
test `test_the_forward_safety_factor_is_1_25_not_1_1` keeps that on record.

The tables below are for braking, so the column "EN 12195-1" uses 1.25. The sideways row of Table 3 is a
force balance without safety factor. For that load the standard's sideways requirement (0.5 g, `f_s = 1.1`)
is a single lashing (0.67), so the forward direction governs, as it usually does.

A run is a **fail** when a unit slides more than 5 cm and a **pass** when nothing moves more than 1 cm
(thresholds in `backend/physics/verdict.py`).

## Results

### Table 1. Number of lashings: formula vs. simulation (braking at 0.8 g)

| Case | Mass | Friction | Strap angle | Tension per strap | Formula, no safety factor | EN 12195-1 (f_s = 1.25) | Simulated with one strap fewer | Simulated with the formula's number |
|---|---|---|---|---|---|---|---|---|
| Pallet, sawn wood on plywood | 1000 kg | 0.45 | 55° | 400 daN | 1.16 → **2** | 2 | 1: slid 71 cm, **fail** | 2: slid 0.0 mm, **pass** |
| Crate, plane wood on plywood | 2000 kg | 0.30 | 63° | 500 daN | 3.66 → **4** | 5 | 3: slid 69 cm, **fail** | 4: slid 0.0 mm, **pass** |
| Full-width machine on sawn wood | 4500 kg | 0.45 | 90° | 400 daN | 4.29 → **5** | 6 | 4: slid 45 cm, **fail** | 5: slid 0.0 mm, **pass** |
| Plastic pallet on plywood | 800 kg | 0.20 | 51° | 350 daN | 4.31 → **5** | 6 | 4: slid 24 cm, **fail** | 5: slid 0.0 mm, **pass** |
| Coil cradle on rubber mat | 10000 kg | 0.60 | 86° | 500 daN | 3.28 → **4** | 5 | 3: slid 33 cm, **fail** | 4: slid 0.0 mm, **pass** |

### Table 2. Deceleration at which the load starts to slide

| Case | Lashings | Formula | Simulation | Difference |
|---|---|---|---|---|
| Pallet, sawn wood on plywood | 2 | 1.051 g | 1.053 g | +0.2 % |
| Crate, plane wood on plywood | 4 | 0.847 g | 0.849 g | +0.2 % |
| Full-width machine on sawn wood | 5 | 0.858 g | 0.859 g | +0.2 % |
| Plastic pallet on plywood | 5 | 0.896 g | 0.899 g | +0.3 % |
| Coil cradle on rubber mat | 4 | 0.844 g | 0.845 g | +0.1 % |
| Unsecured box, no lashing | 0 | 0.450 g | 0.450 g | +0.1 % |

### Table 3. Other closed-form checks

| Check | Formula | Simulation | Difference |
|---|---|---|---|
| Braking at which an unsecured 0.8 m x 2.0 m box tips | 0.400 g | 0.400 g | -0.1 % |
| Braking at which an unsecured 1.2 m x 2.4 m box tips | 0.500 g | 0.500 g | +0.1 % |
| Sideways acceleration at which the full-width machine slides (5 lashings) | 0.858 g | 0.859 g | +0.2 % |
| Tension in each of two direct lashings, 3 t box braking at 0.8 g | 755 daN | 775 daN | +2.7 % |
| Force on the headboard, 2 t box loaded against it, braking at 0.8 g | 981 daN | 989 daN | +0.8 % |
| Free 10 t coil (1.6 m, 610 mm eye) rolling forward, braking at 0.5 g | 0.318 g | 0.316 g | -0.5 % |
| Braking at which the coil rolls over a 15 cm chock | 0.717 g | 0.710 g | -1.1 % |
| Braking at which the coil rolls over a 20 cm chock | 0.882 g | 0.875 g | -0.8 % |

The last three rows check rolling cargo. A free cylinder on a braking bed rolls at
`a / (1 + I / (m R^2))` relative to it, with `I = m (R^2 + r^2) / 2` for a tube of outer radius `R` and
inner radius `r` (a coil's eye). A chock of height `h` stops it until `a / g = sqrt(2 R h - h^2) / (R - h)`,
the moment balance about the chock's edge (`backend/physics/analytical.py`). The chock threshold is found
by bisection with a 1 s ramp, and a run counts as "climbed" when the coil moves more than 5 cm: pressed
into the chock's edge, it settles about 1 cm into the soft contact first. Tests:
`test_a_free_coil_rolls_at_the_rate_its_inertia_allows`, `test_a_coil_climbs_its_chock_where_the_moment_balance_says`,
`test_a_free_coil_is_reported_as_rolling_not_sliding`.

What the tables say:

- **Table 1.** In all five cases the simulation fails with one strap fewer than the formula asks for and
  passes with the formula's number. The load does not move at all in the passing runs.
- **Table 2.** The deceleration at which sliding starts, found by bisection, is within 0.3 % of the
  formula.
- **Table 3.** Tipping of an unsecured box, sideways sliding, the tension in direct lashings and the
  force on the headboard agree with their force balances within 3 %. The direct-lashing difference is
  expected: the box moves a few millimetres until the chains carry the load, which changes their angle.

## Reproducing

```bash
cd backend
uv run pytest tests/test_validation.py tests/test_analytical.py   # asserts every number above
uv run python -m physics.validation                               # prints the three tables
```

The cases live in `backend/physics/validation.py` and run in CI on every push. Results are
deterministic: fixed 2 ms time step, no random numbers in these runs, same input, same output
(`tests/test_simulation.py::test_the_same_input_gives_exactly_the_same_output`).

## The demo scenarios carry the standard's number

The four "fixed" demo scenarios are lashed to what EN 12195-1 asks for **with** its safety factor, in
every direction (0.8 g forward, 0.5 g rearward and sideways, sliding and tipping), not to the bare force
balance. `backend/rules/en12195.py` computes the requirement per unit and every simulation result
carries it (`en_12195_1`), next to the margins measured in the run (`margins`).

| Scenario (fixed) | Lashing | EN 12195-1 asks for | Friction used in the event | Peak lashing force |
|---|---|---|---|---|
| Emergency braking, 3 pallets of 900 kg | 2 straps each | 2 each (1.70, forward sliding) | 78 % | 12 % of LC |
| Weigh station, 6 t machine + 2 crates of 1.5 t | 4 chains; 3 straps per crate | chains hold 79 kN of 27 kN needed; 3 per crate (2.91) | 100 % (the chains carry the rest) | 12 % of LC |
| Rope lashing, 3 stacks of 800 kg on anti-slip mats | 2 straps each | 1 each (0.62) | 22 % | 12 % of LC |
| Sharp curve, 2 cabinets of 700 kg | 2 straps each | 2 each (1.18, forward sliding) | 40 % | 12 % of LC |

"Friction used" is the largest share of the available friction a unit needed during the event; at 100 %
it slides unless something else holds it. The straps stay at their pretension (300 daN of an LC of
2500 daN) because the loads do not move. The stacks of the rope scenario stand on plastic pallets
(friction 0.2): on the bare floor the standard would ask for six straps per stack, so the fix adds
rubber anti-slip mats (friction 0.6).

## Browser vs. server (MuJoCo WebAssembly)

The live lab (`/app/lab/<id>`) steps the model in the visitor's browser with the official MuJoCo
WebAssembly build (`@mujoco/mujoco` 4.0.1, the same version as the server's Python package). It does
not build a model of its own: the server sends the MJCF it simulates together with the run plan (bed
acceleration for every 2 ms step, lashing parameters, run-loop constants, thresholds), through
`POST /mjcf` and `GET /scenarios/{id}/mjcf`, and `frontend/lib/live/engine.ts` repeats
`backend/physics/simulate.py` step for step.

Table 4 compares the two on the eight demo runs. Each cell is browser / server.

### Table 4. Browser run vs. server run

| Scenario | Version | Verdict | Largest slide [m] | Peak lashing force [N] |
|---|---|---|---|---|
| emergency-braking | as loaded | fail / fail | 0.81427 / 0.81427 | 5898.7 / 5898.7 |
| emergency-braking | fixed | pass / pass | 0.00002 / 0.00002 | 3003.3 / 3003.3 |
| weigh-station | as loaded | fail / fail | 0.0018 / 0.0018 | 6627.5 / 6627.5 |
| weigh-station | fixed | pass / pass | 0.00059 / 0.00059 | 4295.2 / 4295.2 |
| rope-lashing | as loaded | fail / fail | 0.19027 / 0.19027 | 349.5 / 349.5 |
| rope-lashing | fixed | pass / pass | 0.00001 / 0.00001 | 3000 / 3000 |
| sharp-curve | as loaded | fail / fail | 25.48192 / 25.48192 | none / none |
| sharp-curve | fixed | pass / pass | 0.0001 / 0.0001 | 3000.1 / 3000.1 |

Over all 990 keyframes of the eight runs, the largest difference in any unit position (rounded to
0.1 mm) and in any lashing tension (rounded to 1 N) is zero. That is expected rather than lucky: the
engine, its version, the model and the inputs are the same, and WebAssembly arithmetic is
deterministic, so even the cabinet that tumbles off the bed lands in the same place.

**Tolerance.** The automated tests do not demand bit equality, so that a different WebAssembly
engine or a rebuilt binary does not break them, but they do not let a real divergence through
(`frontend/lib/live/parity.ts`): the same verdict and the same findings; largest slide within 1 mm,
or 1 % beyond 10 cm; largest tilt within 0.1 degree (a unit that tumbles only has to tumble in both);
peak lashing force within 1 %, and at least 10 N.

**Where it runs.** `frontend/lib/live/engine.test.ts` runs the WebAssembly engine in Node on every
push. `frontend/e2e/parity.spec.ts` opens the lab page for each of the eight runs in headless
Chromium (Playwright) in CI and compares what the page computed with the server's result in
`frontend/public/demo/`. `backend/tests/test_live_model.py` checks that the document served to the
browser is exactly what the server simulates.

**What the browser result is for.** Exploring. It is labelled "live, not certified" in the UI;
certificates only ever use the server's result. The numbers above say the two agree, not that either
is more than the model described in `docs/physics-model.md`.

## What this does not show

- The simulation is validated against the standard's own model of a rigid box on a flat floor. It has
  not been compared with physical tests.
- Top-over straps are modelled the way the standard assumes: they press the load down and do not hold
  it lengthwise. Real straps add some direct restraint, so real loads move a little less.
- Friction factors come from the standard's table. A real deck that is oily, icy or worn has less.
- The direct-lashing and tipping equations of `rules/en12195.py` are taken from guides that reproduce
  the standard, not from the standard's own pages.
- SecureCargo is a decision-support tool. It is not an engineering certification.

The model, its assumptions and the source of every number are in [physics-model.md](physics-model.md).
