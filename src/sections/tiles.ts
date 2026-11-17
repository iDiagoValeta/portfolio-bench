import '../styles/hero.css';

import type { Dataset } from '../types';
import type { Profile } from '../types-profile';
import { h, onVisible } from '../lib/dom';

const COUNT_MS = 900;

interface Count {
  el: HTMLElement;
  num: number;
  suffix: string; // kept verbatim, e.g. the "+" of "280+"
  decimals: number;
}

// "280+" -> { num: 280, suffix: "+", decimals: 0 }; no leading number -> null.
function parseValue(value: string): Omit<Count, 'el'> | null {
  const m = /^(\d+(?:\.\d+)?)(.*)$/.exec(value);
  if (!m) return null;
  return {
    num: parseFloat(m[1]),
    suffix: m[2],
    decimals: m[1].includes('.') ? m[1].length - m[1].indexOf('.') - 1 : 0,
  };
}

export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  void data;

  const root = h('div', { class: 'tiles' });
  const counts: Count[] = [];

  for (const hl of profile.headlines) {
    const numEl = h('span', { class: 'tile-num' });
    root.append(
      h('div', { class: 'tile card' },
        h('div', { class: 'tile-value' }, numEl, h('span', { class: 'tile-unit mono' }, hl.unit)),
        h('p', { class: 'tile-label' }, hl.label),
        h('span', { class: 'chip mono' }, hl.source),
      ),
    );
    const parsed = parseValue(hl.value);
    if (parsed) counts.push({ el: numEl, ...parsed });
    else numEl.textContent = hl.value;
  }

  el.append(root);

  const finalText = (): void => {
    for (const c of counts) c.el.textContent = c.num.toFixed(c.decimals) + c.suffix;
  };

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || counts.length === 0) {
    finalText();
    return;
  }

  for (const c of counts) c.el.textContent = (0).toFixed(c.decimals) + c.suffix;

  onVisible(root, () => {
    const t0 = performance.now();
    const frame = (now: number): void => {
      const t = Math.min(1, (now - t0) / COUNT_MS);
      const eased = 1 - (1 - t) ** 3; // easeOutCubic
      for (const c of counts) {
        c.el.textContent = (c.num * eased).toFixed(c.decimals) + c.suffix;
      }
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
