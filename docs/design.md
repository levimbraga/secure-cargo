# SecureCargo design system

Status: **second version, 2026-11-20.** It replaces the first design pass (large display type and a
low-poly 3D hero), which the owner rejected. This document describes what is built.

Tokens live in `frontend/app/globals.css`; every UI string lives in `frontend/messages/`.

## 1. Direction

Quiet, editorial and small. A warm paper page, one narrow column of text, a few black-and-white photographs
with film grain, and nothing louder than a 28px serif headline. The reference for structure and rhythm is
afterquery.com, with ollama.com for restraint in the app. No logos, images, copy or licensed fonts are taken
from them; the typefaces here are free and the photographs are separately licensed (section 6).

Principles:

1. **Small type, generous space.** Nothing on the site is larger than 28px. Hierarchy comes from typeface,
   color and whitespace, not from size.
2. **Whitespace separates sections.** There are no divider lines between sections.
3. **Photographs, not illustrations.** Real trucks, straps and roads, in monochrome or duotone. No drawings,
   no clip art, no low-poly 3D.
4. **Red and green are verdicts.** Status colors appear only on results (fail, pass).
5. **One sentence first.** Each screen answers its question in one sentence before any detail.

## 2. Color

| Token              | Value     | Use                                                         |
| ------------------ | --------- | ----------------------------------------------------------- |
| `--paper`          | `#F8F8F3` | Page background                                             |
| `--ink`            | `#191918` | Headings, primary pill, focus ring                          |
| `--gray`           | `#636361` | Body text, labels, captions                                 |
| `--surface`        | `#E9E9E4` | Secondary pill, icon tiles                                  |
| `--hairline`       | `#DEDED8` | Lines between data rows in the app (never between sections) |
| `--control-border` | `#8A8A86` | Borders that identify a form control                        |
| `--amber`          | `#F2A100` | Reserved accent: the browser icon today, straps in the future 3D section |
| `--fail`           | `#B42318` | Fail verdicts, on `--fail-tint` `#FBE9E7`                    |
| `--pass`           | `#136F33` | Pass verdicts, on `--pass-tint` `#E2F0E4`                    |

Scenario cards add one muted tone each, used only inside their duotone photograph: brown `#9C5B23`,
blue `#2D4995`, gold `#CDAF5D`, green `#026340`.

Contrast (WCAG 2.x relative-luminance formula; AA needs 4.5:1 for text):

| Pair                            | Ratio           |
| ------------------------------- | --------------- |
| ink on paper                    | 16.52:1         |
| gray on paper                   | 5.65:1          |
| gray on surface                 | 4.94:1          |
| paper on ink (primary pill)     | 16.52:1         |
| ink on surface (secondary pill) | 14.44:1         |
| fail on paper / on fail-tint    | 6.17:1 / 5.61:1 |
| pass on paper / on pass-tint    | 5.89:1 / 5.32:1 |

Rules: no gradients, no shadows, no dark mode for now. Verdicts are icon + word + color, never color alone.

## 3. Typography

All fonts are free (SIL Open Font License) and loaded with `next/font` (self-hosted at build time,
`display: swap`, `latin` subset, which covers pt-BR diacritics).

| Role            | Family            | Notes                                                          |
| --------------- | ----------------- | -------------------------------------------------------------- |
| Headings        | **Newsreader**    | Regular-width text serif, variable, with its optical-size axis |
| Body and UI     | **Inter**         | Variable; UI labels at weight 450                              |
| Labels and data | **Fragment Mono** | Section labels and values in data rows                         |

| Token             | Family | Size        | Line height | Weight | Color |
| ----------------- | ------ | ----------- | ----------- | ------ | ----- |
| `type-hero`       | Serif  | 24px → 28px | 1.2         | 500    | ink   |
| `type-hero-sub`   | Serif  | 20px        | 1.25        | 400    | gray  |
| `type-heading`    | Serif  | 24px        | 1.2         | 500    | ink   |
| `type-card-title` | Serif  | 19px        | 1.2         | 500    | ink   |
| `type-body`       | Sans   | 17px        | 1.5         | 400    | gray  |
| `type-small`      | Sans   | 14px        | 1.45        | 400    | —     |
| `type-label`      | Mono   | 12px        | 1.3         | 400    | gray  |
| Nav links, pills  | Sans   | 14px        | —           | 450    | ink   |

