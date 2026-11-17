// Pure formatting helpers shared by the portfolio sections. This is the single
// TypeScript copy; reference behaviour lives in scripts/lib/util.mjs and is
// covered by test/util.test.mjs and test/format.test.mjs. Keep erasable-syntax
// only (no enums, parameter properties or namespaces) so Node can run this
// file directly with type stripping.

const DAY_MS = 86_400_000;

// Candidate steps around `raw`, ascending: {1, 2, 5, 10} for each nearby decade.
function candidateSteps(raw: number): number[] {
  const exp = Math.floor(Math.log10(raw));
  const steps: number[] = [];
  for (const k of [exp - 1, exp, exp + 1]) {
    for (const m of [1, 2, 5, 10]) steps.push(m * 10 ** k);
  }
  return steps.sort((a, b) => a - b);
}

function buildTicks(min: number, max: number, step: number): number[] {
  // The epsilon absorbs binary representation error before ceil/floor.
  const start = Math.ceil(min / step - 1e-12) * step;
  const end = Math.floor(max / step + 1e-12) * step;
  const count = Math.round((end - start) / step);
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) {
    ticks.push(Number((start + i * step).toPrecision(12)));
  }
  return ticks;
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min > max) [min, max] = [max, min];
  if (min === max) return [min];

  const raw = (max - min) / count;
  const steps = candidateSteps(raw);
  let index = steps.findIndex((step) => step >= raw);
  if (index === -1) index = steps.length - 1;

  let ticks = buildTicks(min, max, steps[index]);
  // A step that leaves a single tick does not describe the range, so fall back
  // to the next smaller nice step. This is what makes (0.1, 0.95, 4) use 0.2.
  while (ticks.length < 2 && index > 0) {
    index--;
    ticks = buildTicks(min, max, steps[index]);
  }
  return ticks;
}

function trimOneDecimal(text: string): string {
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

export function formatCompact(n: number): string {
  const abs = Math.abs(n);

  if (abs < 1000) {
    if (Number.isInteger(n)) return String(n);
    return trimOneDecimal(n.toFixed(1));
  }

  const units: [string, number][] = [
    ['B', 1e9],
    ['M', 1e6],
    ['k', 1e3],
  ];
  let unitIndex = units.findIndex(([, size]) => abs >= size);
  let text = trimOneDecimal((abs / units[unitIndex][1]).toFixed(1));

  // Rounding can push a value to 1000 of its unit (999_950 -> "1000.0k").
  if (Number(text) >= 1000 && unitIndex > 0) {
    unitIndex--;
    text = trimOneDecimal((abs / units[unitIndex][1]).toFixed(1));
  }

  return `${n < 0 ? '-' : ''}${text}${units[unitIndex][0]}`;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);

  if (days < 0) return 'in the future';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? '1 month ago' : `${months} months ago`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

// data.asOf is a plain date like "2026-11-17". new Date(asOf) would be that
// day's midnight UTC, so a repo pushed later that day computes a negative day
// count and shows "in the future". Anchor it to the end of the day.
export function asOfDate(asOf: string): Date {
  return new Date(`${asOf}T23:59:59Z`);
}
