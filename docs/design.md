# SecureCargo design system

Status: **approved by the owner on 2026-11-20.**

This document defines how the landing page (`/`) and the app (`/app`) look, move and read.
Tokens live in `frontend/app/globals.css`; every UI string lives in `frontend/messages/`.

## 1. Principles

1. **The physics is the picture.** The one loud thing on the page is the truck bed: cargo that slides when it
   is unsecured and stays put when it is secured. Everything around it is quiet paper, ink and hairlines.
2. **Amber means securement.** The single accent is the color of a ratchet strap. In the 3D scene the straps
   are the only amber objects; in the UI amber marks the primary focus of a view, never decoration.
3. **Numbers are instruments.** Every number and unit is set in mono with tabular figures, so values line up
   and read like a gauge, not like prose.
4. **Red and green are verdicts.** Status colors appear only on results (fail, pass). They never style
   buttons, links or headings.
5. **One sentence first.** Each screen answers "is it safe?" (or "what is this?") in one sentence before any
   detail. Details sit below, in the narrow column.

Structural references (layout rhythm and interaction patterns only): ollama.com, worldlabs.ai, afterquery.com.
No logos, images, copy or licensed fonts are taken from them.

## 2. Color

| Token              | Value     | Use                                                           |
| ------------------ | --------- | ------------------------------------------------------------- |
| `--paper`          | `#F8F8F3` | Page background                                               |
| `--ink`            | `#191918` | Text, primary pill, focus ring                                |
| `--muted`          | `#636361` | Secondary text, captions                                      |
| `--surface`        | `#E9E9E4` | Secondary pill, media frames, table header rows               |
| `--hairline`       | `#D6D6CF` | 1px dividers and frame borders (decorative)                   |
| `--control-border` | `#8A8A86` | Borders that identify a control (inputs, toggles)             |
| `--amber`          | `#F2A100` | **The accent.** Straps in 3D, active indicators, key marks    |
| `--amber-ink`      | `#8F5200` | The accent when it is text or a thin line on paper            |
| `--fail`           | `#B42318` | Fail verdicts (text, icon, 3D highlight)                      |
| `--fail-tint`      | `#FBE9E7` | Fail badge background                                         |
| `--pass`           | `#136F33` | Pass verdicts                                                 |
| `--pass-tint`      | `#E2F0E4` | Pass badge background                                         |

Contrast ratios (WCAG 2.x relative-luminance formula; AA needs 4.5:1 for text and 3:1 for control boundaries):

| Pair                               | Ratio   | Result                    |
| ---------------------------------- | ------- | ------------------------- |
| ink on paper                       | 16.52:1 | AAA                       |
| ink on surface                     | 14.44:1 | AAA                       |
| muted on paper                     | 5.65:1  | AA                        |
| muted on surface                   | 4.94:1  | AA                        |
| paper on ink (primary pill)        | 16.52:1 | AAA                       |
| **ink on amber**                   | 8.27:1  | AAA                       |
| **amber-ink on paper**             | 5.84:1  | AA                        |
| amber-ink on surface               | 5.11:1  | AA                        |
| fail on paper / on fail-tint       | 6.17:1 / 5.61:1 | AA                |
| pass on paper / on pass-tint       | 5.89:1 / 5.32:1 | AA                |
| control-border on paper            | 3.25:1  | AA (non-text)             |
| amber on paper                     | 2.00:1  | **not a text or boundary color** |

Rules that follow from the table:

- Amber `#F2A100` is a fill. Text placed on it is always ink. Paper-colored text on amber is not allowed.
- Amber on paper is only 2.00:1, so amber alone never carries meaning and never draws a control boundary.
  Where the accent must be text or a thin line, use `--amber-ink`.
- Verdicts never rely on color alone: a badge is icon + word + color.
- No gradients. No shadows. Depth comes from the two surface tones and hairlines.
- No dark mode for now. Tokens are named by role so a dark set can be added later without renaming.

## 3. Typography

All fonts are free and loaded with `next/font` (self-hosted at build time, `display: swap`, `latin` subset,
which covers pt-BR diacritics).