Rules: headings are sentence case and end with a period when they are sentences. Body text is gray; titles
are ink. Section labels ("Problem", "Our solution") are mono, not uppercase, one per section.

## 4. Layout

- **Reading column:** centered, 760px wide including 36px of padding on each side, so 688px of text.
- **Wide block:** centered, 1136px, for the hero photograph, the scenario cards, the nav and the footer.
- **Phone:** 16px side padding for both.
- **Vertical rhythm:** 80px from the nav to the headline and from the pills to the hero photograph; 112px
  before a section; 48px between a text block and a photograph; 20px between label, heading and body.
- **Radius:** 4px on photographs and icon tiles; pills and badges are fully round. Nothing else is rounded.
- **No section dividers, no cards with borders, no shadows.**

## 5. Components

- **Pill.** 32px tall, 12px side padding, 14px text at weight 450. Primary: ink with paper text.
  Secondary: `#E9E9E4` with ink text. Hover changes the fill only. One primary pill per view.
- **Nav.** 68px tall, sticky, paper background, no border. Wordmark (mark + "SecureCargo" in the serif) on
  the left, four small links in the center, two pills on the right (the other language, and the primary
  action). On phones: wordmark and a menu button; the menu holds the links, both languages and the action.
- **Section label.** `type-label`, plain text.
- **Photograph.** 4px radius, fixed aspect ratio, blurred placeholder while loading.
- **Step item** (2×2 grid). 44px surface tile with a 20px line icon, title in ink at weight 500, two or
  three lines of gray text. Icon beside the text on wide screens, above it on phones.
- **Scenario card.** Duotone photograph at 4:5, serif title, one gray line. The whole card is one link.
- **Verdict badge.** Fully round, 24px tall, tint background, status-colored icon and word.
  A neutral variant covers "Checking…".
- **Data row** (app). Gray label on the left, mono value on the right, hairline between rows.
- **Footer.** Wordmark on the left; on the right, small columns for the project link and the languages,
  and the decision-support disclaimer.

## 6. Imagery

- **Hero:** one black-and-white photograph, 1136px wide at about 2.5:1, high contrast, with film grain.
- **Second image:** a black-and-white photograph in the reading column at about 2.35:1.
- **Scenario cards:** duotone photographs at 4:5. Shadows are ink, midtones are the card's tone, highlights
  are a pale tint of it.
- **Sources:** free-license photographs only (Unsplash License or Pexels License), with no identifiable
  faces and no readable license plates. Every photograph, its author, its page and its license are listed
  in the README's photo credits.
- **Treatment:** `frontend/scripts/process-photos.mjs` crops each original, converts it to monochrome,
  raises the contrast, adds grain and, for the cards, applies the duotone. The site serves the results
  through `next/image` as AVIF or WebP, sized per device; images below the fold load lazily.
- **Not allowed:** illustrations, clip art, stock 3D, low-poly renders.

## 7. Motion

CSS only, plus `IntersectionObserver`. Three things move, and nothing else:

| Motion       | Spec                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| Enter        | Blocks below the fold fade in and rise 8px over 600ms, once.                                 |
| Typing caret | The hero subtitle types once at about 35ms per character; a thin caret keeps blinking after. |
| Hover        | Color changes only, 100ms.                                                                   |

With `prefers-reduced-motion: reduce` there is no fade, no typing and no caret. Content is never hidden
without JavaScript, and the full subtitle is always in the DOM for screen readers.

## 8. Landing page

