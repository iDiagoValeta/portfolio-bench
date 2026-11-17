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

// Decide the seven craft checks from the recursive tree paths plus repo metadata.
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

// Share of passed checks (7 checks, each worth 1/7).
export function craft(checks) {
  const values = Object.values(checks ?? {});
  if (values.length === 0) return 0;
  return values.filter(Boolean).length / values.length;
}

// Popularity relative to the most-starred curated project.
export function reach(stars, maxStars) {
  if (!Number.isFinite(maxStars) || maxStars <= 0) return 0;
  return Math.log10(1 + stars) / Math.log10(1 + maxStars);
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

// Weighted index on a 0..100 integer scale.
export function index(craftScore, reachScore, recencyScore) {
  return Math.round(100 * (0.5 * craftScore + 0.25 * reachScore + 0.25 * recencyScore));
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