| Role     | Family                | Why                                                                              |
| -------- | --------------------- | -------------------------------------------------------------------------------- |
| Headings | **Instrument Serif**  | Proposed. One weight (400) plus italic; narrow, sharp display forms that hold up at 80px and keep long pt-BR headlines to two or three lines; the smallest font payload of the three candidates. |
| Body     | **Geist**             | Already shipped. Tabular figures and a plain, technical voice.                   |
| Mono     | **Geist Mono**        | Already shipped. Shares its skeleton with Geist, so numbers sit naturally in body text. |

Alternatives considered for headings: **Newsreader** (variable weight and optical size; the better choice if
we later want serif body text, but it reads more like a newspaper and is heavier) and **Gilda Display**
(classical and wide; one weight, no italic, and long headlines wrap to more lines on a phone).

Scale (fluid between 375px and 1440px):

| Token        | Family | Size                               | Line height | Notes                           |
| ------------ | ------ | ---------------------------------- | ----------- | ------------------------------- |
| `display`    | Serif  | `clamp(2.75rem, 7vw + 1rem, 5.5rem)` | 1.02      | Hero headline only; tracking −0.01em |
| `h2`         | Serif  | `clamp(2rem, 3vw + 1.25rem, 3.25rem)` | 1.08     | Section headings                |
| `h3`         | Serif  | `1.5rem`                           | 1.2         | Accordion titles, card titles   |
| `lead`       | Sans   | `clamp(1.125rem, 0.5vw + 1rem, 1.3125rem)` | 1.5 | Hero subtitle, section intros   |
| `body`       | Sans   | `1.0625rem`                        | 1.6         | Max line length 40rem           |
| `small`      | Sans   | `0.875rem`                         | 1.5         | Captions, footer                |
| `label`      | Mono   | `0.75rem`                          | 1.3         | Uppercase, tracking 0.08em, muted |
| `stat`       | Mono   | `clamp(2.5rem, 4vw + 1rem, 4rem)`  | 1           | Stats row numbers, tabular      |
| `data`       | Mono   | inherits                           | inherits    | Any number or unit inline       |

Rules:

- **Every number and unit is mono**: `1,200 kg`, `0.8 g`, `12 kN`, `80 km/h`, `R$ 4.500`. A `<Num>` component
  applies `font-mono tabular-nums`, keeps value and unit together with a no-break space, and formats per
  locale through next-intl (`1,200.5` in English, `1.200,5` in pt-BR).
- Section labels ("Problem", "How it works") are the `label` style, placed above the section heading.
  They are used once per section, not on every block.
- Serif is for headings only. No bold serif (the family has one weight); emphasis in body text is weight 500.
- Headings are sentence case. The hero headline ends with a period.

## 4. Layout

- **Alignment: left.** Headings, text and controls share one left edge on every breakpoint. Nothing is
  centered except content inside the media frame.
- **Two widths.** Reading column `40rem` for text; wide container `80rem` for media, grids and the nav.
  Both start at the same left edge; the reading column simply ends earlier.
- **Gutters:** 20px below 768px, 32px from 768px, 48px from 1280px.
- **Vertical rhythm:** sections are separated by 96px (mobile) / 160px (desktop) and a full-width hairline.
  Inside a section: label → 12px → heading → 24px → text.
- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48, 64, 96, 160.
- **Radii:** pills and badges are fully round; media frames 12px; inputs 8px. Nothing else is rounded.
- **No card boxes.** Groups are separated by hairlines and whitespace. A "card" is an image and text on the
  page, not a bordered, shadowed container.
- **Breakpoints:** design at 375px first, then 768px, 1024px and 1440px.

## 5. Components

- **Pill button.** Height 44px (40px in the nav), padding 0 20px, `body` size at weight 500.
  Primary: ink background, paper text. Secondary: surface background, ink text. Hover darkens the fill
  slightly; no movement. Focus: 2px ink ring with a 2px paper gap. One primary pill per view.
- **Text link.** Ink, underlined with a 1px underline offset by 4px; hover thickens the underline.
- **Section label.** `label` style. Plain text, no icon, no rule.
- **Media frame.** Surface background, 1px hairline, 12px radius, fixed aspect ratio so nothing shifts
  while it loads. Controls sit inside the frame on paper-colored pills.
- **Segmented toggle** ("Unsecured / Secured"). Two options in one pill-shaped track with a
  control-border outline; the selected option is an ink pill. It is a radio group for assistive tech.
- **Verdict badge.** Fully round, 28px tall, tint background, status-colored icon and word in `small` weight
  500: check + "Pass" / cross + "Fail". A neutral variant (surface background, muted text) covers "Checking…".
