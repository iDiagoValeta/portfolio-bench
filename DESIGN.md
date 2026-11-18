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

1. `#hero`, 7 + 5 columns: eyebrow with the name, an h1 that says what he builds (LLM
   systems, from local RAG to production assistants), an intro that walks the whole path
   (UPV and MonkeyGrab, Grupo CEU, Auro AI, Inditex, public agent tooling), actions, and one
   row of three career stats from `profile.headlines`, one per stage (MonkeyGrab at UPV,
   GPT-CEU at Grupo CEU, the team at Auro AI): Doto number, unit, short label, separated by
   1px rules. Headlines are stable CV facts, never commit, PR or star counts. The **rose**
   sits on the right with a caption: one radial petal per repo, length is the index, colour
   the category; petals rest desaturated and take full colour on hover or focus.
2. `#index` (apricot): the leaderboard, a real table and the accessible view of all data.
   Columns: rank, project (proof thumbnail, title and full one-liner), shipped badge
   (Production, Live, Release), 52-week activity strip (category colour, opacity by weekly
   activity), stacked index bar and value. Video thumbnails play muted while the row is
   hovered. Tabs re-sort by Index, Complexity, Depth, Craft, Shipped or Recency with a FLIP transition;
   category chips filter; top 10 and "Show all". On mobile the thumbnail sits beside the
   one-liner and the marks drop under it. Row click opens the card.
3. `#trajectory` (lilac), 8 + 4 columns:
   - **Chart**: cumulative repos from 2025 to the as-of day, a 2px ink step line over a
     gradient area, one focusable dot per repo in its category colour, a large label for the
     last value, annotations derived from data (first repo, busiest month, start of the
     current role), crosshair and tooltip. Role bands sit above the plot with dashed rules
     to the axis. Under 640px the bands become thin brackets under the axis with short
     labels staggered in rows so none touch. The plot takes the height of the experience
     list beside it.
   - **Experience**: vertical timeline of roles since 2025 and education, notes in full
     (Grupo CEU carries GPT-CEU and the OCR to CRM pipeline, Auro AI the team of four, the
     UPV degree its final project MonkeyGrab), current role marked in the accent. Production
     work at Grupo CEU and Auro AI is private, so it is told here and in the hero, never
     scored.
4. `#methodology` and footer: a one-sentence lead with the share of the score that is
   scope (complexity plus depth, computed from the weights), the formula with the five
   weights read from `data.weights`, the definitions of complexity, depth, craft, shipped
   and recency in that order (five columns, complexity alone on the first row under
   1024px), the six craft checks, the data date, and links (email, GitHub, LinkedIn,
   Hugging Face, CV). No results table.

**Model card** (drawer from the right, 440 to 760px wide, full screen under 640px; Esc and backdrop close
it, focus is trapped and restored, the page behind is inert; `#p/<repo>` deep-links to it):
category, title, one-liner, the **demo** with its caption and source, links (repository, live
site), flags and stack chips, the index in Doto with Complexity, Depth, Craft, Shipped and
Recency bars (0 to 100, five tonal steps of the category colour, `TONES` in `card.ts`), the 52-week strip, the six craft checks as filled or hollow dots with an "N of 6"
count, one line saying whether it shipped, created and last-push dates, and a stacked
language bar.

## Demos (`data/media.json`, files in `public/media/`)

One demo per project, so a visitor sees what it does before reading how it scores. Every demo is
the project really running: a recording of its live site, a terminal or agent session run for the
portfolio, a model retrained from the repo's own notebook and used on held-out inputs, or a demo
from the repo itself. Only apps that cannot run here (Azure, a webcam, a desktop theme) show a
screenshot of the real app. Each entry carries `kind`, `src`, `poster`, `thumb`, `w`, `h`, `alt`,
`caption` and `source` (what was run, on what input, when, and anything shortened); `null` means
no demo. Personal data in a capture is covered, never invented.

- `video`: VP9 WebM (or the H.264 MP4 a repo already ships), muted, looping, with controls and a
  full-screen button; autoplays in the card except under reduced motion. Browser demos are
  recorded with Chromium's screencast at 25 fps, terminal sessions with a real pty and xterm.js;
  long silences are cut and a "waited N s" badge marks where.
- `image`: WebP; click opens it full size; tall images are capped with an "Open full size" fade.
- `thumb`: a 224x140 crop of the frame that shows the result, used in the leaderboard row, where
  videos play muted after the pointer rests on the row.

`src/lib/media.ts` builds the thumbnail and the card demo; `src/styles/media.css` styles both.

## Methodology (computed in `scripts/build-data.mjs`, formulas in `scripts/lib/metrics.mjs`)

The index measures engineering scope first: how much source code a repo holds and how
long its owner worked on it carry 0.60 of the score, hygiene, shipping and freshness the
other 0.40.

- complexity = sqrt(code bytes / largest code bytes). Code bytes are summed from the git
  tree of the default branch (`codeSize`): files in a programming language, tests
  included. Notebooks, markup, styles, shell scripts, data, lockfiles, build output,
  dependencies, `data/`, `fixtures/` and `assets/` folders, minified bundles, type
  declarations and protobuf stubs do not count, nor `.c`/`.h` files named like a flex or
  bison grammar in the same repo (the generated scanner and parser). The square root keeps
  a codebase several times larger clearly ahead without zeroing small repos.
- depth = log10(1 + own commits) / log10(1 + most own commits). Own commits are those on the
  default branch authored by the owner's GitHub account, so bots (dependabot, the Action
  that publishes La Terminal's daily edition) and collaborators do not count. No commit
  counts are shown on the site.
- craft = share of six checks: README over 1500 characters, licence, CI workflow, tests
  present, description, at least 3 topics.
- shipped = 1 if the curated flags include "production", 0.6 if there is a live URL or at
  least one release, else 0.
- recency = max(0, 1 - months since last push / 24).
- index (v4) = round(100 * (0.40 complexity + 0.20 depth + 0.15 craft + 0.15 shipped +
  0.10 recency)). The weights are `INDEX_WEIGHTS` in `metrics.mjs`, the only place they are
  written, in display order; the build copies them to `projects.json` as `weights` and the
  UI reads them from there.
- Known limit: a generated file without a recognisable name or folder (for example a
  scene or palette emitted by a script) still counts as code.

## Accessibility

Chart SVGs are groups with an `aria-label` summary, and the leaderboard table is the accessible
view of the data. Every interactive mark is focusable with an `aria-label` and opens the
card with Enter or Space. Text tokens meet 4.5:1.
