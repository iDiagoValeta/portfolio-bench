# portfolio-bench

Personal portfolio site that reads like an independent AI benchmarking site: every public
project is treated as a "model" under evaluation, compared on a few charts and opened as a
model card. All repository metrics come from the GitHub API at build time and carry an
"as of" date; CV facts come from `data/profile.json`.

## Run

```sh
pnpm install
pnpm dev       # http://localhost:5190
pnpm build     # type-check + vite build into dist/
pnpm test      # node --test test/*.test.mjs
```

## Refresh the data

```sh
node scripts/build-data.mjs
```

The script reads `data/curation.json`, queries the GitHub API and writes `src/data/projects.json`.
It uses `GITHUB_TOKEN` if set, otherwise `gh auth token`. Add or remove a project by editing
`data/curation.json`; CV facts, headlines and links live in `data/profile.json`.

## Where things live

| Path | Purpose |
|---|---|
| `src/` | App source (sections, styles, libs) |
| `data/curation.json` | Curated project list |
| `data/profile.json` | CV facts, headlines, links |
| `scripts/build-data.mjs` | Build-time GitHub data fetch and scoring |
| `DESIGN.md` | Design system and methodology |
| `dist/` | Static build output |

## Design and methodology

See `DESIGN.md` for the design tokens, layout, accessibility notes and the index formula.

## Deploy

`pnpm build` writes static output to `dist/` with `base: './'`, so it can be served from
any static host.