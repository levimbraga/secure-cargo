# The inspection flow

What happens between a driver's photo and a proven fix, and where each step lives in the code.
SecureCargo is a decision-support tool, not an engineering certification.

```
(my trucks) ─► photo ─► truck ─► weight ─► battery (7 situations) ─► result ─► planner ─► proof ─► new photo
  (phone)     (checks   (cards,  (kg, DANFE  (container, via Worker)   (3 states, (container) (battery)  (re-inspection)
               on the   AI pick) or estimate)                          checklist)
               phone)
```

**Driver flow (2026-11-21).** One question per screen on a phone: a saved truck (if any), the photo
(guided camera with a truck outline, "full side" or "rear three-quarter"; one is enough, two are
recommended), the truck (size cards, then body cards, our own SVG side views with the axle count; the AI's
guess is preselected), the weight (typed, read from the DANFE invoice, or estimated), and straight to the
result. The review step is gone: the result shows a one-line summary of what was read with the
low-confidence items flagged, and "Wrong reading? Correct it" opens the editor (section 4).

## 1. Photos (`frontend/lib/inspection/image.ts`, `backend/worker/src/perception/metadata.ts`)

One to four photos, from the camera (`capture="environment"`) or uploaded (JPEG, PNG, HEIC). The
phone decodes them (HEIC through `heic2any` when the browser cannot), turns them upright, scales
the long edge to 1568 px (what the vision model uses) and re-encodes them as JPEG, which drops all
metadata. The Worker strips EXIF/XMP/comments (JPEG APP1–APP15, COM) and PNG text chunks again
before storing the photo in the private R2 bucket under `photos/<sha256>.jpg`. Photos are served
only through `GET /inspections/:id/photos/:photoId`, to those who may read the inspection.

**Instant photo checks** (`frontend/lib/inspection/photo-quality.ts`), on a 320 px grey copy, before any
upload: too dark (mean brightness < 50/255), blurred (variance of the Laplacian < 45), too far (80 % of
the detail inside less than 18 % of the frame), cut off. Each gives a reason and "Retake" or "Use it
anyway". The first three were tuned on the 21 evaluation photos and the samples (none flagged) and on
degraded copies (darkened, blurred and shrunk copies all flagged).

