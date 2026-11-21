# The inspection flow

What happens between a driver's photo and a proven fix, and where each step lives in the code.
SecureCargo is a decision-support tool, not an engineering certification.

```
photos ──► Claude vision ──► load draft ──► review ──► battery (7 situations) ──► planner ──► battery again
 (phone)    (Worker)         (container)    (phone)     (container, via Worker)   (container)   (proof)
```

## 1. Photos (`frontend/lib/inspection/image.ts`, `backend/worker/src/perception/metadata.ts`)

One to four photos, from the camera (`capture="environment"`) or uploaded (JPEG, PNG, HEIC). The
phone decodes them (HEIC through `heic2any` when the browser cannot), turns them upright, scales
the long edge to 1568 px (what the vision model uses) and re-encodes them as JPEG, which drops all
metadata. The Worker strips EXIF/XMP/comments (JPEG APP1–APP15, COM) and PNG text chunks again
before storing the photo in the private R2 bucket under `photos/<sha256>.jpg`. Photos are served
only through `GET /inspections/:id/photos/:photoId`, to those who may read the inspection.

## 2. Perception (`backend/worker/src/perception/`)

One Claude vision call per inspection, with all its photos, answering structured JSON only
(`output_config.format`, schema in `schema.ts`): the truck body and size it suggests, every cargo
unit (type, approximate size, position on the bed as fractions, stacking, a box on the photo), the
restraints (straps, chains, ropes, mats, blocking, cradles, with counts and routing), visible
CONTRAN 945 violations, and a confidence and an "uncertain" note per item.

- **No weights.** The schema has no weight field and `sanitizeAnalysis` rebuilds every answer field
  by field, so nothing else gets through. Masses come only from the user.
- **Cache.** Keyed by the hash of the photo set, the model and the prompt version: a repeated photo
  is never billed again (`analyses` table). A cached answer is recorded as a free usage row.
- **Credit protection.** Before a billed call: blocked user → kill switch → monthly cap (US$80,
  from the `usage` table) → daily quota (5 per user, overridable per user and per organization;
  the demo accounts share one pool). A refusal answers "demo mode" and the page offers the samples.
- Model choice, accuracy and cost per inspection: [`perception-eval.md`](perception-eval.md).

## 3. Load draft (`backend/perception/draft.py`, `POST /perception/draft`)

The analysis becomes the explorer's load draft on the truck the user confirmed. Its bed length and
width give the photo's fractions a scale. Units are packed from the headboard in the lanes the photo
shows so that none overlaps or hangs off the bed; straps are kept within the lashing points along
each unit; anything changed is reported as a warning. The user's total weight is split over the
units by volume (or each unit gets the weight the user typed). Without a weight the units have none
and the load cannot be confirmed: `PUT /inspections/:id/draft` refuses it (`checkWeights`).

## 4. Review (`frontend/components/inspection/review-step.tsx`)

The photo with a numbered box over each unit, next to the top-down editor (two tabs on phones). The
user moves, resizes, adds and removes units, sets straps, the restraint and the weights. Fields the
user changed are marked "yours"; the others show the AI's confidence. "Confirm load" waits for the
weights.

## 5. Battery (`backend/app/inspection/battery.py`, `POST /battery`)

| Situation | Trip |
|---|---|
| Emergency braking | 80 km/h, straight highway, dry |
| Sudden lane change | 80 km/h, straight highway, dry |
| Sharp curve | 60 km/h, curvy highway (60 m radius), dry |
| Pothole | 60 km/h, potholed asphalt, dry |
| Speed bump | 30 km/h, urban (the "Type A" bump of the Brazilian signalling manual is designed for 30 km/h) |
| Mountain descent | 60 km/h, mountain road (8 % grade), heavy rain |
| Long vibration | 60 km/h, dirt road (dusty deck, cargo friction capped at 0.3; pretension falls to 50 %) |

