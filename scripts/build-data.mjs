// Build-time only: reads the curated list, queries the GitHub API and writes
// src/data/projects.json following the contract in src/types.ts.
// All network access lives in this file; scoring stays in lib/metrics.mjs.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checksFromTree,
  computeFacts,
  craft,
  depth,
  index as indexScore,
  INDEX_WEIGHTS,
  parseLastPage,
  recency,
  retryDelay,
  RETRY_MAX_ATTEMPTS,
  shipped as shippedScore,
  statsDecision,
} from './lib/metrics.mjs';

const OWNER = 'iDiagoValeta';
const API = 'https://api.github.com';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CURATION = resolve(ROOT, 'data/curation.json');
const OUTPUT = resolve(ROOT, 'src/data/projects.json');

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
}

const TOKEN = githubToken();
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'portfolio-bench-build',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function discardBody(res) {
  try {
    await res.body?.cancel();
  } catch {
    // a retry proceeds regardless of whether the old body can be cancelled
  }
}

async function ghGet(path, repo, { allow404 = false } = {}) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`${API}${path}`, { headers: HEADERS });
    } catch (cause) {
      throw new Error(`[${repo}] GET ${path} failed: ${cause.message}`, { cause });
    }

    if (res.status === 404 && allow404) return null;
    if (res.ok) return res;

    const headers = {
      'retry-after': res.headers.get('retry-after'),
      'x-ratelimit-remaining': res.headers.get('x-ratelimit-remaining'),
      'x-ratelimit-reset': res.headers.get('x-ratelimit-reset'),
    };
    const wait = retryDelay({ status: res.status, headers, attempt, now: Date.now() });

    if (wait === null || attempt >= RETRY_MAX_ATTEMPTS) {
      let detail = '';
      try {
        const body = await res.json();
        if (body?.message) detail = `: ${body.message}`;
      } catch {
        // keep the status code as the only detail
      }
      throw new Error(`[${repo}] GET ${path} failed (HTTP ${res.status})${detail}`);
    }

    await discardBody(res);
    console.warn(
      `[${repo}] GET ${path} -> HTTP ${res.status}; retrying in ${Math.round(wait)}ms ` +
        `(attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS}).`,
    );
    await sleep(wait);
  }
}

async function getJson(path, repo, options) {
  const res = await ghGet(path, repo, options);
  return res ? res.json() : null;
}

async function commitCount(full, repo) {
  const res = await ghGet(`/repos/${full}/commits?per_page=1`, repo);
  const last = parseLastPage(res.headers.get('link'));
  if (last !== null) return last;
  const commits = await res.json();
  return Array.isArray(commits) ? commits.length : 0;
}

// 52 weekly commit totals, oldest first. GitHub answers 202 while it computes
// them; after the retries we fail loudly instead of writing zeros.
async function weeklyCommits(full, repo) {
  const path = `/repos/${full}/stats/commit_activity`;
  for (let attempt = 1; ; attempt++) {
    const res = await ghGet(path, repo);
    const decision = statsDecision({ status: res.status, attempt });
    if (decision.action === 'done') {
      const data = await res.json();
      if (!Array.isArray(data) || data.length !== 52) {
        throw new Error(`[${repo}] ${path} returned ${Array.isArray(data) ? data.length : 'no'} weeks, expected 52`);
      }
      return data.map((week) => week.total);
    }
    await discardBody(res);
    if (decision.action === 'fail') {
      throw new Error(`[${repo}] ${path} still HTTP ${res.status} after ${attempt - 1} retries; refusing to write zeros`);
    }
    console.warn(`[${repo}] ${path} -> 202; retrying in ${decision.waitMs}ms (${attempt}/6).`);
    await sleep(decision.waitMs);
  }
}

async function readmeLength(full, repo) {
  const data = await getJson(`/repos/${full}/readme`, repo, { allow404: true });
  if (!data?.content) return 0;
  return Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8').length;
}

async function treePaths(full, repo, defaultBranch) {
  const data = await getJson(`/repos/${full}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`, repo);
  if (data?.truncated === true) {
    console.warn(
      `[${repo}] warning: git tree response was truncated; some paths are missing, ` +
        'so craft checks may be understated.',
    );
  }
  return Array.isArray(data?.tree) ? data.tree.map((entry) => entry.path) : [];
}

async function languages(full, repo) {
  const data = await getJson(`/repos/${full}/languages`, repo);
  return Object.entries(data ?? {})
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes);
}

// Bounded parallelism: enough to be quick, gentle enough on the API.
async function pooled(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  // allSettled keeps every in-flight runner's rejection collected, so a single
  // failure cannot leave unhandled promise rejections behind.
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(limit, items.length) }, runner),
  );
  const failed = settled.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  return results;
}

async function fetchRepo(item) {
  const repo = item.repo;
  const full = `${OWNER}/${repo}`;

  const res = await ghGet(`/repos/${full}`, repo, { allow404: true });
  if (!res) throw new Error(`[${repo}] curated repo is missing or private (HTTP 404)`);
  const meta = await res.json();
  if (meta.private) throw new Error(`[${repo}] curated repo is private`);

  const branch = meta.default_branch;
  const [commits, paths, readmeLen, releases, langs, weekly] = await Promise.all([
    commitCount(full, repo),
    treePaths(full, repo, branch),
    readmeLength(full, repo),
    getJson(`/repos/${full}/releases?per_page=1`, repo),
    languages(full, repo),
    weeklyCommits(full, repo),
  ]);

  const checkFlags = checksFromTree(paths, meta, readmeLen, Array.isArray(releases) ? releases.length : 0);

  return {
    item,
    meta,
    metrics: {
      commits,
      readmeLen,
      releasesCount: Array.isArray(releases) ? releases.length : 0,
      languages: langs,
      checks: checkFlags,
      weekly,
    },
  };
}

async function main() {
  const curation = JSON.parse(readFileSync(CURATION, 'utf8'));
  const now = new Date();
  const asOf = now.toISOString().slice(0, 10);

  const gathered = await pooled(curation.projects, 5, fetchRepo);

  // depth is relative to the deepest curated repo.
  const maxCommits = gathered.reduce((max, g) => Math.max(max, g.metrics.commits), 0);

  const projects = gathered.map(({ item, meta, metrics }) => {
    const craftScore = craft(metrics.checks);
    const depthScore = depth(metrics.commits, maxCommits);
    const recencyScore = recency(meta.pushed_at, now);
    const shipped = shippedScore(item.flags, item.url, metrics.checks.shipped);
    return {
      repo: item.repo,
      title: item.title,
      category: item.category,
      oneLiner: item.oneLiner,
      stack: item.stack,
      flags: item.flags,
      url: item.url ?? null,
      repoUrl: `https://github.com/${OWNER}/${item.repo}`,
      createdAt: meta.created_at,
      pushedAt: meta.pushed_at,
      stars: meta.stargazers_count ?? 0,
      commits: metrics.commits,
      languages: metrics.languages,
      checks: metrics.checks,
      craft: craftScore,
      depth: depthScore,
      weekly: metrics.weekly,
      recency: recencyScore,
      shipped,
      index: indexScore(depthScore, craftScore, recencyScore, shipped),
    };
  });

  projects.sort((a, b) => b.index - a.index || a.repo.localeCompare(b.repo));

  const dataset = { asOf, weights: INDEX_WEIGHTS, facts: computeFacts(projects, asOf), categories: curation.categories, projects };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(dataset, null, 2)}\n`);

  console.log(`Wrote ${OUTPUT} with ${projects.length} projects (as of ${asOf}, max commits ${maxCommits}).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
