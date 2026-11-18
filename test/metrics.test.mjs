import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checksFromTree,
  computeFacts,
  craft,
  depth,
  index,
  INDEX_WEIGHTS,
  parseLastPage,
  recency,
  retryDelay,
  RETRY_MAX_ATTEMPTS,
  shipped,
  statsDecision,
  STATS_MAX_RETRIES,
} from '../scripts/lib/metrics.mjs';

const DAY_MS = 86_400_000;
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('parseLastPage: typical next + last header', () => {
  const link =
    '<https://api.github.com/repos/o/r/commits?per_page=1&page=2>; rel="next", ' +
    '<https://api.github.com/repos/o/r/commits?per_page=1&page=697>; rel="last"';
  assert.equal(parseLastPage(link), 697);
});

test('parseLastPage: last only, and last before next', () => {
  assert.equal(parseLastPage('<https://x?page=12>; rel="last"'), 12);
  assert.equal(
    parseLastPage('<https://x?page=5>; rel="last", <https://x?page=6>; rel="next"'),
    5,
  );
});

test('parseLastPage: missing or last-less input returns null', () => {
  assert.equal(parseLastPage(undefined), null);
  assert.equal(parseLastPage(null), null);
  assert.equal(parseLastPage(''), null);
  assert.equal(parseLastPage('<https://x?page=2>; rel="next"'), null);
  assert.equal(parseLastPage('garbage'), null);
});

test('parseLastPage: case-insensitive rel and extra URL params', () => {
  const link = '<https://x?per_page=1&page=42&foo=bar>; REL="LAST"';
  assert.equal(parseLastPage(link), 42);
});

const fullRepo = {
  license: { spdx_id: 'MIT' },
  description: 'A described project.',
  topics: ['a', 'b', 'c'],
  homepage: 'https://example.com',
};

test('checksFromTree: all seven checks pass (six craft + shipped)', () => {
  const checks = checksFromTree(
    ['.github/workflows/ci.yml', 'tests/test_app.py', 'README.md'],
    fullRepo,
    1600,
    0,
  );
  assert.deepEqual(checks, {
    readme: true,
    license: true,
    ci: true,
    tests: true,
    description: true,
    topics: true,
    shipped: true,
  });
});

test('checksFromTree: nested tests directory is detected without a test-named file', () => {
  const checks = checksFromTree(['src/foo/tests/helpers.py'], fullRepo, 1600, 0);
  assert.equal(checks.tests, true);
});

test('checksFromTree: no tests means tests is false', () => {
  const checks = checksFromTree(['src/main.py', 'README.md'], fullRepo, 1600, 0);
  assert.equal(checks.tests, false);
  assert.equal(checks.ci, false);
});

test('checksFromTree: test file name variants', () => {
  for (const path of ['metrics.test.mjs', 'test_util.py', 'models_test.py']) {
    assert.equal(checksFromTree([path], fullRepo, 1600, 0).tests, true, path);
  }
});

test('checksFromTree: README boundary is strictly over 1500', () => {
  assert.equal(checksFromTree([], fullRepo, 1500, 0).readme, false);
  assert.equal(checksFromTree([], fullRepo, 1501, 0).readme, true);
});

test('checksFromTree: topics need at least three', () => {
  assert.equal(checksFromTree([], { ...fullRepo, topics: ['a', 'b'] }, 1600, 0).topics, false);
  assert.equal(checksFromTree([], { ...fullRepo, topics: ['a', 'b', 'c'] }, 1600, 0).topics, true);
});

test('checksFromTree: shipped via release even with no homepage', () => {
  const checks = checksFromTree([], { ...fullRepo, homepage: '' }, 1600, 1);
  assert.equal(checks.shipped, true);
});

test('checksFromTree: missing license and empty description fail', () => {
  const checks = checksFromTree([], { license: null, description: '', topics: [] }, 0, 0);
  assert.equal(checks.license, false);
  assert.equal(checks.description, false);
  assert.equal(checks.topics, false);
  assert.equal(checks.shipped, false);
});

test('craft: share of passed checks', () => {
  const allTrue = {
    readme: true, license: true, ci: true, tests: true,
    description: true, topics: true, shipped: true,
  };
  assert.equal(craft(allTrue), 1);
  assert.equal(craft(Object.fromEntries(Object.keys(allTrue).map((k) => [k, false]))), 0);

  // shipped is raw data, not a craft check: 6 passing hygiene checks stay 1 either way
  assert.equal(craft({ ...allTrue, shipped: false }), 1);
  assert.equal(craft({ shipped: true }), 0);

  const four = { ...allTrue, ci: false, tests: false };
  close(craft(four), 4 / 6);
  close(craft({ ...four, shipped: false }), 4 / 6);
});

