# Perception evaluation

How well Claude vision reads a photo of a truck load, on our photos, for the three current Claude models,
and what it costs. This is the evidence behind the model the Worker uses
(`backend/worker/src/perception/claude.ts`, `DEFAULT_MODEL`; the `ANALYSIS_MODEL` variable overrides it
without a code change).

**Choice: Claude Opus 5.5** (`claude-opus-5-5`), at about US$0.03 per photo. It and Sonnet 5.5 found the
ropes in 8 of the 9 photos that have them and named the kind of restraint right in 18 of 21; Opus
miscounted restraints by 1.0 device on average against 1.5 for Sonnet, and counted units exactly a little
more often. Restraint counts feed the EN 12195-1 and CONTRAN checks directly, so Opus is worth twice
Sonnet's price within our budget; on this set the margin is small, and Sonnet is the fallback if the
budget gets tight. Haiku 5.5 costs a thirtieth of Opus but missed 4 of 9 ropes and 8 of 21 restraint
kinds, which would make the battery check a different load from the one on the truck.

## Method

- **Photos:** 21 free-licence photos of real truck loads (Unsplash and Pexels, credits in the workspace's
  `photos/stock/loads/manifest.json`), chosen to cover the product's cargo and restraint types: pipes,
  logs, lumber, machines on low-beds, hay and straw, sacks, crates, cartons, steel; straps, chains, ropes,
  stakes, tarps, nothing. 5 are easy, 8 medium, 8 hard (far away, partly hidden, unusual cargo). The photos
  are not in the public repository.
- **Ground truth:** one annotation per photo, written by inspecting each photo at full resolution during
  development (with an AI assistant, not by an independent labeller): truck body, number of units where
  they can be counted, cargo types, and the number of straps, chains and ropes. Large counts (35 crates,
  20 cartons) are approximate; bulk loads (hay, loose wood) have no unit count.
- **Calls:** exactly the production call (`analyzePhotos`: the same prompt, JSON schema, `effort: low`),
  one photo per call, each photo first scaled as the phone scales it before upload (long edge 1568 px,
  `frontend/lib/inspection/image.ts`). Run with `pnpm eval:perception` in `backend/worker`; answers are
  cached per prompt version, model and photo, so a re-run only pays for what is missing. Raw numbers per
  photo: `docs/perception-eval.json`. Prompt version 2, evaluated on 2026-11-20 (BRT).
