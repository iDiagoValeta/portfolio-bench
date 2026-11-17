// Contract between scripts/build-data.mjs (writer) and every section (readers).
// src/data/projects.json is generated: never edit it by hand.

export type CategoryId = 'llm' | 'agents' | 'ml';

export interface Category {
  id: CategoryId;
  label: string;
  slot: 1 | 2 | 3;
  blurb: string;
}

export interface Checks {
  readme: boolean;      // README over 1500 characters
  license: boolean;
  ci: boolean;          // at least one file under .github/workflows
  tests: boolean;       // a test/tests/__tests__ dir or *.test.* / test_*.py / *_test.* file
  description: boolean;
  topics: boolean;      // at least 3 topics
  shipped: boolean;     // homepage URL or at least one release
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
  craft: number;                // 0..1
  reach: number;                // 0..1
  recency: number;              // 0..1
  index: number;                // 0..100 integer
}

export interface Dataset {
  asOf: string;                 // ISO date of the build-data run
  categories: Category[];
  projects: Project[];          // sorted by index desc
}