- **Stat.** `stat` number, then a `small` muted caption of at most two lines, then a source link.
- **Accordion.** Rows divided by hairlines. Each row: mono step number, serif title, plus/minus icon.
  One row open at a time; the open row shows its text and, on desktop, its visual in a frame on the right.
  On mobile the visual stacks under the text. Built on native buttons with `aria-expanded`.
- **Scenario card.** 4:3 duotone image (ink on surface) with an 8px radius, serif title, one line of text,
  "Run scenario" link. The whole card is one link target.
- **Data row** (app). Label on the left in muted sans, value on the right in mono, hairline between rows.
- **Nav.** 64px tall, sticky, paper background with a hairline below. Below 768px it shows the wordmark,
  the language switch and a menu button that holds the links; the primary pill joins from 640px, because
  on a phone the hero pill sits right under it.
- **Language switch.** "EN" / "PT" in mono; the active language is ink, the other muted. Real links.

## 6. Motion

CSS only, plus `IntersectionObserver`. No animation library.

| Motion             | Spec                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| Enter (fade-up)    | Opacity 0→1 and 12px upward, 500ms, `cubic-bezier(0.2, 0.7, 0.2, 1)`. Once per section, as one block (no per-item stagger beyond 3 items at 60ms). |
| Typing caret       | The hero subtitle types once at ~35ms per character, then the caret blinks three times and stops. |
| Accordion          | Height via `grid-template-rows` 0fr→1fr, 240ms; the visual cross-fades in 200ms.        |
| 3D replay          | Plays only while the frame is on screen and the tab is visible.                         |
| Hover              | Color changes only, 120ms. Nothing moves on hover.                                      |

Safeguards:

- **`prefers-reduced-motion: reduce`:** no fade-up, no typing (the subtitle is simply there), accordion
  opens instantly, the hero video is replaced by its poster, and the 3D scene shows a still frame with a
  "Play" button instead of autoplaying.
- Content is never hidden without JavaScript: the hidden starting state for fade-up is applied only after the
  script has marked the document as ready.
- The typed subtitle is in the DOM in full for screen readers and search engines; the animated copy is
  `aria-hidden`.

## 7. The hero scene

A framed, interactive React Three Fiber scene of a flatbed with cargo.

- **Look:** flat, matte materials in the page palette with ink edge lines; no textures, no environment
  map, soft ambient light plus one key light. Bed and ground in paper and surface tones, cargo boxes in a
  neutral wood tone, **straps in amber**. On failure, the unit that moved is outlined in fail red.
- **Behavior:** "Unsecured" replays a braking event in which the cargo slides forward into the headboard.
  "Secured" replays the same event with straps and the cargo stays put. A caption under the toggle says what
  happened in one sentence.
- **Controls:** segmented toggle, replay button, orbit by drag ("Click to explore" hint that disappears
  after the first interaction). Zoom and pan are disabled, so the scroll wheel and vertical touch
  scrolling always belong to the page.
- **Honest labeling:** until real simulation data exists, the frame carries a small "Illustration" label.
  It is removed when the scene replays MuJoCo keyframes.
- **Loading:** the frame first shows a static poster (a render of our own scene, WebP with explicit
  dimensions). On desktop, the scene module loads when the frame scrolls into view and the browser is idle.
  three.js and R3F are never part of the initial bundle.
- **Phones:** instead of the 3D scene, the frame plays a short looping video of the braking animation,
  rendered from our own scene: WebM with an MP4 fallback, `muted`, `autoplay`, `playsinline`, `loop`,
  no controls, 3–5 s, under 1 MB, with the poster as the video's `poster`. The video file is only requested
  when the frame is near the viewport. An "Explore in 3D" pill loads the interactive scene on demand.
- **Reduced motion:** with `prefers-reduced-motion: reduce` the video is not loaded and the 3D scene does
  not autoplay; the poster is shown, with "Explore in 3D" still available.
- **Fallback:** if WebGL is unavailable or the module fails to load, the poster (or video) stays with the
  caption.

### Keyframes contract (draft v1)

The player takes one JSON document per variant. The hand-made placeholder uses the same shape, so replacing
it with simulation output needs no player changes. The backend is the source of truth for this schema and
will finalize it in the physics phase.