**Cut off (2026-11-21).** A load that runs out of the photo is detected two ways before any upload:
1. Pixels: a strong horizontal line (a deck edge, the top of a bundle, a strap) runs out through the left
   or right edge: in more than 3.4 % of the rows, both the outer 4 % band and the band next to it are
   strong horizontal edges (vertical gradient above the frame's 90th percentile); or both side bands are
   busier than the frame on average. On the 21 evaluation photos, labelled by hand (12 run out at a side,
   17 sides in all), it catches 8 of the 12 photos (9 of the 17 sides) with no false alarm on the other 9.
   Edge energy alone cannot separate them: a busy background (trees, a wall) at the side of a well-framed
   photo scores as high as a cut load, so the pixel test is tuned for no false alarms.
2. The driver: every photo that passes the checks shows one question with the photo, "Is the whole load
   in the photo?" ("Yes, all of it" / "No, retake"). One tap, and it is the reliable part.
After the analysis the result still flags a unit whose box touches the side of the photo (`cutOffUnits`).

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

## 3b. Truck and weight

**Trucks** (`frontend/lib/inspection/trucks.ts`): sizes VUC, 3/4, toco, truck, semi-trailer; body styles
open with low sides, open with a tall rack, platform (all simulated as a flatbed: rails and racks are not
rated restraints), box truck, curtain-sider. A saved truck (`trucks` table, `/trucks`, "My trucks") adds
its bed length, headboard height and lashing points per side to the draft's truck; the inspection then
uses it instead of the AI's guess. Without a headboard height, CONTRAN 945 art. 8 is "to confirm", never
failed on an assumed value; the driver can type it on the result and the load is checked again.

**Weight** (`frontend/lib/inspection/weight.ts`, Worker `PUT /inspections/:id/draft`):
- typed (`measured`);
- `invoice`: a photo of the DANFE, `POST /inspections/:id/invoice`. Claude copies the characters in the
  PESO BRUTO box and the label above them; the Worker parses them itself (`1.234,500` is 1,234.5 kg) and
  keeps a number only when the label is a gross weight. No number is ever made up: anything else is "not
  found" (`src/perception/invoice.ts`, tests in `test/driver-result.test.ts`). Shown for confirmation,
  saved in `inspections.invoice_json`, cached by photo hash, counted as a photo analysis (quota, cap);
- `estimated` ("I don't know"): a range from each unit's cargo type and outer volume times a density range
  (`DENSITY_KG_M3`, our assumptions in the workspace's `notes/legal-limits.md`); the battery runs at the
  upper bound and the Worker refuses an estimate whose total is not the range's top. The result says
  "weight estimated".

The total is split over the units by volume ("≈600 kg each across 3 units"); "Units have different
weights?" takes one weight per unit, which must add up to the total.

## 4. Correcting the reading (`frontend/components/inspection/review-step.tsx`)

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
input hash. A situation **passes** when none of its movement findings fails (an axle overload is reported
once, in the checklist, not as a failure of every situation) (a warning means the load crept
1 to 5 cm, or a lashing reached 90 % of its capacity). The answer carries every situation's verdict
and findings, the worst one with its keyframes (the others come from `POST /simulate`), the axle
loads (CONTRAN 882/2021), the EN 12195-1 check per unit, the six CONTRAN 945/2022 checks and the
checklist themes (`rules/checklist.py`).

**Verdict, three states** (`app/inspection/verdict.py`, the same in the Worker's `src/verdict.ts` and the
site's `lib/inspection/verdict.ts`, each tested):
- `approved`: every situation holds and every rule passes;
- `holds_noncompliant`: every situation holds, a rule fails (CONTRAN 945, axle, payload or gross weight
  limits, or the dimensions of CONTRAN 882);
- `fails`: a situation fails physically (slides, tips, rolls, falls off, hits the cab, a lashing breaks or
  is overloaded). Never red when every situation holds.
Stored in `inspections.verdict` as pass / warning / fail. The main problem is named in one sentence:
the worst physical failure ("In hard braking at 80 km/h, pallet 2 slides into the cab.") or the first
failing rule.

**Checklist themes**: how it is secured (CONTRAN 945 + EN 12195-1), weight and axles (each axle group
against its legal limit with the 12.5 % weighing tolerance shown as context, payload, gross weight
29 t, and two pieces of advice: the centre of mass within 10 % of the deck width of the centre line,
at least 20 % of the modelled weight on the front group, both our thresholds, ASSUMPTION), trip physics
(the seven situations), protection (anti-slip mat and edge protectors as advice; the headboard height)
and dimensions (height 4.40 m, width 2.60 m, cargo past the rear of the deck). Sources:
`notes/legal-limits.md` in the workspace.

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

**Minimal fix (2026-11-21).** After the rule fixes (ropes, anchoring), every candidate is a set of steps:
move (push against the headboard, or back to free an axle, which is then mandatory), straps (the number
EN 12195-1 asks for), anti-slip mat, diagonals, chains (a coil: cradle; a box body: blocking). Each
securing option is tried both where the load stands and after the move, and candidates are tried by total
effort (move 1, straps 2, mat 3, diagonals 4, chains 5), fewest steps first: "diagonals" alone comes
before "move + diagonals". When no candidate holds on paper, the strongest are proven first. Once one
passes (holds and breaks no rule), each step is dropped in turn and the rest proven again; a step that
is not needed goes (the Worker does the same with the container's `subsets`). Edge protectors are added
last as advice. When nothing both holds and complies, the plan is the first that at least holds.
The numbered list below is the order of the steps inside a candidate.

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

**Heavier and stacked loads (2026-11-21).** With diagonals or chains, a unit whose lashings add up to
less than twice its weight (CONTRAN 945 art. 4) gets more sets of four, up to three (`diagonal_sets` on the
draft unit; change `diagonal_sets`). A stacked load also gets a "spread" base (effort 4): every unit
standing on another goes down on the floor, as far forward as there is room, in its lane first, then
anywhere across the bed (change `spread`, CONTRAN 945 art. 8); the securing options are then tried on it
like on any other base. The 18 t steel pipes sample and a stack of crates in a sharp curve are fixed this
way and proven 7/7 (`tests/test_battery_and_planner.py`).

Every change carries a stable code, the rule behind it and its numbers; the page translates them.
All nine gallery loads are fixed this way and pass 7 of 7 (`scripts/build_demo_inspections.py`).

## 8. Saving (`backend/worker/src/flow.ts`)

Status goes draft (photos) → analyzed → confirmed (the user's load saved in `scenarios`) →
simulated (one `results` row per situation, the whole battery in R2 at
`results/<inspection>/<kind>.json`). "Apply fix" saves the fixed load as a second scenario, its
results and a `fixes` row with the changes. Members see their own inspections; an org_admin sees
the organization's (`/app/org`); every rule is enforced in the Worker and tested
(`backend/worker/test/flow.test.ts`). The manager's dashboard, the audit trail, the policies and the
certificate: [`dashboard.md`](dashboard.md).

**Demo reset** (`backend/worker/src/purge.ts`): a Worker cron runs every hour and deletes the
inspections that demo accounts created more than 24 hours earlier, with their rows, their stored
batteries and their photos in R2 (a photo only when no remaining inspection uses it). The seeded
inspections of the demo organization (`seeded = 1`) and everything made by real accounts are never
touched (`backend/worker/test/purge.test.ts`). The demo views say "Demo data resets daily."

## 8b. Re-inspection and sharing

"I fixed it: take a new photo" opens `/app/new?reinspect=<id>`: same truck and weight, a new photo, a new
inspection with `reinspection_of` = the first. The first is **fixed and proven** (`proven_by`) only when a
re-inspection is approved; the pages show before / after. Only the author re-inspects (tested).

"Share" (`POST /inspections/:id/share`, author or the org's manager) gives an unguessable token and a
public page `/app/share?t=` (`GET /share/:token`, rate-limited): verdict, photo, truck and main checks,
without the driver's name unless the organization allows it (`organizations.share_driver_name`), plus a
WhatsApp share intent. `DELETE` stops sharing.

## 9. Sample photos (`backend/scripts/build_samples.py`, `public/demo/samples/`)

Six real photographs of loads (free licence, credited), covering the three verdicts: concrete pipes
(approved), steel racks on a semi-trailer (holds, but the tractor's axles are over their limit), and
crates with ropes, steel pipes, lumber (do not arrive intact; the backhoe is too tall on our flatbed
semi-trailer). Each is a photograph each with its recorded Claude analysis, the
load on the confirmed truck with a made-up invoice weight, the battery, the proven fix and every
situation's run. Signed out, a sample runs end to end from these files, with no API call; once the
user edits the load, the public `/perception/draft`, `/battery` and `/plan` endpoints take over
(rate-limited per IP). Signed in, a sample inspection is saved like any other.
