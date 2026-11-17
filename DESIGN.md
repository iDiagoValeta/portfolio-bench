# Design

A personal portfolio that reads like an independent AI benchmarking site. Every public
project is a "model" under evaluation; the visitor compares them on a few charts and opens
a model card for detail. Minimal: few numbers, all of them real or derived by a stated formula.

## Principles

- Real data only. Repository metrics come from the GitHub API at build time and carry an
  "as of" date. The index is computed by a published formula (see Methodology). CV facts
  come from `data/profile.json`.
- One idea per section, one chart per idea. No dashboards of twenty tiles.
- Light paper surface, black ink, three category colours. Colour means category, nothing else.
- Motion explains (bars grow to their value, the timeline draws left to right) and always
  respects `prefers-reduced-motion`.

## Tokens (`src/styles/tokens.css`)

| Role | Light | Dark |
|---|---|---|
| `--bg` page | `#fcfcfb` | `#121211` |
| `--surface` card | `#ffffff` | `#1a1a19` |
| `--ink` primary text | `#0b0b0b` | `#f0efec` |
| `--ink-2` secondary | `#52514e` | `#c3c2b7` |
| `--ink-3` muted / axis | `#8a8984` | `#8f8e87` |
| `--line` hairline / grid | `#e8e7e3` | `#2a2a28` |
| `--cat-llm` (slot 1, blue) | `#2a78d6` | `#3987e5` |
| `--cat-agents` (slot 2, orange) | `#eb6834` | `#d95926` |
| `--cat-ml` (slot 3, aqua) | `#1baf7a` | `#199e70` |

The three category colours are slots 1 to 3 of a validated categorical palette: they pass
the colour-blind separation checks for every pair, so they are safe in the scatter. Aqua is
below 3:1 on the light surface, so every chart with colour also has direct labels or the
table. Never add a fourth category colour.

Dark mode: tokens redefined under `@media (prefers-color-scheme: dark)` guarded by
`:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`. A toggle in
the nav sets `data-theme` and remembers it in `localStorage` (wrapped in try/catch).

Type, self-hosted with `@fontsource`:
- Display: Instrument Serif 400 (and italic) for h1/h2 and big numbers in tiles.
- UI: Inter variable, 15px base, 1.55 line height.
- Data: JetBrains Mono for every number, axis tick and code-like label.

Shape: cards `border: 1px solid var(--line)`, radius 14px, no shadows. Pills (buttons,
tabs, chips) radius 999px. Primary button is ink on bg (inverted). Section markers are a
10px ink square before the h2, like a figure label.

Layout: max width 1180px, 24px gutter (16px under 640px), sections separated by 120px.
No horizontal scroll at 360px wide.

## Sections (in order, ids are the anchors)

1. `#top` Nav: wordmark "Ignacio Diago Valeta" with a 2x2 grid of squares (three category
   colours plus ink), links to the sections, theme toggle, "CV" pill (links to `profile.links.cv`).
2. `#hero`: eyebrow `Independent benchmarks · data as of <asOf>` in mono. h1 serif:
   "Independent analysis of *one* AI engineer." (italic on "one"). Sub: `profile.tagline` +
   role and location. Two pills: "Explore the index" (anchor) and "Download CV".
   Below, the **fingerprint**: one thin vertical bar per project (all projects), height =
   index, colour = category, sorted by creation date, growing in sequence on load; hover
   shows project name and index; click opens the model card.
3. Headline tiles: the three `profile.headlines` as cards (big serif number + unit, label,
   small source chip). Count up once when visible.
4. `#index` "Engineering Index": horizontal bar leaderboard. Toolbar in one row: metric
   tabs (Index, Commits, Stars, Craft) and category chips (All + the three, each with its
   colour square). Top 12 by default, "Show all" expands. Bar label left (project title),
   value at the bar end in mono. Bars 4px rounded at the end, 2px gap. Tooltip on hover,
   click opens the model card. Colour follows the project's category even when filtered.
5. `#effort` "Index vs. effort": scatter, x = commits (log scale), y = index (0 to 100).
   Shaded quadrant top-left labelled "Most efficient" (high index, low effort). Dots 9px with
   a 2px surface ring, colour = category, direct labels on the 6 highest-index projects,
   tooltip on hover, click opens the card. Legend with the three categories.
6. `#trajectory` "Trajectory": time axis from 2022-01 to asOf. Top lane: experience roles as
   neutral bands with labels. Below: cumulative count of public projects as a step line in
   ink; each project is a dot on the step where it was created, coloured by category.
   Crosshair tooltip with date, count and the project created then. The line draws left to
   right when visible.
7. `#projects` "All projects": the table view of the same data, sortable by any column:
   rank, project (title + repo), category (square + label), index, commits, stars, updated
   (relative time), flags (Local, Production). Row click opens the card.
8. `#experience` "Changelog": experience as a vertical changelog (date range in mono, role,
   org and place, note), then education.
9. `#methodology` + footer: the index formula in plain words, the data date, contact links
   (email, GitHub, LinkedIn, Hugging Face, CV).

**Model card** (drawer from the right, full screen under 640px; Esc and backdrop close it,
focus is trapped and restored): title, category, one-liner, stack chips, flags, the index
with its three components as small bars, raw metrics (commits, stars, created, last push,
languages as a thin stacked bar with labels), and links (repository, live site).

## Methodology (computed in `scripts/build-data.mjs`)

- craft = share of passed checks: README over 1500 characters, licence, CI workflow,
  tests present, description, at least 3 topics, homepage or release.
- reach = log10(1 + stars) / log10(1 + max stars across projects).
- recency = max(0, 1 - months since last push / 24).
- index = round(100 * (0.5 craft + 0.25 reach + 0.25 recency)).
- effort = commit count on the default branch (shown, not part of the index).

## Accessibility

Every chart is an `<svg role="img">` with an `aria-label` summary, and the table in
`#projects` is the accessible view of all chart data. Interactive marks are focusable buttons
or have keyboard equivalents through the table. Contrast of text tokens at least 4.5:1.