- **Scores:** unit count exact and within 20 % (at least ±1), the majority cargo type against the main
  ground-truth type (only where it is one of the product's types), truck body (where visible), the kind of
  restraint (rope if any rope, else chain, else strap, else none: the CONTRAN 945 question), whether ropes
  were found (any rope counted or a rope violation), and the absolute error of the strap + chain + rope
  counts. Every answer came from the model asked (the server-side fallback never answered).

21 photos is a small set, and a model does not answer a borderline photo the same way every time (see
"Prompt versions"): a difference of one or two photos between models is within noise. The large
differences (Haiku against the other two on ropes, restraint kinds and counts) are not.

## Results

| Measure | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
| --- | --- | --- | --- |
| Unit count exact | 4/14 | 5/14 | 6/14 |
| Unit count within 20 % (or ±1) | 5/14 | 6/14 | 7/14 |
| Main cargo type | 6/7 | 7/7 | 6/7 |
| Truck body | 18/18 | 18/18 | 18/18 |
| Kind of restraint (rope / chain / strap / none) | 13/21 | 18/21 | 18/21 |
| Ropes found (photos with ropes) | 5/9 | 8/9 | 8/9 |
| Ropes reported where there are none | 0/12 | 0/12 | 0/12 |
| Mean restraint count error (devices) | 3.1 | 1.5 | 1.0 |
| Mean input / output tokens | 4949 / 1409 | 4949 / 626 | 4949 / 640 |
| Mean cost per photo (US$) | 0.0012 | 0.0162 | 0.0326 |
| Mean time per call (s) | 7.9 | 5.2 | 6.6 |

Cost is measured from the token counts of each call at the list prices (input / output per million tokens:
Haiku 5.5 US$0.10 / 0.50, Sonnet 5.5 US$2 / 10, Opus 5.5 US$4 / 20, checked 2026-11-20). Haiku writes about
twice as many output tokens for the same schema.

### Cost per inspection (Opus 5.5)

An inspection sends its 1 to 4 photos in one call. Measured: one photo, US$0.033 on average (at most
US$0.042; 4,949 input tokens and 293 to 1,122 output tokens). Each further photo at 1568 px adds about
2,180 input tokens (measured with the token-counting endpoint, which is free), about US$0.009. So:

| Photos | Cost |
| --- | --- |
| 1 | US$0.03 (measured mean) |
| 2 | about US$0.04 |
| 4 | about US$0.06 (at most about US$0.07) |

Within the application cap of US$80 a month that is at least 1,100 four-photo inspections, or about 2,400
one-photo inspections. A repeated photo set is answered from the cache and costs nothing; the sample photos
never call the API. The quota (5 analyses per user per day) and the kill switch are unchanged.

## Per photo (prompt version 2)

Each cell: units seen, majority cargo type · restraints counted, ✓ when the kind of restraint is right.
"?" means the ground truth has no countable units (bulk or hidden).

| Photo | Difficulty | Truth: units · restraints | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
| --- | --- | --- | --- | --- | --- |
| `steel-structures-chains` | hard | ? · 5 chains | 1 crate · 2 chains ✓ | 1 machine · 4 chains ✓ | 2 crate · 4 chains ✓ |
| `logs-gooseneck-straps` | medium | 15 · 3 straps | 4 long_pipes · 3 straps ✓ | 3 long_pipes · 2 straps ✓ | 3 long_pipes · 3 straps ✓ |
| `scraper-lowboy-side` | hard | 1 · 2 chains | 1 machine · none ✗ | 1 machine · 2 chains ✓ | 1 machine · 2 chains ✓ |
| `hay-overloaded-ropes-xxK5QA6H3` | medium | ? · 8 ropes | 1 crate · 1 straps, 3 ropes ✓ | 3 stacked_boxes · 1 straps, 6 ropes ✓ | 2 sacks · 2 straps, 5 ropes ✓ |
| `pickup-sacks-overloaded` | medium | 8 · 2 straps, 2 ropes | 5 sacks · 4 straps ✗ | 5 sacks · 2 straps, 3 ropes ✓ | 4 sacks · 2 straps, 2 ropes ✓ |
| `logs-timber-trailer-stakes` | hard | ? · none | 1 long_pipes · none ✓ | 1 long_pipes · 1 straps ✗ | 2 long_pipes · 2 straps ✗ |
| `tipper-loose-wood` | easy | ? · 1 ropes | 2 long_pipes · none ✗ | 2 long_pipes · 1 straps ✗ | 1 long_pipes · 1 straps ✗ |
| `bamboo-bundle-hairpin` | medium | 1 · 7 ropes | 1 long_pipes · 4 straps ✗ | 1 long_pipes · 5 ropes ✓ | 1 long_pipes · 5 ropes ✓ |
| `green-pipes-straps` | easy | 3 · 5 straps | 3 long_pipes · 5 straps ✓ | 1 long_pipes · 4 straps ✓ | 1 long_pipes · 4 straps ✓ |
| `concrete-pipes-crane-truck` | hard | 8 · none | 1 long_pipes · none ✓ | 2 long_pipes · none ✓ | 7 long_pipes · 1 chains ✗ |
| `cartons-cage-light-truck-pyeJez` | medium | 20 · 1 ropes | 3 stacked_boxes · 1 straps ✗ | 4 stacked_boxes · 1 chains, 1 ropes ✓ | 5 stacked_boxes · 1 ropes ✓ |
| `hay-semi-rear` | medium | ? · 2 ropes | 1 crate · 2 ropes ✓ | 1 stacked_boxes · 2 ropes ✓ | 1 sacks · 2 ropes ✓ |
| `lumber-strapped-semi` | medium | 8 · 12 straps | 3 crate · 4 straps ✓ | 4 crate · 5 straps ✓ | 6 crate · 10 straps ✓ |
| `backhoe-lowbed` | easy | 1 · 1 straps, 2 chains | 1 machine · 1 straps, 2 chains ✓ | 1 machine · 1 straps, 2 chains ✓ | 1 machine · 1 straps, 2 chains ✓ |
| `plastic-crates-ropes` | easy | 35 · 6 ropes | 6 stacked_boxes · 6 ropes ✓ | 6 crate · 5 ropes ✓ | 6 stacked_boxes · 6 ropes ✓ |
| `tarped-load-ropes-semi` | hard | ? · 8 ropes | 1 crate · 6 straps ✗ | 1 stacked_boxes · 6 ropes ✓ | 1 sacks · 8 ropes ✓ |
| `steel-posts-racks-semi` | hard | 5 · 6 straps, 2 chains | 4 crate · none ✗ | 5 crate · 4 straps, 1 chains ✓ | 5 crate · 3 straps, 1 chains ✓ |
| `box-truck-pvc-profiles` | medium | ? · none | 3 stacked_boxes · none ✓ | 1 stacked_boxes · none ✓ | 1 crate · none ✓ |
| `round-straw-rolls-ropes` | easy | 18 · 5 ropes | 4 steel_coil · 4 ropes ✓ | 3 sacks · 4 ropes ✓ | 4 sacks · 5 ropes ✓ |
| `grader-lowbed-dirt` | medium | 1 · 1 chains | 3 machine · 2 chains ✓ | 1 machine · 2 chains ✓ | 1 machine · 2 chains ✓ |
| `lumber-packages-flatbed-side` | hard | 4 · none | 1 crate · 4 straps ✗ | 3 crate · 4 straps ✗ | 4 crate · none ✓ |

## Prompt versions

- **Version 1** gave the cargo types as a bare list. Opus 5.5 then called sawn-lumber packages
  `long_pipes`, which the product draws as a bundle of cylinders; cylinders cannot be stacked, so the
  stacks were dropped from the draft and the sample's fix could not be proven. With version 1 at 1568 px
  Opus scored 9/9 ropes, 19/21 restraint kinds, 1.2 devices of count error, 7/14 unit counts within 20 %.
- **Version 2** (current) adds one rule: `long_pipes` is only for round things lying lengthwise; a
  square-sided block (lumber, boards, profiles, a wrapped package) is a `crate` with its real size. Both
  lumber photos are now crates (6 packages in three stacks of two on `lumber-strapped-semi`). Opus: 8/9
  ropes, 18/21 kinds, 1.0 devices, 7/14. The rope it missed this time (one thin rope on
  `tipper-loose-wood`, read as a strap) it found with version 1; the prompt change does not touch ropes,
  so that is run-to-run variation on a borderline photo.
- A first run of version 1 sent the photos at their original size (2,400 px): about twice the input
  tokens (7,338 per photo; Opus US$0.042) and no better scores (Opus 8/9 ropes, 18/21 kinds). The phone's
  scaling to 1568 px loses nothing the analysis needs.

## Failures and what they mean for the product

- **Unit counts on big loads are low for every model** (35 crates → 6; 20 cartons → 3 to 5; 18 straw rolls
  → 4). The models describe stacks and rows as units. The product models a stack as one unit anyway, and
  the review step lets the driver add, split or remove units before anything is simulated; but the first
  draft of a large mixed load needs that review.
- **Cargo outside the product's list** is mapped to the nearest type: logs and bamboo to `long_pipes`,
  hay and straw to `sacks`, steel structures to `crate`. The simulation uses the dimensions and the
  weight the driver confirms, so the label matters less than the shape; the driver can change it.
- **Opus counted things that are not restraints** in two photos: the stakes of a timber trailer as
  2 straps (`logs-timber-trailer-stakes`) and a crane chain on a crane truck as a chain restraint
  (`concrete-pipes-crane-truck`). Sonnet made the first mistake too. These overstate the restraint, which
  is the unsafe direction; the review step shows the straps of each unit in the editor, next to the
  photo, so the driver can remove them before confirming.
- **A single thin rope can be read as a strap** (`tipper-loose-wood`), which hides a CONTRAN violation.
  The review step shows the restraint type as a choice the driver confirms or changes before the load
  is simulated.
- **Restraint counts on long loads** are often one or two short (5 chains → 4; 12 straps → 10), because
  straps at the far end are hidden. Missing straps make the battery stricter, not looser.
- **The draft keeps what fits the bed:** on `lumber-strapped-semi` three stacks of 4.8 m packages do not
  fit the semi's bed, so one stack is dropped and the review step says so ("Some units did not fit on this
  truck and were left out; add them if they are there.").
- **No model invented a rope** where there is none (0 of 12 for every model), and no answer carried a
  weight: the schema has no weight field and the Worker drops anything outside it
  (`backend/worker/src/perception/schema.ts`; tested in `backend/worker/test/flow.test.ts`).
- **Confidence is low across the board** (Opus reports 0.35 to 0.65 per photo), which is honest for
  single photos of loads taken from the road. The review step shows each unit's confidence and the
  model's "uncertain" note next to its number.
