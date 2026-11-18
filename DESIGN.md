# OrcaStrator — Design Reference

The visual language of the OrcaStrator console (`public/`). It is a warm,
editorial system with a dark theme (default) and a light theme: flat warm-on-warm layering, a serif display face
for headings and figures, a quiet sans for reading, and mono for data. Color is
rare and meaningful; a single fluorescent highlighter marks the primary action.

Mode: **Operate.** The console is a working tool for QA engineers, so
scanability and consistency come first and the brand lives in precise details.

## Principles

- **Flat and warm.** No shadows, no gradients, no cool grays as surfaces. Depth
  comes from stacking warm surfaces (canvas → card → paper) and 1px hairlines.
- **One loud color.** Highlighter yellow is reserved for the primary call to
  action and the brand mark. Never for status, charts or decoration.
- **Type does the hierarchy.** Serif display for page titles, panel titles and
  big numbers; sans for everything you read; mono for IDs, timestamps, table
  headers and captions.
- **Status colors are muted and earthy** so a page full of results stays calm,
  but each one keeps ≥ 4.5:1 contrast on the card surface.
- **Small radii.** 8px for cards, buttons and inputs; 4px for small chips;
  12px is the ceiling for anything.

## Color tokens

### Surfaces and ink

| Token | Name | Hex | Use |
|---|---|---|---|
| `--bg` | Limestone | `#ccc9c6` | Page canvas behind cards |
| `--panel` | Marble | `#f7f5f2` | Cards, sidebar, drawer, toasts |
| `--panel-2` | Paper | `#ffffff` | Inputs, hovered rows, nested surfaces |
| `--border` | Flint | `#e5e7eb` | Hairlines inside cards |
| `--border-2` | Stone | `#b9b5b1` | Card edges on the canvas, input borders |
| `--text` | Charcoal | `#1a1a1a` | Primary text |
| `--ink` | Onyx | `#000000` | Focus rings, active indicators, CTA text |
| `--text-2` | Graphite | `#47423d` | Secondary text; any muted text sitting on the canvas |
| `--text-3` | Pebble | `#736f6c` | Captions on cards (4.57:1 on Marble — never on Limestone) |
| — | Ash | `#94918e` | Disabled text and decorative rules only |
| `--display` | Twilight Indigo | `#3f3653` | Display accent: page title and brand name only |

### Highlighter (primary action and brand only)

| Token | Name | Hex | Use |
|---|---|---|---|
| `--hl` | Highlighter | `#f8ff2c` | Primary button fill, brand mark |
| `--hl-2` | Volt | `#ebf212` | Primary button hover |

### Status (muted, earthy)

| Token | Hex | Contrast on Marble | Meaning |
|---|---|---|---|
| `--ok` | `#2e6a43` | 5.9:1 | Passed, ready, healthy |
| `--warn` | `#8a5800` | 5.6:1 | Needs attention, waiting for approval |
| `--err` | `#a5372c` | 6.1:1 | Failed, blocked, down |
| `--info` | `#2f5878` | 6.9:1 | Running, in progress, active environment |
| `--purple` | `#6a4a7c` | 6.7:1 | Rejected, special states |
| `--muted` | `#736f6c` | 4.6:1 | Skipped, idle |

Each status has a `-bg` tint (the color at ~12% over the card) for pills and
callouts.

## Themes

The console opens in **dark**; the sun/moon button in the sidebar footer
switches to **light**, and the choice is remembered per browser
(`localStorage` key `orca-theme`). Themes are set with `data-theme` on
`<html>`; both share every rule above, only the tokens change. The light
tables above are the reference; the dark theme inverts them warmly:

| Token | Dark value | Notes |
|---|---|---|
| `--bg` | `#151412` | Warm near-black canvas |
| `--panel` | `#1f1d1a` | Cards, sidebar |
| `--panel-2` | `#292622` | Inputs, hovered rows |
| `--border` / `--border-2` | `#33302b` / `#48433d` | Hairlines / edges |
| `--text` / `--ink` | `#efebe5` / `#ffffff` | Text / focus and active marks |
| `--text-2` / `--text-3` | `#c4bdb4` / `#9a938a` | Secondary / captions (≥ 4.9:1 on every surface) |
| `--display` | `#cbbfe6` | Light indigo for page titles |
| `--ok` `--warn` `--err` `--info` `--purple` | `#86c296` `#e0ad55` `#ec8273` `#8db6d8` `#c0a2d8` | All ≥ 5.7:1 on cards |

Highlighter stays the same in both themes and always carries black text
(`--on-hl`). Solid status fills carry `--on-status` (white in light, canvas
color in dark). The logo swaps to `logo-light.png` in dark.

## Typography

All three families are self-hosted from `public/fonts/` (SIL Open Font
License, licenses alongside), so the console works offline and makes no
third-party requests.

| Role | Family | Settings |
|---|---|---|
| Display | Fraunces (variable) | weight 550, line-height ~1.05, tracking −0.01em, `opsz` auto |
| Body / UI | Inter (variable) | 14px/1.5, weight 400–600, tracking 0.009em |
| Data / captions | JetBrains Mono (variable) | 11–12.5px, tracking +0.012em; uppercase only for table headers and stat labels |

Scale: page title 26px · panel title 17px · KPI value 32px · donut total 28px ·
body 14px · small 12px · caption 11.5px.

Rules: no eyebrow/kicker labels above headings; numbers in tables and stats use
tabular figures.

## Spacing and shape

- 8px base: 4 · 8 · 12 · 16 · 24 · 32 · 48.
- Radii: `--radius` 8px (cards, buttons, inputs), `--radius-sm` 4px (pills,
  chips, tags, bars), 12px maximum.
- Borders are 1px. Cards on the canvas use `--border-2`; separators inside a
  card use `--border`.

## Components

- **Primary button** — Highlighter fill, Onyx text, 1px Onyx border, 8px
  radius, weight 600. Hover: Volt. One per view where possible.
- **Secondary button** — Ghost outline: transparent fill, 1px `--border-2`,
  Charcoal text. Hover: Onyx border.
- **Inputs and selects** — Paper fill, 1px `--border-2`, 8px radius. Focus:
  1px Onyx border plus a 2px Onyx outline offset by 2px (no glow).
- **Cards (`.panel`)** — Marble, 1px `--border-2`, 8px radius, no shadow.
  Panel titles in the display serif.
- **Pills** — 4px radius, status tint background, status text, icon or dot.
- **Navigation** — Graphite text; active item is Paper with a 2px Onyx bar on
  the left; icons follow the text color.
- **Accordion / disclosure rows** — full-width rows separated by Flint
  hairlines, title in body weight 600, chevron on the right.
- **Charts** — status tones only, on a Flint track; labels in mono; no
  gradients or shadows; real data only.
- **Toasts and drawer** — Marble with a 1px `--border-2` edge; the drawer
  backdrop is Charcoal at 35%.

## Browser surfaces

Selection is Highlighter; scrollbars use `--border-2` on transparent; focus is
always a visible Onyx outline.
