import '../styles/production.css';

import type { Dataset } from '../types';
import type { Profile, ProfileHeadline } from '../types-profile';
import { h, onVisible } from '../lib/dom';

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// "280+" -> prefix "", number 280, suffix "+"
function parseValue(v: string): { pre: string; n: number; suf: string } {
  const m = /^(\D*)(\d[\d,]*)(.*)$/.exec(v);
  return m ? { pre: m[1], n: Number(m[2].replace(/,/g, '')), suf: m[3] } : { pre: '', n: NaN, suf: v };
}

function countUp(el: HTMLElement, v: string): void {
  const { pre, n, suf } = parseValue(v);
  if (Number.isNaN(n) || reduced()) {
    el.textContent = v;
    return;
  }
  const t0 = performance.now();
  const dur = 1100;
  const tick = (now: number): void => {
    const k = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = `${pre}${Math.round(n * eased)}${k < 1 ? '' : suf}`;
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stat(hd: ProfileHeadline): HTMLElement {
  const num = h('span', { class: 'score' }, hd.value);
  const el = h(
    'div',
    { class: 'proof-item' },
    h('div', { class: 'proof-figure' }, num, h('span', { class: 'proof-unit' }, hd.unit)),
    h('p', { class: 'proof-label' }, hd.label),
  );
  if (!reduced()) num.textContent = parseValue(hd.value).pre + '0';
  onVisible(el, () => countUp(num, hd.value));
  return el;
}

// Compact production proof inside the hero: headline numbers from profile.json, one row.
export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  void data;
  const row = h('div', { class: 'proof', role: 'list', 'aria-label': 'Production record' });
  for (const hd of profile.headlines) {
    const item = stat(hd);
    item.setAttribute('role', 'listitem');
    item.setAttribute('aria-label', `${hd.value} ${hd.unit}. ${hd.label}`);
    row.append(item);
  }
  el.replaceChildren(row);
}