test('shipped: production flag 1, url or release 0.6, else 0', () => {
  assert.equal(shipped(['production'], null, 0), 1);
  assert.equal(shipped(['featured', 'production'], 'https://x.dev', 3), 1);
  assert.equal(shipped(['featured'], 'https://x.dev', 0), 0.6);
  assert.equal(shipped([], null, 2), 0.6);
  assert.equal(shipped(['local'], null, true), 0.6);
  assert.equal(shipped(['local'], null, false), 0);
  assert.equal(shipped([], '  ', 0), 0);
  assert.equal(shipped(undefined, undefined, undefined), 0);
});

test('depth: zero max, zero commits, self and hand-computed value', () => {
  assert.equal(depth(5, 0), 0);
  assert.equal(depth(697, 697), 1);
  assert.equal(depth(0, 100), 0);
  // log10(1 + 9) / log10(1 + 99) = 1 / 2
  close(depth(9, 99), 0.5);
  // log10(1 + 99) / log10(1 + 999) = 2 / 3
  close(depth(99, 999), 2 / 3);
});

test('recency: fresh, half-life, expired and clamped, accepts Date now', () => {
  const now = new Date('2026-11-17T00:00:00Z');
  const iso = now.toISOString();

  assert.equal(recency(iso, now), 1);

  const twelveMonthsMs = 12 * 30.44 * DAY_MS;
  const twelveMonthsAgo = new Date(now.getTime() - twelveMonthsMs).toISOString();
  close(recency(twelveMonthsAgo, now), 0.5);

  const twentyFourMonthsAgo = new Date(now.getTime() - 24 * 30.44 * DAY_MS).toISOString();
  close(recency(twentyFourMonthsAgo, now), 0);

  const thirtyMonthsAgo = new Date(now.getTime() - 30 * 30.44 * DAY_MS).toISOString();
  assert.equal(recency(thirtyMonthsAgo, now), 0);

  assert.equal(recency(iso, iso), 1);
});

test('index: weighted formula (depth .40, craft .20, recency .15, shipped .25) with hand-computed values', () => {
  assert.equal(index(1, 1, 1, 1), 100);
  assert.equal(index(0, 0, 0, 0), 0);
  // 100 * (0.40*0.5 + 0.20*0.5 + 0.15*0.4 + 0.25*0.6) = 100 * 0.51 = 51
  assert.equal(index(0.5, 0.5, 0.4, 0.6), 51);
  // 100 * (0.40*0.6 + 0.20*0.5 + 0.15*0.2 + 0.25*1) = 100 * 0.62 = 62
  assert.equal(index(0.6, 0.5, 0.2, 1), 62);
  // 100 * (0.40*1) = 40: depth alone
  assert.equal(index(1, 0, 0, 0), 40);
  // 20: craft alone
  assert.equal(index(0, 1, 0, 0), 20);
  // 15: recency alone
  assert.equal(index(0, 0, 1, 0), 15);
  // 25: shipped alone
  assert.equal(index(0, 0, 0, 1), 25);
  // 100 * (0.40*0.5 + 0.20*(4/6) + 0.15*0.5 + 0.25*0.6) = 100 * 0.558333 -> 56
  assert.equal(index(0.5, 4 / 6, 0.5, 0.6), 56);
});

const proj = (repo, commits, createdAt, ci, tests, weekly, flags = [], shipped = 0) => ({
  repo, title: repo.toUpperCase(), commits, createdAt, checks: { ci, tests }, weekly, flags, shipped,
});
const weeks = (nonzero) => Array.from({ length: 52 }, (_, i) => (nonzero.includes(i) ? 3 : 0));

test('computeFacts: aggregates computed from the projects', () => {
  const projects = [
    proj('a', 100, '2026-02-01T00:00:00Z', true, true, weeks([50, 51]), ['production'], 1),
    proj('b', 300, '2025-06-01T00:00:00Z', false, true, weeks([51, 10]), ['featured'], 0.6),
    proj('c', 7, '2026-09-01T00:00:00Z', true, false, weeks([])),
  ];
  assert.deepEqual(computeFacts(projects, '2026-11-17'), {
    totalCommits: 407,
    repos: 3,
    reposThisYear: 2,
    withCi: 2,
    withTests: 2,
    shippedCount: 2,
    productionCount: 1,
    firstCreatedAt: '2025-06-01T00:00:00Z',
    topByCommits: { repo: 'b', title: 'B', commits: 300 },
    activeWeeks: 3, // weeks 10, 50, 51; week 51 is shared and counted once
  });
});

