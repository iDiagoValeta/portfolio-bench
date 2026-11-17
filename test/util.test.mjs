import test from 'node:test';
import assert from 'node:assert/strict';

import { formatCompact, niceTicks, rankBy, relativeTime } from '../scripts/lib/util.mjs';

test('niceTicks: nice steps and degenerate ranges', () => {
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(5, 5), [5]);
  assert.deepEqual(niceTicks(10, 0), [0, 2, 4, 6, 8, 10]);
});

test('niceTicks: falls back to a smaller step when only one tick fits', () => {
  assert.deepEqual(niceTicks(0.1, 0.95, 4), [0.2, 0.4, 0.6, 0.8]);
});

test('formatCompact: integers, compact units and rounding carry', () => {
  assert.equal(formatCompact(0), '0');
  assert.equal(formatCompact(999), '999');
  assert.equal(formatCompact(1000), '1k');
  assert.equal(formatCompact(1500), '1.5k');
  assert.equal(formatCompact(1_500_000), '1.5M');
  assert.equal(formatCompact(-1500), '-1.5k');
  assert.equal(formatCompact(1.23), '1.2');
  // 999_950 rounds to 1000.0k, which carries into 1M.
  assert.equal(formatCompact(999_950), '1M');
});

test('relativeTime: fixed now across every bucket', () => {
  const now = new Date('2026-11-17T00:00:00Z');
  const day = 86_400_000;
  const ago = (days) => new Date(now.getTime() - days * day).toISOString();

  assert.equal(relativeTime(now.toISOString(), now), 'today');
  assert.equal(relativeTime(ago(1), now), 'yesterday');
  assert.equal(relativeTime(ago(5), now), '5 days ago');
  assert.equal(relativeTime(ago(30), now), '1 month ago');
  assert.equal(relativeTime(ago(365), now), '1 year ago');
  assert.equal(relativeTime(ago(-1), now), 'in the future');
});

test('rankBy: desc, asc and stable ties', () => {
  const items = [{ v: 1, id: 'a' }, { v: 3, id: 'b' }, { v: 2, id: 'c' }, { v: 3, id: 'd' }];
  assert.deepEqual(rankBy(items, 'v').map((x) => x.id), ['b', 'd', 'c', 'a']);
  assert.deepEqual(rankBy(items, 'v', 'asc').map((x) => x.id), ['a', 'c', 'b', 'd']);
});
