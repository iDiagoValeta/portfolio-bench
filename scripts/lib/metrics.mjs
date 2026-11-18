// Pure scoring helpers for the portfolio index. No network, no dependencies.
// The formulas live here so they can be unit-tested without touching the API.

const DAY_MS = 86_400_000;
const MONTH_DAYS = 30.44;

// GitHub sends a Link header like:
//   <https://api.github.com/.../commits?per_page=1&page=2>; rel="next", <...&page=697>; rel="last"
// Returns the last page number, or null when there is no Link header / no rel="last".
export function parseLastPage(linkHeader) {
  if (typeof linkHeader !== 'string' || linkHeader.length === 0) return null;

  for (const part of linkHeader.split(',')) {
    const match = part.match(/<[^>]*\bpage=(\d+)[^>]*>\s*;\s*rel\s*=\s*"last"/i);
    if (match) return Number(match[1]);
  }
  return null;
}

// Decide the checks (six hygiene checks plus the raw `shipped` input) from the recursive tree paths plus repo metadata.
export function checksFromTree(paths, repoJson, readmeLen, releasesCount) {
  const list = Array.isArray(paths) ? paths : [];
  const repo = repoJson ?? {};

  const ci = list.some((p) => /(^|\/)\.github\/workflows\/.+/.test(p));

  const isTestsDir = (p) => /(^|\/)(test|tests|__tests__)(\/|$)/.test(p);
  const isTestFile = (p) => {
    const name = p.slice(p.lastIndexOf('/') + 1);
    return /\.test\./.test(name) || /^test_.+\.py$/.test(name) || /_test\./.test(name);
  };
  const tests = list.some((p) => isTestsDir(p) || isTestFile(p));

  return {
    readme: readmeLen > 1500,
    license: Boolean(repo.license),
    ci,
    tests,
    description: Boolean(String(repo.description ?? '').trim()),
    topics: Array.isArray(repo.topics) && repo.topics.length >= 3,
    shipped: Boolean(String(repo.homepage ?? '').trim() || Number(releasesCount) >= 1),
  };
}

// The hygiene checks that make up craft. `shipped` is kept in checks as raw data
// but scored separately by shipped().
export const CRAFT_CHECKS = ['readme', 'license', 'ci', 'tests', 'description', 'topics'];

// Share of passed hygiene checks (6 checks, each worth 1/6).
export function craft(checks) {
  const c = checks ?? {};
  return CRAFT_CHECKS.filter((k) => c[k]).length / CRAFT_CHECKS.length;
}

// Did it reach users? 1.0 when curated as "production" (real users), 0.6 with a live
// url or at least one release, else 0. `releases` is a releases count or the boolean
// checks.shipped (homepage or release).
export function shipped(flags, url, releases) {
  if (Array.isArray(flags) && flags.includes('production')) return 1;
  const hasRelease = typeof releases === 'boolean' ? releases : Number(releases) >= 1;
  return Boolean(String(url ?? '').trim()) || hasRelease ? 0.6 : 0;
}

// Engineering depth: log-scaled commit count relative to the deepest curated repo.
export function depth(commits, maxCommits) {
  if (!Number.isFinite(maxCommits) || maxCommits <= 0) return 0;
  return Math.log10(1 + commits) / Math.log10(1 + maxCommits);
}

// Freshness: full credit up to a fresh push, zero at 24 months (30.44 days/month).
export function recency(pushedAt, now) {
  const pushedMs = Date.parse(pushedAt);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(pushedMs) || !Number.isFinite(nowMs)) return 0;

  const days = (nowMs - pushedMs) / DAY_MS;
  const months = days / MONTH_DAYS;
  // Clamped to 1 so a clock skew or a future push date cannot score above full credit.
  return Math.min(1, Math.max(0, 1 - months / 24));
}

