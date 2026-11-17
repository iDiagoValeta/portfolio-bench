import '../styles/trajectory.css';

import { scaleLinear, scaleTime } from 'd3-scale';
import { line, curveStepAfter } from 'd3-shape';
import { utcFormat } from 'd3-time-format';

import type { Dataset } from '../types';
import type { Profile, ProfileExperience } from '../types-profile';
import { h, onVisible } from '../lib/dom';
import { asOfDate } from '../lib/format';
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
const DOMAIN_START = new Date('2025-01-01T00:00:00Z');
const Y_STEP = 5;

// Short names keep the lane labels readable; the changelog spells the full org.
const ORG_SHORT: Record<string, string> = {
  'Museo de Informática, UPV': 'UPV Museum',
  'Grupo CEU': 'Grupo CEU',
  'Auro AI': 'Auro AI',
  Inditex: 'Inditex',
};

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

function shortOrg(org: string): string {
  return ORG_SHORT[org] ?? org;
}

const fmtMonth = utcFormat('%b %Y');
const fmtQuarter = utcFormat('%b');

export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  const root = h('div', { class: 'tr' });
  el.append(root);

  // The whole as-of day counts: a project created that day stays inside the domain.
  const asOf = asOfDate(data.asOf);

  // --- trend tile: lives in the section's h2 row, not loose above the chart ---
  const cutoff = new Date(asOf);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
  const recentCount = data.projects.filter((p) => {
    const created = Date.parse(p.createdAt);
    return created >= cutoff.getTime() && created <= asOf.getTime();
  }).length;
  const tile = h('div', { class: 'tr-tile' });
  tile.append(
    h('span', { class: 'tr-tile-num' }, `↑ ${recentCount}`),
    h('span', { class: 'tr-tile-lab mono' }, 'public projects in the last 12 months'),
  );
  const title = el.closest('section')?.querySelector('h2');
  const titleParent = title?.parentElement;
  if (title && titleParent) {
    // Insert the empty row at the heading's spot, then move the heading into
    // it. Appending the heading first would detach it and break insertBefore.
    const head = h('div', { class: 'tr-head' });
    titleParent.insertBefore(head, title);
    head.append(title, tile);
  } else {
    root.append(h('div', { class: 'tr-head' }, tile));
  }

  // --- experience rows (greedy stacking) ---
  const exps = profile.experience
    .filter((e) => e.org !== 'Superprof')
    .sort((a, b) => toDate(a.from).getTime() - toDate(b.from).getTime());
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

  // --- sorted projects and the y domain ---
  const sortedProjects = [...data.projects].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  // Keep a little headroom above the curve, but never less than the 25 the
  // review asks for.
  const yMax = Math.max(25, Math.ceil(sortedProjects.length / Y_STEP) * Y_STEP);
  const yTickValues: number[] = [];
  for (let t = 0; t <= yMax; t += Y_STEP) yTickValues.push(t);

  // --- svg skeleton ---
  const svgEl = svg('svg', { class: 'tr-svg', role: 'img' });
  svgEl.setAttribute(
    'aria-label',
    `Trajectory from 2025 to ${data.asOf}: experience bands and cumulative count of ${data.projects.length} public projects.`,
  );
  root.append(svgEl);

  const laneG = svg('g', { class: 'tr-lane' });
  const gridG = svg('g', { class: 'tr-grid' });
  const axisG = svg('g', { class: 'tr-axis' });
  const lineG = svg('g', { class: 'tr-lineg' });
  const dotsG = svg('g', { class: 'tr-dots' });
  const crossG = svg('g', { class: 'tr-cross' });
  // The crosshair hit area sits under the line and the dots so their hover and
  // click handlers win; the hairline itself stays on top but ignores pointers.
  const crossRect = svg('rect', { class: 'tr-crossrect' });
  svgEl.append(laneG, gridG, axisG, crossRect, lineG, dotsG, crossG);

  // quarterly ticks (text)
  const quarterDates: Date[] = [];
  for (let i = 0; ; i++) {
    const d = new Date(Date.UTC(2025, i * 3, 1));
    if (d > asOf) break;
    quarterDates.push(d);
  }
  const quarterTexts = quarterDates.map((d) => {
    const t = svg('text', { class: 'tr-tick' });
    t.textContent = d.getUTCMonth() === 0 ? fmtMonth(d) : fmtQuarter(d);
    axisG.append(t);
    return { d, el: t };
  });

  // y-axis ticks
  const yGridLines: SVGLineElement[] = [];
  const yTickTexts: SVGTextElement[] = [];
  for (let i = 0; i < yTickValues.length; i++) {
    const l = svg('line', { class: 'tr-gridline' });
    gridG.append(l);
    yGridLines.push(l);
    const t = svg('text', { class: 'tr-tick tr-tick-y' });
    t.textContent = String(yTickValues[i]);
    axisG.append(t);
    yTickTexts.push(t);
  }

  // bands
  const bands = rows.map((r) => {
    const rect = svg('rect', {
      class: r.current ? 'tr-band tr-band--current' : 'tr-band',
    });
    const label = svg('text', { class: 'tr-band-label' });
    label.textContent = shortOrg(r.exp.org);
    laneG.append(rect, label);
    return { ...r, rect, label };
  });

  // step line
  const points: { date: Date; count: number }[] = [{ date: DOMAIN_START, count: 0 }];
  let c = 0;
  for (const p of sortedProjects) {
    c++;
    points.push({ date: new Date(p.createdAt), count: c });
  }
  const pathEl = svg('path', { class: 'tr-line' });
  lineG.append(pathEl);

  // Optional: the final cumulative count sits at the end of the step line.
  const endLabel = svg('text', { class: 'tr-end-label' });
  endLabel.textContent = String(sortedProjects.length);
  lineG.append(endLabel);

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

  const lineGen = line<{ date: Date; count: number }>()
    .x((d) => xScale(d.date))
    .y((d) => yScale(d.count))
    .curve(curveStepAfter);

  let xScale = scaleTime().domain([DOMAIN_START, asOf]);
  let yScale = scaleLinear().domain([0, yMax]);

  let played = false;
  let resizeTimer: number | null = null;

  function layout(): void {
    const width = Math.floor(el.clientWidth);
    if (width < 120) return;
    const narrow = window.innerWidth < 640;
    const plotH = narrow ? PLOT_H_MOBILE : PLOT_H_DESKTOP;
    // On mobile the staggered labels live above and below the band, so the
    // lane needs breathing room at both ends to stay inside the SVG.
    const laneTop = narrow ? 16 : 2;
    const laneH = laneTop + rowCount * ROW_H + (narrow ? 24 : 4);
    const totalH = laneH + LANE_GAP + plotH + BOTTOM_M;

    const mLeft = LEFT_M;
    const mRight = RIGHT_M;
    const plotTop = laneH + LANE_GAP;
    const plotBottom = totalH - BOTTOM_M;

    xScale = scaleTime().domain([DOMAIN_START, asOf]).range([mLeft, width - mRight]);
    yScale = scaleLinear().domain([0, yMax]).range([plotBottom, plotTop]);

    svgEl.setAttribute('width', String(width));
    svgEl.setAttribute('height', String(totalH));
    svgEl.setAttribute('viewBox', `0 0 ${width} ${totalH}`);

    // bands
    bands.forEach((b, i) => {
      const x1 = xScale(b.from);
      const x2 = xScale(b.to);
      const bw = Math.max(0, x2 - x1);
      const by = laneTop + b.row * ROW_H + (ROW_H - BAND_H) / 2;
      b.rect.setAttribute('x', String(x1));
      b.rect.setAttribute('y', String(by));
      b.rect.setAttribute('width', String(bw));
      b.rect.setAttribute('height', String(BAND_H));

      const labelStr = shortOrg(b.exp.org);
      const estW = labelStr.length * 6.5;
      const above = i % 2 === 0;
      if (narrow) {
        // Stagger even and odd bands so short bands never collide.
        const cx = Math.min(
          Math.max(x1 + bw / 2, mLeft + estW / 2),
          width - mRight - estW / 2,
        );
        b.label.setAttribute('x', String(cx));
        b.label.setAttribute('y', String(above ? by - 5 : by + BAND_H + 12));
        b.label.setAttribute('text-anchor', 'middle');
        b.label.setAttribute(
          'class',
          b.current
            ? 'tr-band-label tr-band-label--current tr-band-label--outside'
            : 'tr-band-label tr-band-label--outside',
        );
      } else {
        b.label.setAttribute('x', String(x1 + bw / 2));
        b.label.setAttribute('y', String(by + BAND_H / 2 + 4));
        b.label.setAttribute('text-anchor', 'middle');
        b.label.setAttribute(
          'class',
          b.current ? 'tr-band-label tr-band-label--current' : 'tr-band-label',
        );
      }
    });

    // y ticks
    yTickValues.forEach((t, i) => {
      const py = yScale(t);
      yGridLines[i].setAttribute('x1', String(mLeft));
      yGridLines[i].setAttribute('x2', String(width - mRight));
      yGridLines[i].setAttribute('y1', String(py));
      yGridLines[i].setAttribute('y2', String(py));
      yTickTexts[i].setAttribute('x', String(mLeft - 6));
      yTickTexts[i].setAttribute('y', String(py + 4));
      yTickTexts[i].setAttribute('text-anchor', 'end');
    });

    // quarterly ticks; half-yearly on mobile so the labels stay legible
    for (const qt of quarterTexts) {
      const hide = narrow && qt.d.getUTCMonth() % 6 !== 0;
      qt.el.style.display = hide ? 'none' : '';
      qt.el.setAttribute('x', String(xScale(qt.d)));
      qt.el.setAttribute('y', String(totalH - 8));
      qt.el.setAttribute('text-anchor', 'middle');
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

    // End-of-line cumulative count, kept inside the canvas.
    if (points.length > 1) {
      const last = points[points.length - 1];
      const lx = xScale(last.date);
      const ly = yScale(last.count);
      const toLeft = lx > width - 44;
      endLabel.setAttribute('x', String(toLeft ? lx - 8 : lx + 8));
      endLabel.setAttribute('y', String(ly + 7));
      endLabel.setAttribute('text-anchor', toLeft ? 'end' : 'start');
    } else {
      endLabel.style.display = 'none';
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

    // crosshair hit area
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
  }

  // crosshair interactions
  function onMove(e: PointerEvent) {
    const svgRect = svgEl.getBoundingClientRect();
    const px = e.clientX - svgRect.left;
    const width = Math.floor(el.clientWidth);
    const plotLeft = LEFT_M;
    const plotRight = width - RIGHT_M;
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
