import '../styles/hero.css';

import type { Dataset, Project } from '../types';
import type { Profile } from '../types-profile';
import { h, onVisible } from '../lib/dom';
import { showTip, hideTip } from '../lib/tooltip';
import { openCard } from './card';

const GAP = 2; // px between bars
const RADIUS = 4; // rounded top, the data end; the base stays square on the baseline
const STRIP_H = 120; // strip height in px
const STRIP_H_SMALL = 88; // strip height under a 640px viewport
const GROW_MS = 360; // one bar's growth
const SEQUENCE_MS = 1100; // whole stagger, kept under the 1.2s budget

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Bar {
  p: Project;
  path: SVGPathElement;
  x: number;
  w: number;
  h: number;
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
  // The radius collapses for very short bars so the cap never outweighs the data.
  const r = Math.min(RADIUS, w / 2, h);
  const y = baseline - h;
  return `M${x} ${baseline}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${baseline}Z`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  void profile;

  const sorted = [...data.projects].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  const catLabel = (id: string): string =>
    data.categories.find((c) => c.id === id)?.label ?? id;

  const root = h('div', { class: 'fp' });
  const strip = svg('svg', {
    class: 'fp-svg',
    role: 'img',
    'aria-label': `Fingerprint of ${sorted.length} projects: one bar per project, sorted by first commit; bar height is the engineering index.`,
  });

  let stripH = STRIP_H;
  let played = false; // growth finished or skipped; later layouts draw final bars
  const bars: Bar[] = [];

  for (const p of sorted) {
    const path = svg('path', {
      class: 'fp-bar',
      fill: `var(--cat-${p.category})`,
      tabindex: '0',
      role: 'button',
      'aria-label': `${p.title}, ${catLabel(p.category)}, index ${p.index}`,
    });
    const tip = `<strong>${escapeHtml(p.title)}</strong><br>${escapeHtml(catLabel(p.category))}<br>Index <span class="mono">${p.index}</span>`;
    path.addEventListener('mouseenter', (e: MouseEvent) => {
      strip.classList.add('fp-dim'); // the rest dim, the hovered bar stays full
      showTip(tip, e.clientX, e.clientY);
    });
    path.addEventListener('mousemove', (e: MouseEvent) => showTip(tip, e.clientX, e.clientY));
    path.addEventListener('mouseleave', () => {
      strip.classList.remove('fp-dim');
      hideTip();
    });
    // Keyboard parity with hover: same dim state, tooltip anchored to the bar.
    path.addEventListener('focus', () => {
      strip.classList.add('fp-dim');
      const r = path.getBoundingClientRect();
      showTip(tip, r.left + r.width / 2, r.bottom);
    });
    path.addEventListener('blur', () => {
      strip.classList.remove('fp-dim');
      hideTip();
    });
    path.addEventListener('click', () => {
      hideTip(); // touch never fires mouseleave; the card repeats these facts anyway
      openCard(p.repo);
    });
    path.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCard(p.repo);
      }
    });
    strip.append(path);
    bars.push({ p, path, x: 0, w: 0, h: 0 });
  }

  root.append(strip);

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
    const n = bars.length;
    const barW = n > 0 ? Math.max(1, (w - GAP * (n - 1)) / n) : 0;
    for (let i = 0; i < n; i++) {
      const b = bars[i];
      b.x = i * (barW + GAP);
      b.w = barW;
      b.h = (b.p.index / 100) * stripH;
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
