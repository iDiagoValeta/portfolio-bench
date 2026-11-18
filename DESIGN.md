# Design

A personal portfolio that reads like an independent AI benchmarking site. Every public
repository is a "model" under evaluation. Each section answers one question a
hiring manager asks. Minimal: few numbers,
all real or derived by a stated formula.

## Principles

- Real data only. Repository metrics come from the GitHub API at build time and carry an
  "as of" date. CV facts live in `data/profile.json`. Copy never hard-codes a count: it reads
  `data.facts` through `[data-fact]` attributes.
- One question per section, one chart form per question.
- Colour carries meaning. A category colour marks data (dots, bars, cells, petals), never
  text. Each section has a pale wash and a deeper accent that tints only marks and the
  section marker.
- Motion explains and always respects `prefers-reduced-motion`. Charts animate once, when
  they become visible.

## Tokens (`src/styles/tokens.css`)

| Role | Light | Dark |
|---|---|---|
| `--bg` page (warm paper, 3% grain on top) | `#f7f5f0` | `#121211` |
| `--surface` card | `#ffffff` | `#1a1a19` |
| `--ink` / `--ink-2` / `--ink-3` | `#141413` / `#55534d` / `#8a877f` | `#f0efea` / `#c3c1b8` / `#8f8d85` |
| `--line` hairline, grid | `#e7e3da` | `#2b2a27` |

Seven category colours, keyed by category id (never by rank), validated for contiguous
pairs in light and dark: `--cat-retrieval` blue, `--cat-agents` orange, `--cat-pipelines`
teal, `--cat-finetune` gold, `--cat-safety` magenta, `--cat-vision` green,
`--cat-foundations` violet. Only the first three pass every pair, so charts group by
category and always carry direct labels or a table.

Three section washes (`--wash-*`, lightness near 0.96) with a matching `--accent-*`, applied
by `.wash-*`, which sets `--accent` for the section: Index apricot, Trajectory lilac. Hero
and Methodology have no wash.

Dark mode: tokens redefined under `@media (prefers-color-scheme: dark)` guarded by
`:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`. The nav toggle
sets `data-theme` and remembers it in `localStorage` (in try/catch).

## Type (self-hosted `@fontsource-variable`)

- `--font-display`: Funnel Display, 550 to 750, titles and direct chart labels. Titles use
  `letter-spacing: -0.02em` and line height 1.05.
- `--font-ui`: Funnel Sans, 400 and 550, body text.
- `--font-data`: Martian Mono, every axis, tick, date and code-like label, tabular numerals.
- `--font-score`: Doto 800, a dot-matrix face used only for big scoreboard numbers (hero
  rose, production counters, section stats, the card index).
- Scale `--fs-1..--fs-7`: 12, 13, 16, 20, 28, 40, `clamp(44px, 6vw, 80px)`; Doto 64 to 96.

## Layout

12-column grid (`.grid-12`, `.span-*`), max width 1240px, 24px gaps, sections 96px apart
(56px under 640px). Cards have 28px padding (20px on mobile) and an 18px radius. From 1360px
a fixed side index shows a square in each section's accent. Everything collapses to one
column under 900px and has no horizontal scroll at 360px.

## Sections (ids are the anchors)

Four sections. Each curated repo appears once as a row; production sits inside the index.

1. `#hero`, 7 + 5 columns: eyebrow with the name, an h1 naming the three production
   systems, one-line intro, actions, and one row of three production stats from
   `profile.headlines` (Doto number, unit, short label, separated by 1px rules). The **rose**
   sits on the right with a caption: one radial petal per repo, length is the index, colour
   the category; petals rest desaturated and take full colour on hover or focus.
2. `#index` (apricot): the leaderboard, a real table and the accessible view of all data.
   Columns: rank, project (title and full one-liner), category square, shipped badge
   (Production, Live, Release), 52-week activity strip (category colour, opacity by weekly activity),
   six craft dots (filled when passed, the tooltip names the check), index bar and value.
   Tabs re-sort by Index, Depth, Craft, Recency or Shipped with a FLIP transition; category
   chips filter; top 10 and "Show all N". On mobile the secondary columns drop under the
   project line. Row click opens the card.
3. `#trajectory` (lilac), 8 + 4 columns:
   - **Chart**: cumulative repos from 2025 to the as-of day, a 2px ink step line over a
     gradient area, one focusable dot per repo in its category colour, a large label for the
     last value, annotations derived from data (first repo, busiest month, start of the
     current role), crosshair and tooltip. Role bands sit above the plot with dashed rules
     to the axis. Under 640px the bands become thin brackets under the axis with short
     labels staggered in rows so none touch. The plot takes the height of the experience
     list beside it.
   - **Experience**: vertical timeline of roles since 2025 and education, notes in full
     (the Auro AI entry carries the team of four and the engineering standard), current
     role marked in the accent.
4. `#methodology` and footer: the formula with the four weights read from `data.weights`,
   the definitions of depth, craft, recency and shipped, the six craft checks, the data
   date, and links (email, GitHub, LinkedIn, Hugging Face, CV). No results table.

**Model card** (drawer from the right, full screen under 640px; Esc and backdrop close it,
focus is trapped and restored, the page behind is inert; `#p/<repo>` deep-links to it):
category, title, one-liner, stack chips, flags, the index in Doto with Depth, Craft,
Recency and Shipped bars (0 to 100), the 52-week strip, the six craft checks as filled or
hollow dots with an "N of 6" count, one line saying whether it shipped (Production, Live
site or release, Not shipped), metrics (stars, created, last push), a stacked language bar and links.

## Methodology (computed in `scripts/build-data.mjs`, formulas in `scripts/lib/metrics.mjs`)

- depth = log-scaled size of the commit history, relative to the deepest repo (no commit counts are shown on the site).
- craft = share of six checks: README over 1500 characters, licence, CI workflow, tests
  present, description, at least 3 topics.
- recency = max(0, 1 - months since last push / 24).
- shipped = 1 if the curated flags include "production", 0.6 if there is a live URL or at
  least one release, else 0.
- index (v3) = round(100 * (0.40 depth + 0.20 craft + 0.15 recency + 0.25 shipped)). The
  weights are `INDEX_WEIGHTS` in `metrics.mjs`, the only place they are written; the build
  copies them to `projects.json` as `weights` and the UI reads them from there.
- Stars are shown on the card only; they are not part of the index.

## Accessibility

Chart SVGs are groups with an `aria-label` summary, and the leaderboard table is the accessible
view of the data. Every interactive mark is focusable with an `aria-label` and opens the
card with Enter or Space. Text tokens meet 4.5:1.
