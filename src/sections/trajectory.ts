import '../styles/trajectory.css';

import { scaleLinear, scaleTime } from 'd3-scale';
import { line, curveStepAfter } from 'd3-shape';
import { utcFormat } from 'd3-time-format';

import type { Dataset } from '../types';
import type { Profile, ProfileExperience } from '../types-profile';
import { h, onVisible } from '../lib/dom';
import { showTip, hideTip } from '../lib/tooltip';
import { openCard } from './card';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ROW_H = 26;
const BAND_H = 22;
const PLOT_H_DESKTOP = 260;
const PLOT_H_MOBILE = 200;
const BOTTOM_M = 30;
const LEFT_M = 36;
const RIGHT_M = 16;
const LANE_GAP = 12;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number | null | undefined>,
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

function toDate(s: string): Date {
  return new Date(s.length === 7 ? `${s}-01` : s);
}

const fmtMonth = utcFormat('%b %Y');

export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  const root = h('div', { class: 'tr' });
  el.append(root);

  const asOf = new Date(data.asOf);
  const domainStart = new Date('2022-01-01T00:00:00Z');

  // --- trend tile ---
  const cutoff = new Date(asOf);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
  const recentCount = data.projects.filter((p) => Date.parse(p.createdAt) >= cutoff.getTime()).length;
  const tile = h('div', { class: 'tr-tile' });
  tile.append(
    h('span', { class: 'tr-tile-num mono' }, `↑ ${recentCount} projects / year`),
    h('span', { class: 'tr-tile-lab' }, 'public projects shipped'),
  );
  root.append(tile);

  // --- experience rows (greedy stacking) ---
  const exps = [...profile.experience].sort(
    (a, b) => toDate(a.from).getTime() - toDate(b.from).getTime(),
  );
  const rowEnds: number[] = [];
  const rows: { exp: ProfileExperience; row: number; from: Date; to: Date; current: boolean }[] = [];
  for (const e of exps) {
    const from = toDate(e.from);
    const to = e.to ? toDate(e.to) : asOf;
    const current = e.to === null;
    let row = rowEnds.findIndex((end) => end <= from.getTime());
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(to.getTime());
    } else {
      rowEnds[row] = Math.max(rowEnds[row], to.getTime());
    }
    rows.push({ exp: e, row, from, to, current });
  }
  const rowCount = Math.max(1, rowEnds.length);

  // --- svg skeleton ---
  const svgEl = svg('svg', { class: 'tr-svg', role: 'img' });
  svgEl.setAttribute(
    'aria-label',
    `Trajectory from 2022 to ${data.asOf}: experience bands and cumulative count of ${data.projects.length} public projects.`,
  );
  root.append(svgEl);

  const laneG = svg('g', { class: 'tr-lane' });
  const gridG = svg('g', { class: 'tr-grid' });
  const axisG = svg('g', { class: 'tr-axis' });
  const lineG = svg('g', { class: 'tr-lineg' });
  const dotsG = svg('g', { class: 'tr-dots' });
  const crossG = svg('g', { class: 'tr-cross' });
  svgEl.append(laneG, gridG, axisG, lineG, dotsG, crossG);

  // year ticks (text)
  const years: number[] = [];
  for (let y = 2022; y <= asOf.getUTCFullYear(); y++) years.push(y);
  const yearTexts = years.map((y) => {
    const t = svg('text', { class: 'tr-tick' });
    t.textContent = String(y);
    axisG.append(t);
    return { y, el: t };
  });

  // y-axis ticks
  const yTickTexts: SVGTextElement[] = [];
  const yGridLines: SVGLineElement[] = [];
  // created lazily in layout based on count; store arrays sized to ticks
  let yTicksCache: number[] = [];

  // bands
  const bands = rows.map((r) => {
    const rect = svg('rect', { class: 'tr-band' });
    if (r.current) {
      rect.setAttribute('fill', 'var(--ink)');
      rect.setAttribute('stroke', 'var(--ink-3)');
    } else {
      rect.setAttribute('fill', 'var(--line)');
      rect.setAttribute('stroke', 'var(--ink-3)');
    }
    rect.setAttribute('stroke-width', '1');
    const label = svg('text', { class: 'tr-band-label' });
    label.textContent = `${r.exp.role} · ${r.exp.org}`;
    if (r.current) label.setAttribute('fill', 'var(--bg)');
    else label.setAttribute('fill', 'var(--ink)');
    laneG.append(rect, label);
    return { ...r, rect, label };
  });

  // step line
  const sortedProjects = [...data.projects].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  const points: { date: Date; count: number }[] = [{ date: domainStart, count: 0 }];
  let c = 0;
  for (const p of sortedProjects) {
    c++;
    points.push({ date: new Date(p.createdAt), count: c });
  }
  const pathEl = svg('path', { class: 'tr-line' });
  lineG.append(pathEl);

  // dots
  const dotItems: { circle: SVGCircleElement; project: (typeof sortedProjects)[number]; count: number }[] = [];
  let cc = 0;
  for (const p of sortedProjects) {
    cc++;
    const circle = svg('circle', {
      class: 'tr-dot',
      r: 4,
      tabindex: 0,
      role: 'button',
    });
    circle.style.fill = `var(--cat-${p.category})`;
    circle.setAttribute('stroke', 'var(--surface)');
    circle.setAttribute('stroke-width', '2');
    circle.setAttribute('aria-label', `${p.title}, ${fmtMonth(new Date(p.createdAt))}`);
    const tip = `<strong>${escapeHtml(p.title)}</strong><br><span class="mono">${fmtMonth(new Date(p.createdAt))}</span>`;
    circle.addEventListener('mouseenter', (e: MouseEvent) => showTip(tip, e.clientX, e.clientY));
    circle.addEventListener('mousemove', (e: MouseEvent) => showTip(tip, e.clientX, e.clientY));
    circle.addEventListener('mouseleave', () => hideTip());
    circle.addEventListener('focus', () => {
      const r = circle.getBoundingClientRect();
      showTip(tip, r.left + r.width / 2, r.top);
    });
    circle.addEventListener('blur', () => hideTip());
    circle.addEventListener('click', () => openCard(p.repo));
    circle.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCard(p.repo);
      }
    });
    dotsG.append(circle);
    dotItems.push({ circle, project: p, count: cc });
  }

  // crosshair
  const hairline = svg('line', { class: 'tr-hair' });
  crossG.append(hairline);
  const crossRect = svg('rect', { class: 'tr-crossrect' });
  crossG.append(crossRect);

  const lineGen = line<{ date: Date; count: number }>()
    .x((d) => xScale(d.date))
    .y((d) => yScale(d.count))
    .curve(curveStepAfter);

  let xScale = scaleTime().domain([domainStart, asOf]);
  let yScale = scaleLinear().domain([0, Math.max(1, sortedProjects.length)]);

  let played = false;
  let lastWidth = 0;
  let resizeTimer: number | null = null;

  function ensureYTicks(count: number) {
    const ticks = yScale.ticks(Math.min(6, count + 1));
    // rebuild arrays if count changed
    if (ticks.length !== yTicksCache.length) {
      // clear
      yGridLines.forEach((l) => l.remove());
      yTickTexts.forEach((t) => t.remove());
      yGridLines.length = 0;
      yTickTexts.length = 0;
      yTicksCache = ticks;
      for (const _ of ticks) {
        const l = svg('line', { class: 'tr-gridline' });
        gridG.append(l);
        yGridLines.push(l);
        const t = svg('text', { class: 'tr-tick tr-tick-y' });
        axisG.append(t);
        yTickTexts.push(t);
      }
    } else {
      yTicksCache = ticks;
    }
  }

  function layout(): void {
    const width = Math.floor(el.clientWidth);
    if (width < 120) return;
    const narrow = window.innerWidth < 640;
    const plotH = narrow ? PLOT_H_MOBILE : PLOT_H_DESKTOP;
    const laneH = rowCount * ROW_H + 4;
    const totalH = laneH + LANE_GAP + plotH + BOTTOM_M;

    const mLeft = LEFT_M;
    const mRight = RIGHT_M;
    const plotTop = laneH + LANE_GAP;
    const plotBottom = totalH - BOTTOM_M;

    xScale = scaleTime().domain([domainStart, asOf]).range([mLeft, width - mRight]);
    yScale = scaleLinear().domain([0, Math.max(1, sortedProjects.length)]).range([plotBottom, plotTop]);

    svgEl.setAttribute('width', String(width));
    svgEl.setAttribute('height', String(totalH));
    svgEl.setAttribute('viewBox', `0 0 ${width} ${totalH}`);

    // bands
    for (const b of bands) {
      const x1 = xScale(b.from);
      const x2 = xScale(b.to);
      const bw = Math.max(0, x2 - x1);
      const by = 2 + b.row * ROW_H + (ROW_H - BAND_H) / 2;
      b.rect.setAttribute('x', String(x1));
      b.rect.setAttribute('y', String(by));
      b.rect.setAttribute('width', String(bw));
      b.rect.setAttribute('height', String(BAND_H));
      const labelStr = `${b.exp.role} · ${b.exp.org}`;
      const estW = labelStr.length * 6.2;
      const fits = bw >= estW + 10;
      if (fits) {
        b.label.setAttribute('x', String(x1 + bw / 2));
        b.label.setAttribute('y', String(by + BAND_H / 2 + 4));
        b.label.setAttribute('text-anchor', 'middle');
        b.label.setAttribute('class', 'tr-band-label');
        if (b.current) b.label.setAttribute('fill', 'var(--bg)');
        else b.label.setAttribute('fill', 'var(--ink)');
      } else {
        b.label.setAttribute('x', String(x1));
        b.label.setAttribute('y', String(by - 4));
        b.label.setAttribute('text-anchor', 'start');
        b.label.setAttribute('class', 'tr-band-label tr-band-label--above');
        b.label.setAttribute('fill', 'var(--ink-2)');
      }
    }

    // y ticks
    ensureYTicks(sortedProjects.length);
    yTicksCache.forEach((t, i) => {
      const py = yScale(t);
      yGridLines[i].setAttribute('x1', String(mLeft));
      yGridLines[i].setAttribute('x2', String(width - mRight));
      yGridLines[i].setAttribute('y1', String(py));
      yGridLines[i].setAttribute('y2', String(py));
      yTickTexts[i].setAttribute('x', String(mLeft - 6));
      yTickTexts[i].setAttribute('y', String(py + 4));
      yTickTexts[i].setAttribute('text-anchor', 'end');
      yTickTexts[i].textContent = String(t);
    });

    // year ticks
    for (const yt of yearTexts) {
      const d = new Date(`${yt.y}-01-01T00:00:00Z`);
      const px = xScale(d);
      yt.el.setAttribute('x', String(px));
      yt.el.setAttribute('y', String(totalH - 8));
      yt.el.setAttribute('text-anchor', 'middle');
    }

    // step line
    const d = lineGen(points);
    pathEl.setAttribute('d', d ?? '');
    if (!played) {
      const len = pathEl.getTotalLength();
      pathEl.style.strokeDasharray = String(len);
      pathEl.style.strokeDashoffset = String(len);
    } else {
      pathEl.style.strokeDasharray = '';
      pathEl.style.strokeDashoffset = '0';
    }

    // dots
    let cnt = 0;
    for (const di of dotItems) {
      cnt++;
      const cx = xScale(new Date(di.project.createdAt));
      const cy = yScale(cnt);
      di.circle.setAttribute('cx', String(cx));
      di.circle.setAttribute('cy', String(cy));
    }

    // crosshair rect
    crossRect.setAttribute('x', String(mLeft));
    crossRect.setAttribute('y', String(plotTop));
    crossRect.setAttribute('width', String(width - mLeft - mRight));
    crossRect.setAttribute('height', String(plotBottom - plotTop));
    crossRect.setAttribute('fill', 'transparent');
    crossRect.setAttribute('pointer-events', 'all');

    // hairline initial
    hairline.setAttribute('x1', String(mLeft));
    hairline.setAttribute('x2', String(mLeft));
    hairline.setAttribute('y1', String(plotTop));
    hairline.setAttribute('y2', String(plotBottom));
    hairline.style.opacity = '0';

    lastWidth = width;
  }

  // crosshair interactions
  function onMove(e: PointerEvent) {
    const rect = crossRect.getBoundingClientRect();
    const svgRect = svgEl.getBoundingClientRect();
    const px = e.clientX - svgRect.left;
    const mLeft = LEFT_M;
    const mRight = RIGHT_M;
    const width = Math.floor(el.clientWidth);
    const plotLeft = mLeft;
    const plotRight = width - mRight;
    const clamped = Math.max(plotLeft, Math.min(plotRight, px));
    const date = xScale.invert(clamped);
    // cumulative count
    let count = 0;
    for (const p of sortedProjects) {
      if (Date.parse(p.createdAt) <= date.getTime()) count++;
      else break;
    }
    // nearest project
    let nearest = sortedProjects[0];
    let best = Infinity;
    for (const p of sortedProjects) {
      const diff = Math.abs(Date.parse(p.createdAt) - date.getTime());
      if (diff < best) {
        best = diff;
        nearest = p;
      }
    }
    hairline.setAttribute('x1', String(clamped));
    hairline.setAttribute('x2', String(clamped));
    hairline.style.opacity = '1';
    const html = `<span class="mono">${fmtMonth(date)}</span><br>${count} projects<br><strong>${escapeHtml(nearest.title)}</strong>`;
    showTip(html, e.clientX, e.clientY);
  }
  function onLeave() {
    hairline.style.opacity = '0';
    hideTip();
  }
  crossRect.addEventListener('pointermove', onMove);
  crossRect.addEventListener('pointerleave', onLeave);

  layout();

  onVisible(root, () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      played = true;
      root.classList.add('is-in');
      pathEl.style.strokeDasharray = '';
      pathEl.style.strokeDashoffset = '0';
      return;
    }
    const len = pathEl.getTotalLength();
    pathEl.style.strokeDasharray = String(len);
    pathEl.style.strokeDashoffset = String(len);
    // force reflow
    void pathEl.getBoundingClientRect();
    requestAnimationFrame(() => {
      pathEl.style.transition = 'stroke-dashoffset 900ms cubic-bezier(0.2,0.8,0.3,1)';
      pathEl.style.strokeDashoffset = '0';
    });
    window.setTimeout(() => {
      played = true;
      root.classList.add('is-in');
    }, 900);
  });

  const ro = new ResizeObserver(() => {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      layout();
    }, 150);
  });
  ro.observe(el);
}
