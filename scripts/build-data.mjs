// Build-time only: reads the curated list, queries the GitHub API and writes
// src/data/projects.json following the contract in src/types.ts.
// All network access lives in this file; scoring stays in lib/metrics.mjs.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checksFromTree, craft, index as indexScore, parseLastPage, reach, recency } from './lib/metrics.mjs';

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

async function ghGet(path, repo, { allow404 = false } = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, { headers: HEADERS });
  } catch (cause) {
    throw new Error(`[${repo}] GET ${path} failed: ${cause.message}`, { cause });
  }
  if (res.status === 404 && allow404) return null;
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      if (body?.message) detail = `: ${body.message}`;
    } catch {
      // keep the status code as the only detail
    }
    throw new Error(`[${repo}] GET ${path} failed (HTTP ${res.status})${detail}`);
  }
  return res;
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

async function readmeLength(full, repo) {
  const data = await getJson(`/repos/${full}/readme`, repo, { allow404: true });
  if (!data?.content) return 0;
  return Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8').length;
}

async function treePaths(full, repo, defaultBranch) {
  const data = await getJson(`/repos/${full}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`, repo);
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
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
  const [commits, paths, readmeLen, releases, langs] = await Promise.all([
    commitCount(full, repo),
    treePaths(full, repo, branch),
    readmeLength(full, repo),
    getJson(`/repos/${full}/releases?per_page=1`, repo),
    languages(full, repo),
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
    },
  };
}

async function main() {
  const curation = JSON.parse(readFileSync(CURATION, 'utf8'));
  const now = new Date();
  const asOf = now.toISOString().slice(0, 10);

  const gathered = await pooled(curation.projects, 5, fetchRepo);

  // reach needs the maximum star count across every curated project.
  const maxStars = gathered.reduce((max, g) => Math.max(max, g.meta.stargazers_count ?? 0), 0);

  const projects = gathered.map(({ item, meta, metrics }) => {
    const craftScore = craft(metrics.checks);
    const reachScore = reach(meta.stargazers_count ?? 0, maxStars);
    const recencyScore = recency(meta.pushed_at, now);
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
      reach: reachScore,
      recency: recencyScore,
      index: indexScore(craftScore, reachScore, recencyScore),
    };
  });

  projects.sort((a, b) => b.index - a.index || a.repo.localeCompare(b.repo));

  const dataset = { asOf, categories: curation.categories, projects };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(dataset, null, 2)}\n`);

  console.log(`Wrote ${OUTPUT} with ${projects.length} projects (as of ${asOf}, max stars ${maxStars}).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
