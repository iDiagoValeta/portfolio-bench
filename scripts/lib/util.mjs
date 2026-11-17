// Pure helpers shared by the portfolio charts. No dependencies.

const DAY_MS = 86_400_000;

// Candidate steps around `raw`, ascending: {1, 2, 5, 10} for each nearby decade.
function candidateSteps(raw) {
  const exp = Math.floor(Math.log10(raw));
  const steps = [];
  for (const k of [exp - 1, exp, exp + 1]) {
    for (const m of [1, 2, 5, 10]) steps.push(m * 10 ** k);
  }
  return steps.sort((a, b) => a - b);
}

function buildTicks(min, max, step) {
  // The epsilon absorbs binary representation error before ceil/floor.
  const start = Math.ceil(min / step - 1e-12) * step;
  const end = Math.floor(max / step + 1e-12) * step;
  const count = Math.round((end - start) / step);
  const ticks = [];
  for (let i = 0; i <= count; i++) {
    ticks.push(Number((start + i * step).toPrecision(12)));
  }
  return ticks;
}

export function niceTicks(min, max, count = 5) {
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

function trimOneDecimal(text) {
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

export function formatCompact(n) {
  const abs = Math.abs(n);

  if (abs < 1000) {
    if (Number.isInteger(n)) return String(n);
    return trimOneDecimal(n.toFixed(1));
  }

  const units = [
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

export function relativeTime(iso, now = new Date()) {
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

export function rankBy(items, key, dir = 'desc') {
  const direction = dir === 'asc' ? 1 : -1;

  return items
    .map((item, index) => ({ item, index, value: item?.[key] }))
    .sort((a, b) => {
      const aValid = typeof a.value === 'number' && !Number.isNaN(a.value);
      const bValid = typeof b.value === 'number' && !Number.isNaN(b.value);

      if (aValid && bValid) {
        if (a.value !== b.value) return (a.value - b.value) * direction;
        return a.index - b.index;
      }
      if (aValid) return -1;
      if (bValid) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}
