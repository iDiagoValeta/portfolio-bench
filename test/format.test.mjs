// Same assertions as test/util.test.mjs, run against the TypeScript port in
// src/lib/format.ts. Node strips the types at import (no enums or other
// non-erasable syntax in that file).
import test from 'node:test';
import assert from 'node:assert/strict';

import { asOfDate, formatCompact, niceTicks, relativeTime } from '../src/lib/format.ts';

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

test('asOfDate: anchors to the end of the asOf day in UTC', () => {
  assert.deepEqual(asOfDate('2026-11-17'), new Date('2026-11-17T23:59:59Z'));
});

test('relativeTime with asOfDate: a push later on the asOf day reads today, not future', () => {
  // Regression: new Date('2026-11-17') is midnight UTC, so a repo pushed at
  // 18:00 that day computed a negative day count and read "in the future".
  const asOf = asOfDate('2026-11-17');
  assert.equal(relativeTime('2026-11-17T18:00:00Z', asOf), 'today');
});
