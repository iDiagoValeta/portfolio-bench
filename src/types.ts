// Contract between scripts/build-data.mjs (writer) and every section (readers).
// src/data/projects.json is generated: never edit it by hand.

export type CategoryId =
  | 'retrieval'
  | 'agents'
  | 'pipelines'
  | 'finetune'
  | 'safety'
  | 'vision'
  | 'foundations';

export interface Category {
  id: CategoryId;
  label: string;
  slot: 1 | 2 | 3 | 4 | 5 | 6 | 7; // palette slot, order of the categories
  blurb: string;
}

export interface Checks {
  readme: boolean;      // README over 1500 characters
  license: boolean;
  ci: boolean;          // at least one file under .github/workflows
  tests: boolean;       // a test/tests/__tests__ dir or *.test.* / test_*.py / *_test.* file
  description: boolean;
  topics: boolean;      // at least 3 topics
  shipped: boolean;     // homepage URL or at least one release; raw input of Project.shipped, not part of craft
}

export interface Project {
  repo: string;                 // GitHub repo name
  title: string;
  category: CategoryId;
  oneLiner: string;
  stack: string[];
  flags: string[];              // subset of 'local' | 'production' | 'featured'
  url: string | null;           // live site, if any
  repoUrl: string;
  createdAt: string;            // ISO
  pushedAt: string;             // ISO
  stars: number;
  commits: number;              // default branch
  languages: { name: string; bytes: number }[]; // sorted desc
  checks: Checks;
  craft: number;                // 0..1, share of the six hygiene checks (shipped excluded)
  depth: number;                // 0..1, log-scaled commits relative to the deepest curated repo
  weekly: number[];             // 52 weekly commit totals, oldest first
  recency: number;              // 0..1
  shipped: number;              // 0, 0.6 (live url or release) or 1 (flag "production")
  index: number;                // 0..100 integer
}

// Computed on every build from the projects, never written by hand.
export interface Facts {
  totalCommits: number;
  repos: number;
  reposThisYear: number;        // created in the asOf year
  withCi: number;
  withTests: number;
  shippedCount: number;         // projects with shipped > 0
  productionCount: number;      // projects flagged "production"
  firstCreatedAt: string;       // ISO, earliest createdAt
  topByCommits: { repo: string; title: string; commits: number };
  activeWeeks: number;          // of the last 52, weeks with a commit in any repo
}

export interface Dataset {
  asOf: string;                 // ISO date of the build-data run
  weights: { depth: number; craft: number; recency: number; shipped: number }; // index weights, from scripts/lib/metrics.mjs
  facts: Facts;
  categories: Category[];
  projects: Project[];          // sorted by index desc
}