// Single source of the index weights: index() uses them, build-data writes them to
// projects.json as data.weights, and the leaderboard and methodology read them from there.
export const INDEX_WEIGHTS = { depth: 0.4, craft: 0.2, recency: 0.15, shipped: 0.25 };

// Weighted index on a 0..100 integer scale.
export function index(depthScore, craftScore, recencyScore, shippedScore) {
  const w = INDEX_WEIGHTS;
  return Math.round(
    100 * (w.depth * depthScore + w.craft * craftScore + w.recency * recencyScore + w.shipped * shippedScore),
  );
}

// Aggregate numbers shown in the UI copy. Pure: projects need
// repo, title, commits, createdAt, flags, shipped, checks.{ci,tests} and weekly.
export function computeFacts(projects, asOf) {
  const year = String(asOf).slice(0, 4);
  const top = projects.reduce((best, p) => (best === null || p.commits > best.commits ? p : best), null);
  const weeks = Math.max(0, ...projects.map((p) => p.weekly.length));
  let activeWeeks = 0;
  for (let w = 0; w < weeks; w++) {
    if (projects.some((p) => (p.weekly[w] ?? 0) > 0)) activeWeeks++;
  }
  return {
    totalCommits: projects.reduce((sum, p) => sum + p.commits, 0),
    repos: projects.length,
    reposThisYear: projects.filter((p) => p.createdAt.slice(0, 4) === year).length,
    withCi: projects.filter((p) => p.checks.ci).length,
    withTests: projects.filter((p) => p.checks.tests).length,
    shippedCount: projects.filter((p) => p.shipped > 0).length,
    productionCount: projects.filter((p) => p.flags.includes('production')).length,
    firstCreatedAt: projects.map((p) => p.createdAt).sort()[0] ?? null,
    topByCommits: top && { repo: top.repo, title: top.title, commits: top.commits },
    activeWeeks,
  };
}

// ---- Commit-activity stats (202 while GitHub computes them) ----

export const STATS_MAX_RETRIES = 6;
export const STATS_PAUSE_MS = [2000, 2500, 3000];

// Decide what to do with a /stats/commit_activity response. `attempt` is the
// 1-based request number. 202 means "still computing": retry up to
// STATS_MAX_RETRIES times, then fail so zeros are never written silently.
export function statsDecision({ status, attempt = 1 } = {}) {
  if (status === 200) return { action: 'done' };
  if (status === 202) {
    if (attempt > STATS_MAX_RETRIES) return { action: 'fail' };
    return { action: 'retry', waitMs: STATS_PAUSE_MS[(attempt - 1) % STATS_PAUSE_MS.length] };
  }
  return { action: 'fail' };
}

// ---- Retry policy (pure, so the wait decision can be unit-tested) ----

const RETRY_BASE_MS = 1000;
export const RETRY_MAX_ATTEMPTS = 4;

function retryAfterMs(value, now) {
  if (value == null) return null;
  const text = String(value).trim();
  if (text === '') return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

function resetMs(value, now) {
  if (value == null) return null;
  const seconds = Number(String(value).trim());
  if (!Number.isFinite(seconds)) return null;
  return Math.max(0, seconds * 1000 - now);
}

function isRateLimited(headers) {
  const remaining = headers['x-ratelimit-remaining'];
  return (remaining != null && Number(remaining) === 0) || headers['retry-after'] != null;
}

// How long to wait before the next attempt, in milliseconds. Returns null when
// the response must not be retried. `attempt` is 1-based and `now` is epoch ms;
// both are passed in so this function has no clock or network dependency.
export function retryDelay({ status, headers = {}, attempt = 1, now = 0 } = {}) {
  const retryable =
    status === 429 ||
    (status >= 500 && status <= 599) ||
    (status === 403 && isRateLimited(headers));
  if (!retryable) return null;

  const backoff = RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1);
  const wait = retryAfterMs(headers['retry-after'], now) ?? resetMs(headers['x-ratelimit-reset'], now);
  return Math.max(backoff, wait ?? 0);
}
