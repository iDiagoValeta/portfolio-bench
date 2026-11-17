import '../styles/hero.css';

import type { Dataset, Project } from '../types';
import type { Profile } from '../types-profile';
import { h, onVisible } from '../lib/dom';
import { openCard } from './card';

const STRIP_H = 140; // strip height in px
const STRIP_H_SMALL = 100; // strip height under a 640px viewport
const GROW_MS = 360; // one bar's growth
const SEQUENCE_MS = 1100; // whole stagger, kept under the 1.2s budget

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Bar {
  p: Project;
  g: SVGGElement;
  hit: SVGRectElement;
  path: SVGPathElement;
  x: number;
  w: number;
  h: number;
  slot: number;
  slotX: number;
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function barPath(x: number, baseline: number, w: number, h: number): string {
  // A full semicircular cap on the data end; it collapses for very short bars.
  const r = Math.min(w / 2, h);
  const y = baseline - h;
  return `M${x} ${baseline}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${baseline}Z`;
}

export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  void profile;

  const sorted = [...data.projects].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  const catLabel = (id: string): string =>
    data.categories.find((c) => c.id === id)?.label ?? id;

  // The readout defaults to the top project by index, not the first by date.
  const top = sorted.reduce<Project | null>(
    (best, p) => (!best || p.index > best.index ? p : best),
    null,
  );

  // Rank by index among all projects (highest index = #1).
  const byIndex = [...data.projects].sort((a, b) => b.index - a.index);
  const rankOf = new Map(byIndex.map((p, i) => [p.repo, i + 1]));
  const totalProjects = data.projects.length;

  const root = h('div', { class: 'fp' });
  const readout = h('div', { class: 'fp-readout mono' });
  root.append(readout);

  const strip = svg('svg', {
    class: 'fp-svg',
    role: 'img',
    'aria-label': `Fingerprint of ${sorted.length} projects: one slim bar per project, sorted by first commit; bar height is the engineering index.`,
  });
  const baseline = svg('line', { class: 'fp-baseline' });
  strip.append(baseline);
  root.append(strip);

  let stripH = STRIP_H;
  let played = false; // growth finished or skipped; later layouts draw final bars
  const bars: Bar[] = [];

  function writeReadout(p: Project | null): void {
    readout.textContent = '';
    if (!p) return;
    readout.append(
      h('span', { class: 'fp-r-title' }, p.title),
      h('span', { class: 'fp-r-cat' }, catLabel(p.category)),
      h('span', { class: 'fp-r-index' }, String(p.index)),
      h('span', { class: 'fp-r-rank mono' }, `#${rankOf.get(p.repo) ?? ''} / ${totalProjects}`),
    );
  }
  writeReadout(top);

  for (const p of sorted) {
    const g = svg('g', {
      class: 'fp-slot',
      tabindex: '0',
      role: 'button',
      'aria-label': `${p.title}, ${catLabel(p.category)}, index ${p.index}`,
    });
    const hit = svg('rect', {
      class: 'fp-hit',
      x: '0',
      y: '0',
      width: '0',
      height: '0',
      fill: 'transparent',
      'pointer-events': 'all',
    });
    const path = svg('path', {
      class: 'fp-bar',
      fill: `var(--cat-${p.category})`,
    });
    g.append(hit, path);
    g.addEventListener('mouseenter', () => {
      strip.classList.add('fp-dim'); // the rest dim, the hovered bar stays full
      writeReadout(p);
    });
    g.addEventListener('mouseleave', () => {
      strip.classList.remove('fp-dim');
      writeReadout(top);
    });
    // Keyboard parity with hover: same dim state and readout.
    g.addEventListener('focus', () => {
      strip.classList.add('fp-dim');
      writeReadout(p);
    });
    g.addEventListener('blur', () => {
      strip.classList.remove('fp-dim');
      writeReadout(top);
    });
    g.addEventListener('click', () => openCard(p.repo));
    g.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCard(p.repo);
      }
    });
    strip.append(g);
    bars.push({ p, g, hit, path, x: 0, w: 0, h: 0, slot: 0, slotX: 0 });
  }

  const legend = h('div', { class: 'fp-legend' });
  for (const c of data.categories) {
    legend.append(
      h('span', { class: 'fp-leg' },
        h('i', { class: 'fp-sq', style: `background:var(--cat-${c.id})` }),
        c.label,
      ),
    );
  }
  root.append(
    h('div', { class: 'fp-cap' },
      h('span', { class: 'fp-count mono' }, `${sorted.length} projects · sorted by first commit`),
      legend,
    ),
  );

  el.append(root);

  function drawBar(b: Bar, height: number): void {
    b.path.setAttribute('d', barPath(b.x, stripH, b.w, height));
  }

  function layout(): void {
    const w = root.clientWidth;
    stripH = window.innerWidth < 640 ? STRIP_H_SMALL : STRIP_H;
    strip.setAttribute('width', String(w));
    strip.setAttribute('height', String(stripH));
    // 1px baseline sits just inside the bottom edge so it renders crisply.
    baseline.setAttribute('x1', '0');
    baseline.setAttribute('y1', String(stripH - 0.5));
    baseline.setAttribute('x2', String(w));
    baseline.setAttribute('y2', String(stripH - 0.5));
    const n = bars.length;
    if (n === 0) return;
    const slot = w / n;
    for (let i = 0; i < n; i++) {
      const b = bars[i];
      b.slot = slot;
      b.slotX = i * slot;
      b.w = Math.min(10, Math.max(4, slot * 0.22)); // clamp(4px, 22% of slot, 10px)
      b.x = i * slot + (slot - b.w) / 2; // centred in its slot
      b.h = (b.p.index / 100) * stripH;
      b.hit.setAttribute('x', String(b.slotX));
      b.hit.setAttribute('y', '0');
      b.hit.setAttribute('width', String(slot));
      b.hit.setAttribute('height', String(stripH));
      if (played) drawBar(b, b.h);
    }
  }

  function grow(): void {
    const n = bars.length;
    if (n === 0) {
      played = true;
      return;
    }
    const step = n > 1 ? (SEQUENCE_MS - GROW_MS) / (n - 1) : 0;
    const t0 = performance.now();
    const frame = (now: number): void => {
      let done = true;
      for (let i = 0; i < n; i++) {
        const b = bars[i];
        const t = Math.min(1, Math.max(0, (now - t0 - i * step) / GROW_MS));
        if (t < 1) done = false;
        const eased = 1 - (1 - t) ** 3; // easeOutCubic
        drawBar(b, b.h * eased);
      }
      if (done) played = true;
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  layout();

  onVisible(root, () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      played = true;
      for (const b of bars) drawBar(b, b.h);
      return;
    }
    grow();
  });

  let resizeTimer: number | null = null;
  const ro = new ResizeObserver(() => {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(layout, 150);
  });
  ro.observe(el);
}