Each is an explorer trip run by the same MuJoCo model as everywhere else (`physics/`), cached by
input hash. A situation **passes** when its verdict is not "fail" (a warning means the load crept
1 to 5 cm, or a lashing reached 90 % of its capacity). The answer carries every situation's verdict
and findings, the worst one with its keyframes (the others come from `POST /simulate`), the axle
loads (CONTRAN 882/2021), the EN 12195-1 check per unit and the six CONTRAN 945/2022 checks. A load
**passes the inspection** only when all seven situations pass and no CONTRAN rule fails.

On a 1/4-vCPU container a battery takes about 4 s of CPU for three pallets and about 15 s for a
box truck full of cartons; wall time on the production container is in the Phase 6 notes.

## 6. CONTRAN 945/2022 checks (`backend/rules/contran945.py`)

| Code | Article | Check |
|---|---|---|
| `devices_allowed` | Art. 4 §3 | No ropes used as lashing. |
| `safety_factor` | Art. 4 | The lashing capacities (LC) over a unit or stack add up to at least twice its weight. Units held longitudinally by blocking, a cradle or a box body's front wall are not assessed. |
| `four_terminals` | Art. 5 | Split cargo on an open body: every unit has at least 4 lashing terminals (a top-over strap has 2, a direct lashing 1). |
| `anchoring` | Art. 6 | Lashings are hooked to the metal frame; fails when the photo shows them tied to the wooden floor. |
| `diagonals_for_gaps` | Art. 7 | A load with room to travel along the truck (a gap of more than 15 cm to the headboard or to the unit in front) needs diagonal lashings or blocking. |
| `above_headboard` | Art. 8 | On a flatbed, a unit taller than the headboard must not be able to slide forward (diagonals or blocking). |

The text gives no numbers for "does not fill the body length" (art. 7) or how the safety factor is
summed (art. 4); the readings above are ours and are tested in `tests/test_contran945.py`.

## 7. Planner (`backend/planner/plan.py`, `POST /plan`)

1. Rules first: ropes become ratchet straps; lashings on wood go to the metal frame.
2. Placement: the load slides forward against the headboard (no room to travel); if that would
   overload an axle group, it goes as far forward as the axle limits allow.
3. Securing, cheapest first: top-over straps in the number EN 12195-1 asks for (at least 2 per unit,
   never fewer than were there), an anti-slip mat under them, diagonal straps, chains; a coil gets
   a cradle (then a cradle with straps); a box body gets blocking first. A candidate is simulated
   only if it meets EN 12195-1 and every CONTRAN check on paper.
4. Proof: the candidate runs through the battery, stopping at the first failure (the situations
   most loads fail come first); the first one that passes all seven is the plan, reported with its
   full battery. At most four candidates are simulated.

Every change carries a stable code, the rule behind it and its numbers; the page translates them.
All nine gallery loads are fixed this way and pass 7 of 7 (`scripts/build_demo_inspections.py`).

## 8. Saving (`backend/worker/src/flow.ts`)

Status goes draft (photos) → analyzed → confirmed (the user's load saved in `scenarios`) →
simulated (one `results` row per situation, the whole battery in R2 at
`results/<inspection>/<kind>.json`). "Apply fix" saves the fixed load as a second scenario, its
results and a `fixes` row with the changes. Members see their own inspections; an org_admin sees
the organization's (`/app/org`); every rule is enforced in the Worker and tested
(`backend/worker/test/flow.test.ts`).

## 9. Sample photos (`backend/scripts/build_samples.py`, `public/demo/samples/`)

Real photographs of loads (free licence, credited), each with its recorded Claude analysis, the
load on the confirmed truck with a made-up invoice weight, the battery, the proven fix and every
situation's run. Signed out, a sample runs end to end from these files, with no API call; once the
user edits the load, the public `/perception/draft`, `/battery` and `/plan` endpoints take over
(rate-limited per IP). Signed in, a sample inspection is saved like any other.