```
1440px                                                     375px
┌──────────────────────────────────────────────────────┐   ┌────────────────────┐
│ ▣ SecureCargo    Problem  How it works  …   (PT)(Try) │   │ ▣ SecureCargo    ≡ │
│                                                      │   │                    │
│          Physics-tested cargo securement.            │   │ Physics-tested …   │
│          subtitle in gray serif ▍                    │   │ subtitle ▍         │
│          (Try the demo) (How it works)               │   │ (Try) (How)        │
│                                                      │   │ ┌────────────────┐ │
│ ┌──────────────────────────────────────────────────┐ │   │ │ B&W photograph │ │
│ │        black-and-white photograph, grain         │ │   │ └────────────────┘ │
│ └──────────────────────────────────────────────────┘ │   │ Problem            │
│          Problem                                     │   │ Heading            │
│          Heading in serif                            │   │ text               │
│          three short paragraphs                      │   │ ┌────────────────┐ │
│          ┌────────────────────────────┐              │   │ │ photograph     │ │
│          │ black-and-white photograph │              │   │ └────────────────┘ │
│          └────────────────────────────┘              │   │ Our solution       │
│          Our solution                                │   │ Heading, text      │
│          Heading, one paragraph, "How it works:"     │   │ ▢ Photo  ▢ Simul.  │
│          ▢ Photo        ▢ Simulation                 │   │ ▢ Plan   ▢ Certif. │
│          ▢ Plan         ▢ Certificate                │   │ Scenarios          │
│ Scenarios                               (Open app)   │   │ ▥ ▥                │
│ ▥ Braking   ▥ Weigh station   ▥ Rope   ▥ Curve       │   │ ▥ ▥                │
│ ▣ SecureCargo              Project  Language  note   │   │ footer             │
└──────────────────────────────────────────────────────┘   └────────────────────┘
```

1. **Nav.** Links: Problem, How it works, Scenarios, GitHub. Pills: the other language, "Try the demo".
2. **Hero.** Headline "Physics-tested cargo securement.", typed subtitle, two pills.
3. **Hero photograph.**
4. **Problem.** Label, heading, three short paragraphs.
5. **Second photograph.**
6. **Our solution.** Label, heading, one paragraph, then four steps in a 2×2 grid: Photo, Simulation, Plan,
   Certificate.
7. **Scenarios.** Heading, one line, a secondary pill, and four cards: emergency braking, weigh station,
   rope lashing, sharp curve. Until the scenarios exist, every card opens `/app`.
8. **Footer.**

The landing page sends a background `/health` request to warm the API container.

## 9. App (`/app`)

The same tokens in the same centered reading column: mono label, one serif sentence that answers the
question, a verdict badge, then data rows. The nav is the wordmark and the language pill.

```
▣ SecureCargo                                   (Português)

      Simulation server
      The simulation server is online.
      ✓ Online

      Status                                          ok
      API version                                  0.1.0
      Physics engine (MuJoCo)                      4.0.1
      Endpoint            https://api.securecargo.app/health
```

Unavailable: fail badge, one sentence on what happened and what to do, a secondary "Try again" pill.
Loading: neutral "Checking…" badge and placeholder values of fixed size, so nothing shifts.

## 10. 3D replay (`/app/scenarios/[id]`)

There is still no 3D on the landing page; the scenario cards there are photographs and open the replay
pages. The replay lives in the app and its job is to **prove the physics**: everything that moves or is
drawn as a force comes from the simulation output, and the page shows where each number comes from.

Page, in the reading column, top to bottom: mono label, one serif sentence that answers "is it safe?",
verdict badge, one paragraph of why; the two pills "As loaded / Fixed" (the selected one is the primary)
with the view choice "Realistic / Engineering" beside them; the scene; the timeline (play pill, range
input, mono clock), the markers of the event and the speed choice; a legend of the arrows and colours;
MuJoCo's own render; three charts; the result rows; the findings.

**What the scene shows, in both views**

- **Motion of the trip.** Every pose is relative to the truck, so the truck stands still and the road
  streams past at the truck's real speed from the keyframes: lane dashes, roadside posts and the grain of
  the surface. Under braking it visibly slows to a stop. A read-out in the corner gives the speed in km/h
  and the acceleration in g. The body dips at the nose under braking and leans in curves (2° and 4° per
  g), rides up over a speed bump by the simulated height, and the camera falls slightly behind a braking
  truck. These four are visual only and are driven by the acceleration profile.
