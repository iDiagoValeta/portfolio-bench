import { arc as d3arc } from 'd3-shape';
import { scaleSqrt } from 'd3-scale';
import type { Dataset, Project, CategoryId } from '../types';
import type { Profile } from '../types-profile';
import { h, onVisible } from '../lib/dom';
import { openCard } from './card';
import '../styles/rose.css';

const NS = 'http://www.w3.org/2000/svg';
const GAP_DEG = 24;
const ENTRY_MS = 600;
const STAGGER_MS = 14;
const GROW_PX = 6;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Short forms for labels that sit outside the ring (full names stay in the petals' aria labels).
const SHORT: Record<string, string> = { 'Fine-tuning & data': 'Fine-tuning', 'Agent safety': 'Safety' };
const shortLabel = (label: string): string => SHORT[label] ?? label.split(' & ')[0];

interface Petal {
  p: Project;
  a0: number;
  a1: number;
  rTarget: number;
  ex: number;
  exTarget: number;
  path: SVGPathElement;
  g: SVGGElement;
}

export function mount(el: HTMLElement, data: Dataset, _profile: Profile): void {
  void _profile;
  const cats = [...data.categories].sort((a, b) => a.slot - b.slot);
  const slot = new Map(cats.map((c) => [c.id, c.slot]));
  const ordered = [...data.projects].sort(
    (a, b) => (slot.get(a.category) ?? 0) - (slot.get(b.category) ?? 0) || b.index - a.index,
  );
  const top = data.projects.reduce((m, p) => (p.index > m.index ? p : m), data.projects[0]);

  const figure = h('div', { class: 'rose-fig' });
  const centre = h('div', { class: 'rose-centre', 'aria-hidden': 'true' });
  const numEl = h('div', { class: 'rose-num' }, '0');
  const titleEl = h('div', { class: 'rose-title' });
  const catEl = h('div', { class: 'rose-cat' });
  centre.append(numEl, titleEl, catEl);

  const caption = h(
    'p',
    { class: 'rose-caption' },
    'Each petal is a public repo. Length is its engineering index (0 to 100), colour its category.',
  );
  const live = h('div', { class: 'rose-live', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const root = h('div', { class: 'rose' }, figure, caption);
  el.replaceChildren(root);
  figure.append(centre, live);
  figure.tabIndex = -1;
  figure.setAttribute('role', 'group');
  figure.setAttribute('aria-label', 'Repository rose. Tab enters once, arrow keys move between petals, Enter opens the card, Escape leaves.');

  let petals: Petal[] = [];
  let hover: Project | null = null;
  const group = null as CategoryId | null;
  let entered = false;
  let animStart = 0;
  let raf = 0;
  let lastT = 0;
  let svgEl: SVGSVGElement | null = null;
  let innerR = 70;
  let shownNum = 0;
  let activeIdx = 0;

  const catLabel = (id: CategoryId) => cats.find((c) => c.id === id)?.label ?? id;

  function groupTop(id: CategoryId): Project {
    return ordered.find((p) => p.category === id) ?? top;
  }

  function render(): void {
    const active = hover ?? (group ? groupTop(group) : top);
    titleEl.textContent = active.title;
    catEl.textContent = catLabel(active.category);
    if (entered) setNum(active.index);
    if (svgEl) {
      svgEl.classList.toggle('is-dim', hover !== null || group !== null);
      for (const pt of petals) {
        const on = hover ? pt.p === hover : group ? pt.p.category === group : false;
        pt.g.classList.toggle('on', on);
        pt.exTarget = hover && pt.p === hover ? GROW_PX : 0;
      }
    }
    kick();
  }

  function setNum(n: number): void {
    shownNum = n;
    numEl.textContent = String(n);
  }

  // Roving tabindex: one petal is the tab stop, arrows move it.
  function setActive(i: number, focus: boolean): void {
    activeIdx = i;
    petals.forEach((pt, k) => pt.g.setAttribute('tabindex', k === i ? '0' : '-1'));
    if (focus) petals[i]?.g.focus();
  }

  function setHover(p: Project | null): void {
    hover = p;
    render();
  }

  const arcGen = d3arc<{ a0: number; a1: number; r0: number; r1: number }>()
    .startAngle((d) => d.a0)
    .endAngle((d) => d.a1)
    .innerRadius((d) => d.r0)
    .outerRadius((d) => d.r1)
    .padAngle(0.012)
    .cornerRadius(3);

  function paint(now: number): boolean {
    let busy = false;
    for (let i = 0; i < petals.length; i++) {
      const pt = petals[i];
      let k = 1;
      if (!entered) {
        const t = reduced() ? 1 : (now - animStart - i * STAGGER_MS) / ENTRY_MS;
        k = easeOut(Math.max(0, Math.min(1, t)));
        if (t < 1) busy = true;
      }
      const dt = Math.min(64, now - lastT);
      if (Math.abs(pt.exTarget - pt.ex) > 0.02) {
        pt.ex += reduced() ? pt.exTarget - pt.ex : (pt.exTarget - pt.ex) * (1 - Math.exp(-dt / 55));
        busy = true;
      } else pt.ex = pt.exTarget;
      const r1 = innerR + (pt.rTarget - innerR) * k + (k > 0.98 ? pt.ex : 0);
      pt.path.setAttribute('d', r1 - innerR < 1 ? '' : arcGen({ a0: pt.a0, a1: pt.a1, r0: innerR, r1 }) ?? '');
    }
    lastT = now;
    return busy;
  }

  function kick(): void {
    if (raf || !svgEl) return;
    lastT = performance.now();
    const loop = (now: number) => {
      raf = 0;
      if (paint(now)) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  function countUp(): void {
    const target = (hover ?? top).index;
    if (reduced()) return setNum(target);
    const t0 = performance.now();
    const step = (now: number) => {
      if (hover || group) return;
      const k = Math.min(1, (now - t0) / 650);
      setNum(Math.round(target * easeOut(k)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function build(): void {
    const size = Math.round(figure.clientWidth);
    if (size < 120) return;
    cancelAnimationFrame(raf);
    raf = 0;
    svgEl?.remove();

    innerR = Math.max(56, size * 0.135);
    const sweep = 2 * Math.PI - (GAP_DEG * Math.PI) / 180;
    const start = (GAP_DEG * Math.PI) / 360;
    const step = sweep / ordered.length;
    const fs = 13;
    const charW = fs * 0.54;
    const LEADER = 16;
    // Category extents on the ring, independent of the radius.
    const spans = cats
      .map((c) => {
        const idx = ordered.map((p, i) => (p.category === c.id ? i : -1)).filter((i) => i >= 0);
        if (!idx.length) return null;
        const a0 = start + idx[0] * step + 0.012;
        const a1 = start + (idx[idx.length - 1] + 1) * step - 0.012;
        return { c, a0, a1, mid: (a0 + a1) / 2 };
      })
      .filter((x): x is { c: (typeof cats)[number]; a0: number; a1: number; mid: number } => !!x);
    // A label that does not fit along its arc moves outside the ring on a short leader, in a short form.
    // The ring margin grows just enough that the outside text stays inside the figure.
    const fitsAlong = (sp: (typeof spans)[number], arcRad: number) =>
      sp.c.label.length * charW <= (sp.a1 - sp.a0) * (arcRad + 8) - 22;
    let margin = 32;
    let outside = spans.filter((sp) => !fitsAlong(sp, size / 2 - margin + 12));
    for (let k = 0; k < 3; k++) {
      for (const sp of outside) {
        const sn = Math.abs(Math.sin(sp.mid));
        const w = shortLabel(sp.c.label).length * charW + 4;
        if (sn > 0.25) margin = Math.max(margin, size / 2 + 12 + LEADER - (size / 2 - w) / sn);
      }
      outside = spans.filter((sp) => !fitsAlong(sp, size / 2 - margin + 12));
    }
    const maxR = size / 2 - margin;
    const arcR = maxR + 12;
    const cx = size / 2;
    const cy = size / 2;
    figure.style.setProperty('--rose-inner', `${innerR}px`);
    const scale = scaleSqrt().domain([0, 100]).range([innerR, maxR]);
    const pt = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;

    const s = svg('svg', {
      viewBox: `0 0 ${size} ${size}`,
      width: size,
      height: size,
      role: 'group',
      'aria-label': `Rose chart of ${ordered.length} repositories grouped by category. Petal length is the engineering index from 0 to 100.`,
      class: 'rose-svg',
    });

    const defs = svg('defs');
    // Two gradients per category: the resting one is mixed 15% toward the surface, the full one shows on hover/focus.
    for (const c of cats) {
      const off = innerR / (maxR + GROW_PX);
      for (const [id, col] of [
        [`rose-g-${c.id}`, `color-mix(in srgb, var(--cat-${c.id}) 85%, var(--surface))`],
        [`rose-gf-${c.id}`, `var(--cat-${c.id})`],
      ]) {
        const gr = svg('radialGradient', { id, gradientUnits: 'userSpaceOnUse', cx, cy, r: maxR + GROW_PX });
        gr.append(
          svg('stop', { offset: off, style: `stop-color:${col};stop-opacity:.5` }),
          svg('stop', { offset: 1, style: `stop-color:${col};stop-opacity:1` }),
        );
        defs.append(gr);
      }
    }
    s.append(defs);

    // Radial grid: faint rings at index 25/50/75/100 (unlabelled; the caption explains the scale).
    const grid = svg('g', { class: 'rose-grid', 'aria-hidden': 'true' });
    grid.append(svg('circle', { cx, cy, r: innerR, class: 'rose-inner' }));
    for (const v of [25, 50, 75, 100]) {
      grid.append(svg('circle', { cx, cy, r: scale(v) }));
    }
    s.append(grid);

    // Petals.
    petals = [];
    const pg = svg('g', { class: 'rose-petals', transform: `translate(${cx} ${cy})` });
    ordered.forEach((p, i) => {
      const a0 = start + i * step;
      const a1 = a0 + step;
      const g = svg('g', {
        class: 'rose-petal',
        tabindex: i === activeIdx ? 0 : -1,
        role: 'button',
        'aria-label': `${p.title}, ${catLabel(p.category)}, index ${p.index}. Open details.`,
        style: `--c:var(--cat-${p.category});--f:url(#rose-g-${p.category});--ff:url(#rose-gf-${p.category})`,
      });
      const path = svg('path');
      g.append(path);
      g.addEventListener('mouseenter', () => setHover(p));
      g.addEventListener('mouseleave', () => setHover(null));
      g.addEventListener('focus', () => {
        setActive(i, false);
        setHover(p);
        live.textContent = `${p.title}, ${catLabel(p.category)}, index ${p.index}`;
      });
      g.addEventListener('blur', () => setHover(null));
      g.addEventListener('click', () => openCard(p.repo));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openCard(p.repo);
          return;
        }
        const n = ordered.length;
        const to =
          e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + n - 1) % n
          : e.key === 'Home' ? 0
          : e.key === 'End' ? n - 1
          : -1;
        if (to >= 0) {
          e.preventDefault();
          setActive(to, true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          figure.focus();
        }
      });
      pg.append(g);
      petals.push({ p, a0, a1, rTarget: scale(p.index), ex: 0, exTarget: 0, path, g });
    });
    s.append(pg);

    // Category arcs and labels.
    const catG = svg('g', { class: 'rose-cats', 'aria-hidden': 'true' });
    const arcsG = svg('g', { transform: `translate(${cx} ${cy})` });
    catG.append(arcsG);
    const catArc = d3arc<{ a0: number; a1: number }>()
      .startAngle((d) => d.a0)
      .endAngle((d) => d.a1)
      .innerRadius(arcR - 1)
      .outerRadius(arcR + 1);
    const outIds = new Set(outside.map((o) => o.c.id));
    for (const { c, a0, a1, mid } of spans) {
      const arcPath = svg('path', { d: catArc({ a0, a1 }) ?? '', fill: `var(--cat-${c.id})` });
      arcsG.append(arcPath);
      if (outIds.has(c.id)) {
        const sn = Math.sin(mid);
        const lead = svg('line', {
          x1: (cx + (arcR + 3) * sn).toFixed(2),
          y1: (cy - (arcR + 3) * Math.cos(mid)).toFixed(2),
          x2: (cx + (arcR + LEADER - 4) * sn).toFixed(2),
          y2: (cy - (arcR + LEADER - 4) * Math.cos(mid)).toFixed(2),
          class: 'rose-leader',
          stroke: `var(--cat-${c.id})`,
        });
        const rt = arcR + LEADER;
        const anchor = Math.abs(sn) < 0.25 ? 'middle' : sn < 0 ? 'end' : 'start';
        const t = svg('text', {
          class: 'rose-catlabel',
          'font-size': fs,
          x: (cx + rt * sn + (anchor === 'end' ? -2 : anchor === 'start' ? 2 : 0)).toFixed(2),
          y: (cy - rt * Math.cos(mid) + (Math.cos(mid) < 0 ? fs * 0.8 : fs * 0.3)).toFixed(2),
          'text-anchor': anchor,
        });
        t.textContent = shortLabel(c.label);
        catG.append(lead, t);
        continue;
      }
      const label = c.label;
      const bottom = mid > Math.PI / 2 && mid < (3 * Math.PI) / 2;
      const rl = bottom ? arcR + 6 + fs * 0.72 : arcR + 6;
      const id = `rose-p-${c.id}`;
      const d = bottom
        ? `M ${pt(rl, a1)} A ${rl} ${rl} 0 ${a1 - a0 > Math.PI ? 1 : 0} 0 ${pt(rl, a0)}`
        : `M ${pt(rl, a0)} A ${rl} ${rl} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(rl, a1)}`;
      defs.append(svg('path', { id, d }));
      const t = svg('text', { class: 'rose-catlabel', 'font-size': fs });
      const tp = svg('textPath', { href: `#${id}`, startOffset: '50%', 'text-anchor': 'middle' });
      tp.textContent = label;
      t.append(tp);
      catG.append(t);
    }
    s.append(catG);

    // Until the entry runs the whole chart is masked out; enter() then sweeps it in clockwise.
    if (!entered && !reduced()) s.classList.add('is-pre');
    figure.prepend(s);
    svgEl = s;
    // Settle the SVG classes and paint the first frame (petals are empty until the entry runs).
    paint(performance.now());
    render();
  }

  function enter(): void {
    entered = false;
    animStart = performance.now();
    if (svgEl && !reduced()) {
      const sv = svgEl;
      sv.classList.remove('is-pre');
      sv.classList.add('is-sweeping');
      sv.addEventListener('animationend', () => sv.classList.remove('is-sweeping'), { once: true });
    }
    kick();
    const total = reduced() ? 0 : ENTRY_MS + STAGGER_MS * (ordered.length - 1);
    setTimeout(() => {
      entered = true;
      paint(performance.now());
      countUp();
    }, total + 20);
  }

  let started = false;
  let resizeTimer = 0;
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const w = Math.round(figure.clientWidth);
      if (w === lastW) return;
      lastW = w;
      build();
      if (started && entered) {
        paint(performance.now());
        setNum((hover ?? top).index);
      } else if (started) enter();
    }, 120);
  });
  ro.observe(figure);

  build();
  lastW = Math.round(figure.clientWidth);
  onVisible(root, () => {
    started = true;
    enter();
  });
}
