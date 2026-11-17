import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checksFromTree,
  craft,
  index,
  parseLastPage,
  reach,
  recency,
  retryDelay,
  RETRY_MAX_ATTEMPTS,
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

test('checksFromTree: all seven checks pass', () => {
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

  const four = { ...allTrue, ci: false, tests: false, shipped: false };
  close(craft(four), 4 / 7);
});

test('reach: zero max, zero stars, self and hand-computed value', () => {
  assert.equal(reach(0, 0), 0);
  assert.equal(reach(50, 50), 1);
  assert.equal(reach(0, 100), 0);
  // log10(1 + 24) / log10(1 + 99) = log10(25) / log10(100) = 1.39794 / 2
  close(reach(24, 99), Math.log10(25) / Math.log10(100));
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

test('index: weighted formula and rounding with hand-computed values', () => {
  assert.equal(index(1, 1, 1), 100);
  assert.equal(index(0, 0, 0), 0);
  // 100 * (0.5*0.5 + 0.25*0.4 + 0.25*0.2) = 100 * 0.4 = 40
  assert.equal(index(0.5, 0.4, 0.2), 40);
  // 100 * (0.25 + 0.1 + 0.055) = 40.5 -> 41
  assert.equal(index(0.5, 0.4, 0.22), 41);
  // 100 * (0.5*(3/7) + 0.125 + 0.125) = 46.4286 -> 46
  assert.equal(index(3 / 7, 0.5, 0.5), 46);
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
