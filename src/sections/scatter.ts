import '../styles/scatter.css';

import { median } from 'd3-array';
import { scaleLinear, scaleLog } from 'd3-scale';

import type { Dataset } from '../types';
import type { Profile } from '../types-profile';
import { h, onVisible } from '../lib/dom';
import { showTip, hideTip } from '../lib/tooltip';
import { openCard } from './card';

const SVG_NS = 'http://www.w3.org/2000/svg';

type SvgAttrs = Record<string, string | number | null | undefined>;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: SvgAttrs,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      el.setAttribute(k, String(v));
    }
  }
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// JetBrains Mono advance is 0.6em, so a title's width is known without measuring it.
const CHAR_W = 6.6;
const CHAR_W_NARROW = 6;
const LABEL_SIZE = 11;

export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  void profile;

  const projects = data.projects;
  const root = h('div', { class: 'sc' });
  el.append(root);
  if (!projects.length) return;

  // Categories kept bright; the others are dimmed, never hidden.
  const focus = new Set<string>();

  // legend
  const legend = h('div', { class: 'sc-legend', role: 'group', 'aria-label': 'Categories' });
  const legendItems = new Map<string, HTMLButtonElement>();
  for (const c of data.categories) {
    const btn = h('button', { class: 'sc-item', type: 'button', 'aria-pressed': 'false' });
    btn.append(
      h('span', { class: 'sc-sq', style: `background:var(--cat-${c.id})` }),
      document.createTextNode(c.label),
    );
    btn.addEventListener('click', () => {
      if (focus.has(c.id)) focus.delete(c.id);
      else focus.add(c.id);
      applyFocus();
    });
    legendItems.set(c.id, btn);
    legend.append(btn);
  }
  root.append(legend);

  // chart skeleton
  const chart = h('div', { class: 'sc-chart' });
  const svgEl = svg('svg', { class: 'sc-svg', role: 'img' });
  chart.append(svgEl);
  root.append(chart);

  const note = h('p', { class: 'sc-note mono' });
  root.append(note);

  const quadG = svg('g', { class: 'sc-quad' });
  const quadRect = svg('rect', { class: 'sc-quad-rect' });
  const quadLabel = svg('text', { class: 'sc-quad-label' });
  quadLabel.textContent = 'Most efficient';
  quadG.append(quadRect, quadLabel);

  const gridG = svg('g', { class: 'sc-grid' });
  const axisG = svg('g', { class: 'sc-axis' });
  const dotsG = svg('g', { class: 'sc-dots' });
  const labelsG = svg('g', { class: 'sc-labels' });
  svgEl.append(quadG, gridG, axisG, dotsG, labelsG);

  // domains
  const maxCommits = Math.max(1, ...projects.map((p) => p.commits));
  const domainMax = 10 ** (Math.floor(Math.log10(maxCommits)) + 1);
  const xTicks: number[] = [];
  for (let v = 1; v <= domainMax; v *= 10) xTicks.push(v);
  const yTicks = [0, 25, 50, 75, 100];
  const medCommits = median(projects.map((p) => p.commits)) ?? 1;
  const medIndex = median(projects.map((p) => p.index)) ?? 0;

  note.textContent = `Shaded: index above the median (${Math.round(medIndex)}) with commits below the median (${Math.round(medCommits)})`;

  // grid and ticks
  const xGrid = xTicks.map(() => svg('line', { class: 'sc-grid-line' }));
  const yGrid = yTicks.map(() => svg('line', { class: 'sc-grid-line' }));
  xGrid.forEach((l) => gridG.append(l));
  yGrid.forEach((l) => gridG.append(l));

  const xTickEls = xTicks.map((t) => {
    const el = svg('text', { class: 'sc-tick' });
    el.textContent = String(t);
    axisG.append(el);
    return el;
  });
  const yTickEls = yTicks.map((t) => {
    const el = svg('text', { class: 'sc-tick' });
    el.textContent = String(t);
    axisG.append(el);
    return el;
  });
  const xTitle = svg('text', { class: 'sc-axis-title' });
  xTitle.textContent = 'Effort · commits (log)';
  const yTitle = svg('text', { class: 'sc-axis-title' });
  yTitle.textContent = 'Engineering Index';
  axisG.append(xTitle, yTitle);

  // one group per category so dimming is a single opacity on the group
  const dotGroups = new Map<string, SVGGElement>();
  const labelGroups = new Map<string, SVGGElement>();
  for (const c of data.categories) {
    const dg = svg('g', { class: 'sc-cat', 'data-cat': c.id });
    dotGroups.set(c.id, dg);
    dotsG.append(dg);
    const lg = svg('g', { class: 'sc-cat-labels', 'data-cat': c.id });
    labelGroups.set(c.id, lg);
    labelsG.append(lg);
  }

  function applyFocus(): void {
    for (const [id, btn] of legendItems) {
      btn.setAttribute('aria-pressed', String(focus.has(id)));
    }
    const any = focus.size > 0;
    for (const c of data.categories) {
      const bright = !any || focus.has(c.id);
      dotGroups.get(c.id)?.classList.toggle('is-dim', !bright);
      labelGroups.get(c.id)?.classList.toggle('is-dim', !bright);
    }
  }

  // dots
  const dotEls = new Map<string, { g: SVGGElement; mark: SVGCircleElement }>();
  for (const p of projects) {
    const mark = svg('circle', { class: 'sc-mark', r: 5 });
    mark.style.fill = `var(--cat-${p.category})`;
    const g = svg('g', {
      class: 'sc-dot',
      'data-cat': p.category,
      tabindex: 0,
      role: 'button',
    });
    g.setAttribute('aria-label', `${p.title}. Index ${p.index}, ${p.commits} commits.`);
    g.append(mark);
    dotGroups.get(p.category)?.append(g);

    const tipHtml = (): string =>
      `<strong>${escapeHtml(p.title)}</strong><br>Index ${p.index} · Commits ${p.commits}`;

    const hot = (on: boolean): void => {
      mark.setAttribute('r', String(on ? 7 : 5));
    };

    g.addEventListener('mouseenter', (e: MouseEvent) => {
      hot(true);
      showTip(tipHtml(), e.clientX, e.clientY);
    });
    g.addEventListener('mousemove', (e: MouseEvent) => {
      showTip(tipHtml(), e.clientX, e.clientY);
    });
    g.addEventListener('mouseleave', () => {
      if (document.activeElement !== g) {
        hot(false);
        hideTip();
      }
    });
    g.addEventListener('focus', () => {
      hot(true);
      const r = mark.getBoundingClientRect();
      showTip(tipHtml(), r.left + r.width / 2, r.top + r.height / 2);
    });
    g.addEventListener('blur', () => {
      hot(false);
      hideTip();
    });
    g.addEventListener('click', () => openCard(p.repo));
    g.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCard(p.repo);
      }
    });

    dotEls.set(p.repo, { g, mark });
  }

  // direct labels for the six highest-index projects
  const labelled = [...projects].sort((a, b) => b.index - a.index).slice(0, 6);
  const labelEls = new Map<string, SVGTextElement>();
  for (const p of labelled) {
    const t = svg('text', { class: 'sc-label', 'data-cat': p.category });
    t.textContent = p.title;
    labelGroups.get(p.category)?.append(t);
    labelEls.set(p.repo, t);
  }

  function boxOf(
    x: number,
    y: number,
    w: number,
    anchor: 'start' | 'end' | 'middle',
  ): Box {
    const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    return { x0, y0: y - LABEL_SIZE + 2, x1: x0 + w, y1: y + 3 };
  }

  function overlap(a: Box, b: Box): number {
    const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function render(): void {
    const width = Math.floor(el.clientWidth);
    if (width < 120) return;
    const narrow = window.innerWidth < 640;
    const height = Math.round(narrow ? (width * 5) / 4 : (width * 9) / 16);

    const m = narrow
      ? { top: 14, right: 14, bottom: 46, left: 48 }
      : { top: 18, right: 22, bottom: 52, left: 56 };
    const plotLeft = m.left;
    const plotRight = width - m.right;
    const plotTop = m.top;
    const plotBottom = height - m.bottom;

    const x = scaleLog().domain([1, domainMax]).range([plotLeft + 7, plotRight - 7]);
    const y = scaleLinear().domain([0, 100]).range([plotBottom, plotTop + 8]);

    svgEl.setAttribute('width', String(width));
    svgEl.setAttribute('height', String(height));
    svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svgEl.setAttribute(
      'aria-label',
      `Scatter of ${projects.length} projects: engineering index against commit count on a log scale. ` +
        `The shaded top-left quadrant holds the projects scoring above the median index ` +
        `${Math.round(medIndex)} with fewer commits than the median ${Math.round(medCommits)}.`,
    );

    // shaded quadrant: below the median commits and above the median index
    const qx = x(medCommits);
    const qy = y(medIndex);
    quadRect.setAttribute('x', String(plotLeft));
    quadRect.setAttribute('y', String(plotTop));
    quadRect.setAttribute('width', String(Math.max(0, qx - plotLeft)));
    quadRect.setAttribute('height', String(Math.max(0, qy - plotTop)));
    quadLabel.setAttribute('x', String(plotLeft + 11));
    quadLabel.setAttribute('y', String(plotTop + 13));

    xGrid.forEach((line, i) => {
      const px = x(xTicks[i]);
      line.setAttribute('x1', String(px));
      line.setAttribute('x2', String(px));
      line.setAttribute('y1', String(plotTop));
      line.setAttribute('y2', String(plotBottom));
    });
    yGrid.forEach((line, i) => {
      const py = y(yTicks[i]);
      line.setAttribute('x1', String(plotLeft));
      line.setAttribute('x2', String(plotRight));
      line.setAttribute('y1', String(py));
      line.setAttribute('y2', String(py));
    });

    xTickEls.forEach((t, i) => {
      t.setAttribute('x', String(x(xTicks[i])));
      t.setAttribute('y', String(plotBottom + 18));
      t.setAttribute(
        'text-anchor',
        i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle',
      );
    });
    yTickEls.forEach((t, i) => {
      t.setAttribute('x', String(plotLeft - 8));
      t.setAttribute('y', String(y(yTicks[i]) + 4));
      t.setAttribute('text-anchor', 'end');
    });

    xTitle.setAttribute('x', String((plotLeft + plotRight) / 2));
    xTitle.setAttribute('y', String(height - 14));
    xTitle.setAttribute('text-anchor', 'middle');

    const yMid = (plotTop + plotBottom) / 2;
    yTitle.setAttribute('x', String(narrow ? 11 : 13));
    yTitle.setAttribute('y', String(yMid));
    yTitle.setAttribute('transform', `rotate(-90 ${narrow ? 11 : 13} ${yMid})`);
    yTitle.setAttribute('text-anchor', 'middle');

    // dots are obstacles too: a label that runs over a dot reads as a collision
    const dotBoxes = new Map<string, Box>();
    for (const p of projects) {
      const d = dotEls.get(p.repo);
      if (!d) continue;
      const cx = x(p.commits);
      const cy = y(p.index);
      d.g.style.setProperty('--x', `${cx}px`);
      d.g.style.setProperty('--y', `${cy}px`);
      dotBoxes.set(p.repo, { x0: cx - 8, y0: cy - 8, x1: cx + 8, y1: cy + 8 });
    }

    // labels: right, then left, then above, skipping the ones already placed
    const placed: Box[] = [];
    for (const p of labelled) {
      const t = labelEls.get(p.repo);
      if (!t) continue;
      const cx = x(p.commits);
      const cy = y(p.index);
      const w = p.title.length * (narrow ? CHAR_W_NARROW : CHAR_W) + 4;
      const candidates: { x: number; y: number; anchor: 'start' | 'end' | 'middle' }[] = [
        { x: cx + 11, y: cy + 4, anchor: 'start' },
        { x: cx - 11, y: cy + 4, anchor: 'end' },
        { x: cx, y: cy - 14, anchor: 'middle' },
      ];
      // a label never counts its own dot as an obstacle
      const blockers = placed.concat(
        [...dotBoxes].filter(([repo]) => repo !== p.repo).map(([, b]) => b),
      );
      let picked = candidates[0];
      let best = Infinity;
      for (const c of candidates) {
        const box = boxOf(c.x, c.y, w, c.anchor);
        const inside = box.x0 >= 0 && box.x1 <= width && box.y0 >= 0 && box.y1 <= height;
        const cost = blockers.reduce((sum, b) => sum + overlap(box, b), 0) + (inside ? 0 : 1e5);
        if (cost === 0) {
          picked = c;
          break;
        }
        if (cost < best) {
          best = cost;
          picked = c;
        }
      }
      // when nothing fits, slide the label back inside the canvas
      const fb = boxOf(picked.x, picked.y, w, picked.anchor);
      const shift = fb.x0 < 0 ? -fb.x0 : fb.x1 > width ? width - fb.x1 : 0;
      if (shift !== 0) picked = { ...picked, x: picked.x + shift };
      placed.push(boxOf(picked.x, picked.y, w, picked.anchor));
      t.setAttribute('x', String(picked.x));
      t.setAttribute('y', String(picked.y));
      t.setAttribute('text-anchor', picked.anchor);
    }
  }

  onVisible(root, () => root.classList.add('is-in'));

  let lastWidth = 0;
  let resizeTimer: number | null = null;
  const ro = new ResizeObserver(() => {
    const w = Math.floor(el.clientWidth);
    if (w === lastWidth) return;
    lastWidth = w;
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(render, 120);
  });
  ro.observe(el);

  render();
}