- **Forces.** Above each unit, two arrows to one scale (1 m = 10 kN, the same in every scenario): the
  inertia the motion of the truck asks of it (mass × acceleration, ink) and against it the most friction
  can give (friction factor × the floor force exported by the engine, green). When inertia is the longer
  one the unit slides and the arrow turns red.
- **Lashings** are coloured by the tension they carry on a continuous scale: neutral when slack, amber at
  half their capacity LC, red at LC. Pointing at a lashing, or tapping it, shows its force in daN and as a
  share of LC.
- **Where things were.** A dashed outline marks where each unit started and a line traces where its base
  has been; a red ring opens where a unit hits the headboard.

**Realistic view** (default). Physically based materials, light from a studio environment generated in
the browser, one sun with soft shadows, ACES tone mapping (on phones and weak GPUs: no shadow maps and
no environment, see the budget below). A two-axle truck with a plank deck, pallets
with cartons under stretch film, crates, plastic pallets, a machine on a skid, sheet-steel cabinets,
ratchet straps, chains and rope. All of it is built in code: nothing is downloaded, and every unit fills
exactly the box the simulation used. Bed and headboard have the simulated dimensions.

**Engineering view.** The look of a physics debugger: checkered ground (1 m squares), translucent
bodies with their axes, the solver's contact points with their normal forces, the tension of every
lashing and the two forces on every unit as numbers, and the axes of the bed frame.

**Engineering view on a phone** (viewport at most 480px wide; wider screens keep the text labels
above). There is no room for a line of text per lashing and per unit, so the scene carries one
**numbered marker per unit** and nothing else: a 24px disc (paper with an ink border; ink when its
panel is open; red, like the inertia arrow, while inertia exceeds the friction available) inside a
44 × 44px tap target, on the middle of the unit. Tap targets never overlap: a marker that would
cover another moves up or aside and a hairline points back at its unit. The markers are buttons,
in the order of the units, named "Pallet 2: show the forces". Tapping one opens a **panel directly
under the scene** (surface fill, 4px radius, no border): the disc and the name of the unit, a
44px close button, and rows in `type-small` with mono values for inertia (m·a), friction
available (μ·N), floor force, slide so far, and each lashing as tension of capacity in daN with the
share. The numbers follow the replay clock. Tapping the marker again, the close button or Escape
closes it; the close button returns the focus to the marker. The lashing under the pointer still
shows its force in both views.

**MuJoCo's own render.** Under the scene, a short clip of the same run drawn by MuJoCo's renderer
(`backend/scripts/render_demo_videos.py`): the frames are taken during the run that produces the
keyframes, from the same model, with the engine's contact points and tendons. It plays on the clock of
the replay. This is the evidence that the scene above is the simulation and not a drawing.

**Charts.** Three small charts on the time axis of the replay: truck acceleration (g), slide of each
unit (cm) and lashing force (daN) with the capacity as a reference line. A vertical cursor is the replay
clock; dragging on a chart moves it. The stretch played in slow motion is shaded. Series colours are a
fixed categorical order (blue `#3B6FD4`, orange `#C8501E`, teal `#168F7A`) checked for contrast and
colour-blind separation against the page background; with more than a few lashings they are drawn in
neutral gray with the highest tension in ink. Values at the cursor sit in the legend, and a data table is
one click away.

**Playback.** 0.25×, 0.5×, 1× and "Auto" (default): normal speed, slowed to 0.25× from just before the
load starts to move until a second after. The replay starts by itself the first time the scene is on
screen, except with `prefers-reduced-motion: reduce`.

**Mobile performance budget** (the replay and the live lab share it; the pieces are
`lib/quality.ts`, `lib/use-quality.ts`, `lib/use-scene-visibility.ts` and the player itself).

