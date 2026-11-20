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

## 10. 3D replay (not on the site yet)

There is no 3D on the landing page. It returns as its own "Click to explore" section once it can replay
real MuJoCo keyframes with materials that hold up next to the photographs: soft shadows, environment light
and realistic proportions. Until then nothing low-poly is shown.

What stays in the repository for that work, unmounted: the keyframes format and its tests
(`frontend/lib/keyframes.ts`), a basic player (`frontend/components/scene/keyframe-player.tsx`) and two
hand-made placeholder documents (`frontend/content/keyframes/`).

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
  "units": [{ "id": "pallet-1", "size_m": [1.2, 1.0, 1.1] }],
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
    "units": [{ "p": [2.0, 0, 0.552], "q": [1, 0, 0, 0] }],
    "straps": [{ "tension_n": 3000, "slide_m": 0 }]
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

Version 1 (hand-made placeholders, `source: "placeholder"`) had no `kind`, `routing`, anchor or unit
points and no `bed_accel_mps2`; the player in `frontend/lib/keyframes.ts` still reads version 1 until the
replay page is built.

## 11. Writing

- Plain verbs, sentence case, no exclamation marks. A button says what it does.
- English is the default; Brazilian Portuguese is a full translation written for truck drivers and
  carriers. The product is "Carga Segura" in pt-BR body copy; the wordmark stays "SecureCargo".
- Errors say what happened and what to do next.
- Every number shown to a visitor has a source recorded in the workspace `notes/`. The landing page
  currently shows no figures.
- No string is hard-coded in a component: all copy is in `messages/en.json` and `messages/pt-BR.json`,
  and a test keeps the two files in sync.

## 12. Quality bar

- **Lighthouse (mobile): performance ≥ 90 and accessibility ≥ 90** on `/` and `/app`, on the production
  build.
- Every visual change is compared side by side with the reference at 1440px and 375px, in both languages.
- Keyboard: every control reachable, visible focus ring.
- Images have explicit dimensions and a fixed aspect ratio; fonts use `display: swap`.
- No horizontal scroll at 320px.