```json
{
  "version": 1,
  "source": "placeholder",
  "fps": 30,
  "duration_s": 4.0,
  "bed": { "length_m": 6.0, "width_m": 2.4, "floor_height_m": 1.1, "headboard_height_m": 1.2 },
  "units": [{ "id": "u1", "size_m": [1.1, 1.2, 1.0] }],
  "straps": [{ "id": "u1-s1", "unit_id": "u1", "path_m": [[0.6, -1.2, 0], [0.6, -0.4, 1.0], [0.6, 0.8, 1.0], [0.6, 1.2, 0]] }],
  "events": [{ "t": 0.7, "kind": "braking" }],
  "frames": [
    {
      "t": 0.0,
      "truck_speed_mps": 15,
      "units": [{ "p": [0.9, 0.25, 0.5], "q": [1, 0, 0, 0] }],
      "straps": [{ "tension_n": 2500 }]
    }
  ],
  "result": { "status": "fail", "unit_ids": ["u1"] }
}
```

Conventions: SI units; right-handed frame with X to the front of the truck, Y to its left and **Z up**; the
origin is the center of the bed floor surface; quaternions are `[w, x, y, z]` (MuJoCo's order). `source` is
`"placeholder"` for hand-made animation and `"simulation"` for physics output. `truck_speed_mps` only moves
the road under the truck. `frames[].units` and `frames[].straps` follow the order of `units` and `straps`.
The player (`frontend/lib/keyframes.ts`, `frontend/components/scene/keyframe-player.tsx`) converts to
three.js (Y up, `[x, y, z, w]`) in one place and interpolates between frames.

The placeholder documents are written by `frontend/scripts/generate-placeholder-keyframes.mjs`; the
posters, phone videos and scenario stills are rendered from the scene by `frontend/scripts/render-media.mjs`.

## 8. Landing page blueprint

```
375px                                   1440px
┌──────────────────────────┐            ┌────────────────────────────────────────────────────────────┐
│ SecureCargo   EN PT (Try)│            │ SecureCargo      How it works  Demo  GitHub   EN PT   (Try) │
├──────────────────────────┤            ├────────────────────────────────────────────────────────────┤
│ Physics-tested           │            │ Physics-tested cargo                                       │
│ cargo securement.        │            │ securement.                                                │
│ subtitle▍                │            │ subtitle▍                                                  │
│ (Try the demo)           │            │ (Try the demo) (How it works)                              │
│ (How it works)           │            │ ┌────────────────────────────────────────────────────────┐ │
│ ┌──────────────────────┐ │            │ │ [Unsecured|Secured]                      Illustration  │ │
│ │   looping video      │ │            │ │                 3D truck bed                           │ │
│ │   (Explore in 3D)    │ │            │ │                                    Click to explore    │ │
│ └──────────────────────┘ │            │ └────────────────────────────────────────────────────────┘ │
│ caption                  │            │ caption                                                    │
├──────────────────────────┤            ├────────────────────────────────────────────────────────────┤
│ 00   caption  source     │            │ 00            00            00            00               │
│ 00   caption  source     │            │ caption       caption       caption       caption          │
├──────────────────────────┤            ├────────────────────────────────────────────────────────────┤
│ PROBLEM                  │            │ PROBLEM                                                    │
│ Heading                  │            │ Heading                                                    │
│ Editorial text, 40rem    │            │ Editorial text in the 40rem column                         │
├──────────────────────────┤            ├────────────────────────────────────────────────────────────┤
│ HOW IT WORKS             │            │ HOW IT WORKS                                               │
│ 1 Photo            −     │            │ 1 Photo        −  text         ┌─────────────────────────┐ │
│   text                   │            │ 2 Perceive     +               │  visual of the open step │ │
│   [visual]               │            │ 3 Simulate     +               │                         │ │
│ 2 Perceive         +     │            │ 4 Plan         +               └─────────────────────────┘ │
│ …                        │            │ 5 Certificate  +                                           │
├──────────────────────────┤            ├────────────────────────────────────────────────────────────┤
│ DEMO                     │            │ DEMO                                                       │
│ [img] Emergency braking  │            │ [img]          [img]          [img]          [img]         │
│ [img] Weigh station      │            │ Emergency      Weigh          Rope           Sharp         │
│ [img] Rope lashing       │            │ braking        station        lashing        curve         │
│ [img] Sharp curve        │            │ Run scenario   Run scenario   Run scenario   Run scenario  │
├──────────────────────────┤            ├────────────────────────────────────────────────────────────┤
│ GitHub · Hack Brasil     │            │ SecureCargo     GitHub   Hack Brasil 2026           EN PT  │
│ EN PT                    │            │ decision-support disclaimer                                │
└──────────────────────────┘            └────────────────────────────────────────────────────────────┘
```

Section notes:

1. **Nav.** Wordmark "SecureCargo" in the serif. Links: How it works (`#how-it-works`), Demo (`#demo`),
   GitHub (the repository). Primary pill "Try the demo" goes to `/app`.
2. **Hero.** Headline "Physics-tested cargo securement." One-line subtitle with the typing caret.
   Pills: "Try the demo" (primary), "How it works" (secondary, scrolls to the section).
3. **Hero scene.** As in section 7. The fade-up does not apply to the hero; it is visible at once.
4. **Stats row.** Four stats on desktop, two columns on mobile, mono numbers. Until the owner supplies cited
   figures, each stat renders the literal placeholder `TODO(source)` and is excluded from production builds
   by a flag, so no unsourced number can ship. Each real figure gets a source link and an entry in `notes/`.
5. **Problem.** Label, serif heading, three short paragraphs in the reading column. No images.
6. **How it works.** Accordion with five steps: Photo → Perceive → Simulate → Plan → Certificate. The steps
   are a real sequence, so they are numbered. The first step is open by default.
7. **Demo scenarios.** Four cards: emergency braking, weigh station, rope lashing, sharp curve. Images are
   duotone stills rendered from our own scene. Until scenarios exist, "Run scenario" opens `/app`.
8. **Footer.** GitHub, Hack Brasil 2026, language switch, and the decision-support disclaimer.

The landing page keeps the background `/health` request that warms the API container.

## 9. App (`/app`)

Same tokens, less of everything: one column (`40rem`), generous whitespace, mono values, verdict badges.

```
┌──────────────────────────┐
│ SecureCargo        EN PT │
├──────────────────────────┤
│ SIMULATION SERVER        │
│ Online  ✓                │   ← verdict badge: pass / fail / checking
│ ──────────────────────── │
│ Status               ok  │   ← data rows: label left, mono value right
│ API version       0.1.0  │
│ Physics engine    4.0.1  │
│ ──────────────────────── │
│ api.securecargo.app      │   ← mono, muted
└──────────────────────────┘
```

- The health view answers in one line first ("The simulation server is online."), then shows the rows.
- Unavailable state: fail badge, one sentence saying what happened and what to do, secondary pill "Try again".
- Loading state: neutral "Checking…" badge and three placeholder rows of fixed height (no layout shift).
- The app nav is the wordmark and the language switch only.

## 10. Writing

- Plain verbs, sentence case, no exclamation marks. A button says what it does ("Try the demo",
  "Run scenario", "Try again").
- English is the default; Brazilian Portuguese is a full translation, written for truck drivers and
  carriers, not translated word for word. The product is "Carga Segura" in pt-BR body copy; the wordmark
  stays "SecureCargo".
- Errors say what happened and what to do next. They do not apologize.
- Every number shown to a visitor has a source recorded in `notes/`.
- No string is hard-coded in a component: all copy is in `messages/en.json` and `messages/pt-BR.json`,
  and a test keeps the two files in sync.

## 11. Quality bar

- **Lighthouse (mobile): performance ≥ 90 and accessibility ≥ 90** on `/` and `/app`, measured on the
  production build.
- Checked in the browser at 375px and 1440px in both languages before every merge of visual work.
- Keyboard: every control reachable, visible focus ring, accordion and toggle operable with the keyboard.
- Images have explicit dimensions; the media frame reserves its space; fonts use `display: swap`.
- No horizontal scroll at 320px.

## 12. Decisions (approved 2026-11-20)

1. **Heading serif:** Instrument Serif.
2. **Accent:** amber `#F2A100`, with `#8F5200` as its text-safe companion.
3. **Phones:** a short looping video of the braking animation (WebM + MP4, under 1 MB) with the poster as its
   `poster`; the interactive 3D scene loads on "Explore in 3D". Reduced motion shows only the poster.
4. **Stats row:** hidden in production until real figures and their sources arrive; visible in development
   with `TODO(source)` placeholders.
5. **"Illustration" label** on the hero scene until it replays real simulation data.