| Rule                       | How                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Mount only when visible    | The canvas and its WebGL context are created the first time the frame is within 200px of the viewport. Scrolled away, the canvas stays but draws nothing (`frameloop="never"`). |
| Render on demand           | Every frame while playing; when paused, only when the time, the view, the camera or a selection changes. |
| Pixel ratio                | At most 1.5 device pixels per CSS pixel, at both quality levels.                        |
| Quality `high` / `low`     | `pickQuality` returns `low` for a software renderer, a mobile GPU (Mali, Adreno, PowerVR, Apple GPU behind a touch screen, …), a touch screen under 768px, 4 cores or fewer, or 4 GB or less. `low` has no shadow maps and no environment map: the same sun, a sky light, and one flat contact shadow under the truck. |
| Hidden tab                 | On `visibilitychange` the clock stops and the canvas draws nothing; both go on when the tab is back, if the replay was playing. |

ACES tone mapping is part of the material shaders, not a pass, and multisampling is cheap on
tile-based phone GPUs: both stay on at `low`. There is no post-processing at either level.
One finger scrolls the page over the scene (`touch-action: pan-y`); dragging sideways turns the camera.

**Without WebGL** (or if the scene fails) MuJoCo's clip takes the place of the scene; the sentence, the
verdict, the timeline, the charts and the numbers are plain HTML and keep working.

**Loading.** The frame has a fixed aspect ratio, so nothing shifts. three.js is loaded only on these
pages, after the text is on screen; the clip loads its metadata only until it plays.

### Keyframes contract (v2)

The backend is the source of truth (`backend/physics/results.py`, model `Keyframes`). `POST /simulate`
returns it as `result.keyframes`, and the precomputed demo files in `frontend/public/demo/` carry the same
document.

```json
{
  "version": 2,
  "source": "simulation",
  "fps": 30,
  "duration_s": 4.172,
  "bed": { "length_m": 6.2, "width_m": 2.4, "floor_height_m": 1.25, "headboard_height_m": 1.2, "side_rail_height_m": 0 },
  "units": [{ "id": "pallet-1", "size_m": [1.2, 1.0, 1.1], "mass_kg": 900, "friction_coefficient": 0.45 }],
  "straps": [{
    "id": "pallet-1-s1", "unit_id": "pallet-1", "kind": "strap", "routing": "top_over",
    "lashing_capacity_n": 25000,
    "anchor_points_m": [[2.0, 1.2, 0], [2.0, -1.2, 0]],
    "unit_points_m": [[0, 0.5, 0.55], [0, -0.5, 0.55]],
    "path_m": [[2.0, 1.2, 0], [2.0, 0.5, 1.1], [2.0, -0.5, 1.1], [2.0, -1.2, 0]]
  }],
  "events": [{ "t": 0.3, "kind": "braking_start" }],
  "frames": [{
    "t": 0.0,
    "truck_speed_mps": 22.222,
    "bed_accel_mps2": [0, 0, 0],
    "units": [{ "p": [2.0, 0, 0.552], "q": [1, 0, 0, 0], "n": 13898 }],
    "straps": [{ "tension_n": 3000, "slide_m": 0 }],
    "contacts": [[2.6, 0.5, 0.001, 3475, "floor"]]
  }],
  "result": { "status": "fail", "unit_ids": ["pallet-1"] }
}
```