test('statsDecision: 200 is done, 202 retries with a 2-3 s pause, then fails loudly', () => {
  assert.deepEqual(statsDecision({ status: 200, attempt: 1 }), { action: 'done' });
  assert.equal(STATS_MAX_RETRIES, 6);
  for (let attempt = 1; attempt <= STATS_MAX_RETRIES; attempt++) {
    const d = statsDecision({ status: 202, attempt });
    assert.equal(d.action, 'retry', `attempt ${attempt}`);
    assert.ok(d.waitMs >= 2000 && d.waitMs <= 3000, `attempt ${attempt}: ${d.waitMs}`);
  }
  // 1 request + 6 retries = attempt 7 still 202: give up
  assert.deepEqual(statsDecision({ status: 202, attempt: STATS_MAX_RETRIES + 1 }), { action: 'fail' });
});

test('statsDecision: other statuses are never treated as data', () => {
  for (const status of [204, 404, 500]) {
    assert.deepEqual(statsDecision({ status, attempt: 1 }), { action: 'fail' }, String(status));
  }
});

test('retry policy allows four attempts', () => {
  assert.equal(RETRY_MAX_ATTEMPTS, 4);
});

test('retryDelay: successful and client-error statuses are never retried', () => {
  for (const status of [200, 201, 301, 400, 401, 404, 422]) {
    assert.equal(retryDelay({ status }), null, String(status));
  }
});

test('retryDelay: 403 is retried only when rate-limit headers say so', () => {
  assert.equal(retryDelay({ status: 403 }), null);
  assert.equal(retryDelay({ status: 403, headers: { 'x-ratelimit-remaining': '42' } }), null);
  assert.ok(retryDelay({ status: 403, headers: { 'x-ratelimit-remaining': '0' } }) > 0);
  assert.ok(retryDelay({ status: 403, headers: { 'retry-after': '2' } }) > 0);
});

test('retryDelay: 429 and 5xx use exponential backoff without headers', () => {
  assert.equal(retryDelay({ status: 429, attempt: 1 }), 1000);
  assert.equal(retryDelay({ status: 500, attempt: 2 }), 2000);
  assert.equal(retryDelay({ status: 503, attempt: 3 }), 4000);
  assert.equal(retryDelay({ status: 502, attempt: 4 }), 8000);
});

test('retryDelay: retry-after in seconds is honoured', () => {
  assert.equal(retryDelay({ status: 429, headers: { 'retry-after': '30' }, attempt: 1 }), 30_000);
});

test('retryDelay: retry-after as an HTTP date is honoured', () => {
  const now = Date.parse('2026-11-17T00:00:00Z');
  const delay = retryDelay({
    status: 429,
    headers: { 'retry-after': 'Tue, 17 Nov 2026 00:00:10 GMT' },
    now,
    attempt: 1,
  });
  assert.equal(delay, 10_000);
});

test('retryDelay: x-ratelimit-reset is honoured relative to now', () => {
  const now = 1_800_000_000_000;
  const reset = String(Math.floor(now / 1000) + 12);
  const delay = retryDelay({
    status: 403,
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset },
    now,
    attempt: 1,
  });
  assert.equal(delay, 12_000);
});

test('retryDelay: retry-after takes precedence over reset', () => {
  const now = 1_800_000_000_000;
  const reset = String(Math.floor(now / 1000) + 60);
  const delay = retryDelay({
    status: 429,
    headers: { 'retry-after': '5', 'x-ratelimit-reset': reset },
    now,
    attempt: 1,
  });
  assert.equal(delay, 5_000);
});

test('retryDelay: a past reset falls back to backoff and never goes negative', () => {
  const now = 1_800_000_000_000;
  const delay = retryDelay({
    status: 429,
    headers: { 'x-ratelimit-reset': '1' },
    now,
    attempt: 2,
  });
  assert.equal(delay, 2000);
});

test('index uses INDEX_WEIGHTS and the weights sum to 1', () => {
  const { depth: wd, craft: wc, recency: wr, shipped: ws } = INDEX_WEIGHTS;
  close(wd + wc + wr + ws, 1);
  assert.equal(index(1, 0, 0, 0), Math.round(100 * wd));
  assert.equal(index(0, 1, 0, 0), Math.round(100 * wc));
  assert.equal(index(0, 0, 1, 0), Math.round(100 * wr));
  assert.equal(index(0, 0, 0, 1), Math.round(100 * ws));
  assert.equal(
    index(0.7, 0.3, 0.9, 0.6),
    Math.round(100 * (wd * 0.7 + wc * 0.3 + wr * 0.9 + ws * 0.6)),
  );
});