Conventions: SI units; right-handed frame with X to the front of the truck, Y to its left and **Z up**; the
origin is the center of the bed floor surface and moves with the bed, so every pose is relative to the truck;
quaternions are `[w, x, y, z]` (MuJoCo's order). `frames[].units` and `frames[].straps` follow the order of
`units` and `straps`.

Drawing a strap at a frame: `anchor_points_m` are fixed on the bed; `unit_points_m` are relative to the
unit's center and move with it (rotate by `q`, add `p`). A top-over strap runs anchor, unit point, unit
point, anchor and may slide along the unit: add `slide_m` to the X of both unit points before
transforming. A direct lashing runs anchor to unit point. `path_m` is the path as installed.
`bed_accel_mps2` is the acceleration of the bed (braking is negative X), for a g-force readout.

Forces: `units[].n` in a frame is the force with which the floor holds that unit up, in newtons, averaged
since the previous frame (a sliding unit chatters, so single instants are noise). Friction can give at
most `friction_coefficient × n`; the inertia the unit feels is `mass_kg ×` the bed acceleration, opposite
to it. `contacts` are the solver's contact points: x, y, z in the bed frame, normal force in newtons, and
what the unit touches (`floor`, `headboard`, `rail`, `unit`, `road`).

Version 1 (hand-made placeholders, `source: "placeholder"`) had no `kind`, `routing`, anchor or unit
points and no `bed_accel_mps2`. `frontend/lib/keyframes.ts` reads both versions; the site only shows
version 2.

## 11. Live lab (`/app/lab/[id]`)

The replay shows a run the server computed. The lab **computes it again in the browser** (MuJoCo
WebAssembly stepping the server's model, `frontend/lib/live/`) every time a control changes, and steps it
live while it plays, so the visitor can push the cargo. `?variant=as_loaded|fixed` picks the version of
the load and is read in the browser; the page itself is static. The replay links to it ("Open the live
lab", under the timeline) and so does the list on `/app`; the lab links back.

It is the one app page on the **wide block**: from 1024px the result and the controls sit in a 320px
column beside the scene, so a change and its effect are on screen together. Below that it is one reading
column in this order, which is also the DOM and focus order:

1. **Header.** Mono label "Live lab" with "Back to the replay" opposite, the scenario title in the serif,
   the pills "As loaded / Fixed" and the view choice "Realistic / Engineering".
2. **Result**, above the fold with the scene at 375px: verdict badge; the reason as **one serif sentence
   with numbers** built from the run (`lib/live/reason.ts`: "Inertia 6.7 kN > friction 4.8 kN: Pallet 2
   slides 81 cm and hits the headboard."); the EN 12195-1 check in one small line; and a neutral badge
   **"Live, not certified"** with one mono line saying the run was simulated in the browser, how long it
   took, and that certificates only use the server's result. When the server simulated the run instead,
   the badge reads "Simulated on the server" and the line says why (no WebAssembly, the engine did not
   load, the device is too slow). While the next run is computed the previous result stays under a 2px
   progress bar. Errors are one red sentence; "the API is not answering" offers "Back to the scenario as
   authored".
3. **Scene.** The same player as the replay, with everything section 10 describes (both views, read-out,
   force arrows, lashing colours and labels, ghosts, impact ring, phone markers and panel). Under it:
   Play / Pause, one frame back, one frame forward (1/30 s) and Restart as pills (icon pills for the last
   three), the scrubber and clock, the event markers and the speed choice.
4. **Controls.** Rows with a hairline above each, gray label left, value in mono right: event (select),
   speed 20 to 100 km/h (slider), road surface (select), straps per unit (number field with − and +),
   strap pretension in daN (slider), mass per unit in kg (slider), anti-slip mat (checkbox). A change
   applies at once. A control put back on its authored value counts as unchanged; otherwise a text link
   "Back to the scenario as authored" appears. Controls are 44px tall on phones.
5. Legend, MuJoCo's own render (only for the scenario as authored: with changed controls it would show
   another load), the three charts, the result rows and the findings, as on the replay.

**Live stepping.** Playing a run the browser simulated does not replay keyframes: the engine is put at
the keyframe of the current time (`seek`) and stepped by the replay time that passes each animation
frame (2 ms steps, at the playback speed, at most 10 ms of stepping per frame, so a slow device slows
the clock instead of freezing). Untouched, that is the same motion as the keyframes. Paused, scrubbing
and stepping by frame show the keyframes; so do runs from the server, and a device that stays under half
the asked speed for two seconds (the caption under the scene says which). After the end of the event the
engine goes on with the bed at rest ("free play") and pauses by itself after three seconds without a push.
While a new run is being computed the clock and the scene wait.

**Pushing the cargo.** Pressing on a unit and dragging pulls it with a spring toward the pointer, on a
horizontal plane at the height of the grab: the full force, 1.5 times the unit's weight, is reached 40 cm
away. The force acts on the unit's centre and is drawn as a blue arrow (`#3B6FD4`, the first chart
colour) to the scale of the other arrows; the read-out shows it in kN. While a unit is held the camera
does not turn and the touch does not scroll the page; one finger anywhere else on the scene still
scrolls. A drag on a paused scene starts the engine. The same is possible without a pointer: a select
for the unit and four pills (Forward, Back, Left, Right) that push with the unit's weight for a quarter
of a second. Once the cargo was pushed, a line says **"You pushed the cargo: the verdict is for the
undisturbed run"**, how far the unit is from its start, and offers Restart. The verdict never changes
with a push.

**Budget and fallbacks.** The budget of section 10 holds (mount when visible, on demand when paused,
pixel ratio 1.5, `low` quality on phones, nothing while the tab is hidden: the stepping loop stops with
the rendering). The engine (2.8 MB gzipped) is requested only by this page. Without WebGL the result,
the controls, the charts and the numbers work; the frame shows MuJoCo's clip for the scenario as
authored and one sentence otherwise.

**For tests.** The root element carries `data-lab-state` (`loading`, `running`, `ready`, `error`) and
`data-lab-result` (the parity summary of the run, its source and its time); the controls carry
`data-testid="lab-…"`. `frontend/e2e/parity.spec.ts` reads them.

## 11a. Explorer (`/app/explorer`) and gallery (`/app/examples`)

**Explorer.** The same column grid as the live lab. Phones: the verdict and its reason sentence, then the
load editor, the selectors, the 3D run and the result rows. Wide screens: the editor and the 3D run on the
left, the verdict and the selectors in a 20rem column beside them.

- **Load editor.** The bed from above, front (cab) to the right, drawn with the simulation's dimensions:
  lashing points as gray dots, axle groups as dashed lines, the headboard as a thick ink line, blocks in
  wood brown, units in a pale wood fill with their number in a corner, straps in amber across the bed,
  the centre of mass as a small cross. Drag snaps to 5 cm; a drop on another unit is refused (fail tint
  and a one-line message). A tap adds a strap; after the last one the unit's lashing points allow, it goes
  back to none. Keyboard: each unit is a button; arrows move it 10 cm, Enter adds a strap.
- **Axle loads** under the editor: one row per axle group, value in mono, a thin bar to 125 % of the
  limit. Green up to 90 %, amber to 100 %, red above (the one place amber is a status: it is "close").
- **Units list** under the axle loads: name, mass and − / + strap buttons, 44 px on phones, for loads
  whose units are too small to tap on the drawing.
- **Selectors**: one native select per dimension, speed as a slider that applies on release, unit count
  as a stepper, mass per unit as a slider. Data rows with hairlines, as the lab's controls.

**Gallery.** One hairline row per example: MuJoCo's raw render of the "as loaded" run (poster, plays on
demand), the title, the trip in mono, two lines "As loaded" / "Fixed" with a verdict badge and the
one-sentence story, and the ways in (replay, live lab, explorer as loaded and fixed) as small mono
links. Then the coverage matrix: one small table per dimension, option and the examples that show it;
an option nobody shows yet reads "not yet" in gray italics (not red: it is not a verdict).

**App home (`/app`).** One sentence, a primary pill to the explorer and a secondary one to the gallery,
then the examples as rows: title over the trip line, and the three ways in under them on a phone (each
44 px tall), beside them from 640 px.

## 12. Writing

- Plain verbs, sentence case, no exclamation marks. A button says what it does.
- English is the default; Brazilian Portuguese is a full translation written for truck drivers and
  carriers. The product is "Carga Segura" in pt-BR body copy; the wordmark stays "SecureCargo".
- Errors say what happened and what to do next.
- Every number shown to a visitor has a source recorded in the workspace `notes/`. The landing page
  currently shows no figures.
- No string is hard-coded in a component: all copy is in `messages/en.json` and `messages/pt-BR.json`,
  and a test keeps the two files in sync.

## 13. Quality bar

- **Lighthouse (mobile): performance ≥ 90 and accessibility ≥ 90** on `/`, `/app` and the scenario
  pages, on the production build.
- Every visual change is compared side by side with the reference at 1440px and 375px, in both languages.
- Keyboard: every control reachable, visible focus ring.
- Images have explicit dimensions and a fixed aspect ratio; fonts use `display: swap`.
- No horizontal scroll at 320px.
