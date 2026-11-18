import '../styles/trajectory.css';

import { scaleLinear, scaleTime } from 'd3-scale';
import { area, line, curveStepAfter } from 'd3-shape';
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
// One band per lane when a label does not fit inside its band.
const LANE_ROW_H = 24;
const LANE_BAND_H = 18;
const PLOT_MIN = 240;
const PLOT_MAX = 560;
const PLOT_H_MOBILE = 220;
const BOTTOM_M = 30;
const LEFT_M = 36;
const Y_STEP = 5;
const DOMAIN_START = new Date('2025-01-01T00:00:00Z');
// Dot radius and the gap kept between any two dots, in px.
const DOT_R = 5;
const DOT_R_NARROW = 4.5;
const DOT_GAP = 3;
// Scroll-driven draw: the line is drawn between these two points of the card's cover range (percent).
const DRAW_FROM = 4;
const DRAW_TO = 44;
const supportsScrollTimeline = typeof CSS !== 'undefined' && CSS.supports?.('animation-timeline: view()');

// Short names keep the lane labels readable inside narrow bands.
const ORG_SHORT: Record<string, string> = {
  'Museo de Informática, UPV': 'UPV Museum',
};

// Narrow screens: even shorter, the roles become a labelled bracket row under the axis.
const ORG_NARROW: Record<string, string> = {
  'Grupo CEU': 'CEU',
  'Museo de Informática, UPV': 'UPV Museum',
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

  // The whole as-of day counts: a project created that day stays inside the domain.
  const asOf = asOfDate(data.asOf);

  // --- experience bands (greedy stacking, one lane per overlap) ---
  const exps = profile.experience
    .filter((e) => toDate(e.to ?? data.asOf).getTime() > DOMAIN_START.getTime())
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
  const total = sortedProjects.length;
  const yMax = Math.max(25, Math.ceil(total / Y_STEP) * Y_STEP);
  const yTickValues: number[] = [];
  for (let t = 0; t <= yMax; t += Y_STEP) yTickValues.push(t);

  // --- turning points, all derived from the data (listed in the key, not floated over the plot) ---
  const firstProd = sortedProjects.find((p) => p.flags.includes('production'));
  const firstLive = sortedProjects.find((p) => p.url);
  const outcomes = [
    { title: 'First repo', p: sortedProjects[0] },
    { title: 'First live site', p: firstLive },
    { title: 'First in production', p: firstProd },
  ].filter((o): o is { title: string; p: (typeof sortedProjects)[number] } => !!o.p);
  outcomes.sort((a, b) => Date.parse(a.p.createdAt) - Date.parse(b.p.createdAt));

  // --- key: what the marks mean, plus the three outcomes ---
  const keyEl = h(
    'div',
    { class: 'tr-key', role: 'group', 'aria-label': 'Chart key and outcomes' },
    h(
      'p',
      { class: 'tr-key-row' },
      h('span', { class: 'tr-key-dot', 'aria-hidden': 'true' }),
      'One repo, coloured by category',
    ),
    h(
      'p',
      { class: 'tr-key-row' },
      h('span', { class: 'tr-key-ring', 'aria-hidden': 'true' }),
      'A role starts',
    ),
    h(
      'ul',
      { class: 'tr-key-list' },
      ...outcomes.map((o) => {
        const b = h(
          'button',
          { class: 'tr-key-out', type: 'button' },
          h('span', { class: 'tr-key-t' }, o.title),
          h('span', { class: 'tr-key-s' }, `${o.p.title}, ${fmtMonth(new Date(o.p.createdAt))}`),
        );
        b.style.setProperty('--c', `var(--cat-${o.p.category})`);
        b.addEventListener('click', () => openCard(o.p.repo));
        return h('li', {}, b);
      }),
    ),
  );
  el.append(keyEl, root);

  // --- svg skeleton ---
  const svgEl = svg('svg', { class: 'tr-svg', role: 'group' });
  svgEl.setAttribute(
    'aria-label',
    `Trajectory from ${DOMAIN_START.getUTCFullYear()} to ${data.asOf}: experience bands and the cumulative growth of public repos, one dot per repo. Dots open the project card.`,
  );
  root.append(svgEl);

  const defs = svg('defs');
  const grad = svg('linearGradient', { id: 'tr-grad', x1: 0, y1: 0, x2: 0, y2: 1 });
  const stopA = svg('stop', { offset: '0%' });
  stopA.style.stopColor = 'var(--accent)';
  stopA.style.stopOpacity = '0.38';
  const stopB = svg('stop', { offset: '100%' });
  stopB.style.stopColor = 'var(--accent)';
  stopB.style.stopOpacity = '0.02';
  grad.append(stopA, stopB);
  defs.append(grad);

  const laneG = svg('g', { class: 'tr-lane' });
  const gridG = svg('g', { class: 'tr-grid' });
  const axisG = svg('g', { class: 'tr-axis' });
  const areaG = svg('g', { class: 'tr-areag' });
  const lineG = svg('g', { class: 'tr-lineg' });
    const dotsG = svg('g', { class: 'tr-dots' });
  const crossG = svg('g', { class: 'tr-cross' });
  // The crosshair hit area sits under the line and the dots so their hover and
  // click handlers win; the hairline itself stays on top but ignores pointers.
  const crossRect = svg('rect', { class: 'tr-crossrect' });
  svgEl.append(defs, laneG, gridG, axisG, crossRect, areaG, lineG, dotsG, crossG);

  // quarterly ticks (text)
  const quarterDates: Date[] = [];
  for (let i = 0; ; i++) {
    const d = new Date(Date.UTC(DOMAIN_START.getUTCFullYear(), i * 3, 1));
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

  // bands and the dashed role-start rules that tie them to the plot
  const bands = rows.map((r) => {
    const rect = svg('rect', { class: r.current ? 'tr-band tr-band--current' : 'tr-band' });
    const label = svg('text', { class: 'tr-band-label' });
    label.textContent = shortOrg(r.exp.org);
    const rule = svg('line', { class: 'tr-rule' });
    laneG.append(rule, rect, label);
    return { ...r, rect, label, rule };
  });

  // cumulative series in pixels: starts at zero, one point per repo (x is nudged so dots never touch),
  // holds the last value up to the as-of day.
  type Pt = { x: number; y: number };
  let points: Pt[] = [];

  const areaEl = svg('path', { class: 'tr-area' });
  areaEl.setAttribute('fill', 'url(#tr-grad)');
  areaG.append(areaEl);
  const pathEl = svg('path', { class: 'tr-line', pathLength: 1 });
  lineG.append(pathEl);

  // "Today" tick on the axis: the end of the line, without a count.
  const todayTick = svg('line', { class: 'tr-today-tick' });
  const todayText = svg('text', { class: 'tr-tick tr-today' });
  todayText.textContent = 'Today';
  axisG.append(todayTick, todayText);

  // role starts: a mark on the line where each role begins
  const roleMarks = rows.map((r) => {
    const label = `${r.exp.role}, ${r.exp.org}, from ${fmtMonth(r.from)}`;
    const m = svg('circle', { class: 'tr-role-mark', r: 4, tabindex: 0, role: 'img', 'aria-label': label });
    const tip = `<strong>${escapeHtml(r.exp.role)}</strong><br><span class="mono">${escapeHtml(r.exp.org)}, ${fmtMonth(r.from)}</span>`;
    m.addEventListener('mouseenter', (e: MouseEvent) => showTip(tip, e.clientX, e.clientY));
    m.addEventListener('mousemove', (e: MouseEvent) => showTip(tip, e.clientX, e.clientY));
    m.addEventListener('mouseleave', () => hideTip());
    m.addEventListener('focus', () => {
      const b = m.getBoundingClientRect();
      showTip(tip, b.left + b.width / 2, b.top);
    });
    m.addEventListener('blur', () => hideTip());
    dotsG.append(m);
    return { m, from: r.from };
  });

  // dots
  const dotItems: { circle: SVGCircleElement; project: (typeof sortedProjects)[number]; count: number; x: number; y: number }[] = [];
  sortedProjects.forEach((p, i) => {
    const circle = svg('circle', { class: 'tr-dot', r: 5, tabindex: 0, role: 'button' });
    circle.style.fill = `var(--cat-${p.category})`;
    circle.style.setProperty('--i', String(i));
    circle.setAttribute('aria-label', `${p.title}, ${fmtMonth(new Date(p.createdAt))}. Open project card`);
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
    dotItems.push({ circle, project: p, count: i + 1, x: 0, y: 0 });
  });

  // crosshair
  const hairline = svg('line', { class: 'tr-hair' });
  crossG.append(hairline);

  let xScale = scaleTime().domain([DOMAIN_START, asOf]);
  let yScale = scaleLinear().domain([0, yMax]);
  const lineGen = line<Pt>().x((d) => d.x).y((d) => d.y).curve(curveStepAfter);
  const areaGen = area<Pt>().x((d) => d.x).y1((d) => d.y).curve(curveStepAfter);

  let played = false;
  const scrollDriven = supportsScrollTimeline && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mRight = 20;
  let resizeTimer: number | null = null;

  function layout(): void {
    const width = Math.floor(root.clientWidth);
    if (width < 120) return;
    const narrow = window.innerWidth < 640;
    // Room for the "Today" label under the end of the line.
    mRight = narrow ? 20 : 24;
    const laneTop = 2;
    // Labels sit inside their band when they fit. If any does not, every band
    // gets its own lane and the labels that do not fit go beside the band.
    xScale = scaleTime().domain([DOMAIN_START, asOf]).range([LEFT_M, width - mRight]);
    // Narrow: bands become thin brackets under the axis, labelled in staggered rows.
    bands.forEach((b) => {
      b.label.textContent = narrow ? (ORG_NARROW[b.exp.org] ?? b.exp.org) : shortOrg(b.exp.org);
    });
    const labelW = bands.map((b) => b.label.getComputedTextLength());
    const laneMode =
      !narrow && bands.some((b, i) => labelW[i] + 12 > Math.max(0, xScale(b.to) - xScale(b.from)));
    const nRows = narrow ? 0 : laneMode ? bands.length : rowCount;
    const rowH = laneMode ? LANE_ROW_H : ROW_H;
    const bandH = laneMode ? LANE_BAND_H : BAND_H;
    const r = narrow ? DOT_R_NARROW : DOT_R;
    const minD = 2 * r + DOT_GAP;
    const laneH = narrow ? 0 : laneTop + nRows * rowH + 4;
    const laneGap = narrow ? 8 : 14;
    // Narrow: room under the axis for the bracket row and one label row.
    const bottomM = narrow ? BOTTOM_M + 20 + 15 : BOTTOM_M;
    // The card is stretched to the height of the experience list next to it;
    // the plot takes whatever the card has left, within sane bounds.
    const avail = root.clientHeight - laneH - laneGap - bottomM;
    // Tall enough that consecutive repos are about one dot apart vertically, so dots barely need to slide.
    const dotsH = Math.ceil(yMax * minD * 0.95);
    const plotH = Math.max(narrow ? PLOT_H_MOBILE : PLOT_MIN, dotsH, narrow ? 0 : Math.min(PLOT_MAX, avail));
    const totalH = laneH + laneGap + plotH + bottomM;
    const plotTop = laneH + laneGap;
    const plotBottom = totalH - bottomM;

    yScale = scaleLinear().domain([0, yMax]).range([plotBottom, plotTop]);

    // Beeswarm along x: repos created close together would overlap, so each dot slides right just far
    // enough to keep DOT_GAP px between dots; if the tail would then pass "today", a backward pass
    // slides it left instead. The line runs through the moved dots.
    const right = width - mRight;
    const xs: number[] = [];
    const need = (i: number, j: number): number => {
      const dy = yScale(j + 1) - yScale(i + 1);
      return dy >= minD ? 0 : Math.sqrt(minD * minD - dy * dy);
    };
    sortedProjects.forEach((p, i) => {
      let x = Math.max(xScale(new Date(p.createdAt)), i ? xs[i - 1] : LEFT_M);
      for (let j = i - 1; j >= 0 && yScale(j + 1) - yScale(i + 1) < minD; j--) x = Math.max(x, xs[j] + need(i, j));
      xs.push(x);
    });
    xs[xs.length - 1] = Math.min(xs[xs.length - 1], right);
    for (let i = xs.length - 2; i >= 0; i--) {
      let x = xs[i];
      for (let j = i + 1; j < xs.length && yScale(i + 1) - yScale(j + 1) < minD; j++) x = Math.min(x, xs[j] - need(j, i));
      xs[i] = x;
    }
    xScale = scaleTime().domain([DOMAIN_START, asOf]).range([LEFT_M, right]);
    points = [{ x: xScale(DOMAIN_START), y: yScale(0) }];
    sortedProjects.forEach((_, i) => points.push({ x: xs[i], y: yScale(i + 1) }));
    points.push({ x: Math.max(right, xs[xs.length - 1]), y: yScale(total) });
    const levelAt = (x: number): number => {
      let y = points[0].y;
      for (const pt of points) if (pt.x <= x) y = pt.y;
      return y;
    };
    // Path length along the line, as a 0..1 share of the whole: where each dot sits (top of its riser)
    // and where a given x is reached (for the role marks). Used to time the scroll-driven draw.
    const runStart: number[] = [0];
    const riserEnd: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      runStart.push(riserEnd[i - 1]);
      riserEnd.push(riserEnd[i - 1] + (points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y));
    }
    const lineLen = riserEnd[riserEnd.length - 1] || 1;
    const dotShare = (k: number): number => riserEnd[k + 1] / lineLen;
    const xShare = (x: number): number => {
      for (let i = 1; i < points.length; i++) {
        if (x <= points[i].x) return Math.min(1, (runStart[i] + Math.max(0, x - points[i - 1].x)) / lineLen);
      }
      return 1;
    };
    const rangeOf = (share: number, span: number): [string, string] => {
      const a = DRAW_FROM + (DRAW_TO - DRAW_FROM) * share;
      return [`${a.toFixed(2)}%`, `${Math.min(100, a + span).toFixed(2)}%`];
    };

    svgEl.setAttribute('width', String(width));
    svgEl.setAttribute('height', String(totalH));
    svgEl.setAttribute('viewBox', `0 0 ${width} ${totalH}`);
    // Narrow: the stacked card has no neighbour to stretch to, so the chart sets its own height.
    root.style.height = narrow ? `${totalH}px` : '';

    // Narrow: one row of labels, so none ever wraps below another. Each label starts at its bracket;
    // a forward pass pushes it right until it clears its neighbour, a backward pass pulls the tail back inside.
    const GAP = 8;
    const order = bands.map((_, i) => i).sort((p, q) => xScale(bands[p].from) - xScale(bands[q].from));
    const lx0: number[] = [];
    let cursor = LEFT_M - 4;
    for (const i of order) {
      lx0[i] = Math.max(xScale(bands[i].from), cursor);
      cursor = lx0[i] + labelW[i] + GAP;
    }
    let limit = width - 2;
    for (const i of [...order].reverse()) {
      lx0[i] = Math.min(lx0[i], limit - labelW[i]);
      limit = lx0[i] - GAP;
    }
    const narrowPos = bands.map((_, i) => ({ x: lx0[i] }));

    // bands
    bands.forEach((b, i) => {
      if (narrow) {
        const x1 = xScale(b.from);
        const bw = Math.max(0, xScale(b.to) - x1);
        const by = plotBottom + 32;
        b.rect.setAttribute('x', String(x1));
        b.rect.setAttribute('y', String(by));
        b.rect.setAttribute('width', String(Math.max(0, bw - 1)));
        b.rect.setAttribute('height', '6');
        b.rect.setAttribute('class', `tr-band tr-band--bracket${b.current ? ' tr-band--current' : ''}`);
        b.rule.style.display = 'none';
        b.label.setAttribute('x', String(narrowPos[i].x));
        b.label.setAttribute('y', String(by + 22));
        b.label.setAttribute('text-anchor', 'start');
        b.label.setAttribute('class', `tr-band-label tr-band-label--narrow${b.current ? ' tr-band-label--current' : ''}`);
        return;
      }
      b.rule.style.display = '';
      b.rect.setAttribute('class', b.current ? 'tr-band tr-band--current' : 'tr-band');
      const x1 = xScale(b.from);
      const bw = Math.max(0, xScale(b.to) - x1);
      const lane = laneMode ? i : b.row;
      const by = laneTop + lane * rowH + (rowH - bandH) / 2;
      b.rect.setAttribute('x', String(x1));
      b.rect.setAttribute('y', String(by));
      b.rect.setAttribute('width', String(bw));
      b.rect.setAttribute('height', String(bandH));
      b.rule.setAttribute('x1', String(x1));
      b.rule.setAttribute('x2', String(x1));
      b.rule.setAttribute('y1', String(by + bandH));
      b.rule.setAttribute('y2', String(Math.max(by + bandH, levelAt(x1) - 5)));
      // Rules would cross the other lanes' labels in lane mode.
      b.rule.style.display = laneMode ? 'none' : '';

      const inside = labelW[i] + 12 <= bw;
      let lx = x1 + bw / 2;
      let anchor = 'middle';
      if (!inside) {
        if (x1 - labelW[i] - 8 >= LEFT_M - 4) {
          lx = x1 - 6;
          anchor = 'end';
        } else {
          lx = x1 + bw + 6;
          anchor = 'start';
        }
      }
      b.label.setAttribute('x', String(lx));
      b.label.setAttribute('y', String(by + bandH / 2 + 4.5));
      b.label.setAttribute('text-anchor', anchor);
      b.label.setAttribute(
        'class',
        `tr-band-label${b.current ? ' tr-band-label--current' : ''}${inside ? '' : ' tr-band-label--outside'}`,
      );
    });

    // y ticks
    yTickValues.forEach((t, i) => {
      const py = yScale(t);
      yGridLines[i].setAttribute('x1', String(LEFT_M));
      yGridLines[i].setAttribute('x2', String(width - mRight));
      yGridLines[i].setAttribute('y1', String(py));
      yGridLines[i].setAttribute('y2', String(py));
      yTickTexts[i].setAttribute('x', String(LEFT_M - 8));
      yTickTexts[i].setAttribute('y', String(py + 4));
      yTickTexts[i].setAttribute('text-anchor', 'end');
    });

    // "Today" tick at the end of the line, then the quarterly ticks (half-yearly on mobile so the
    // labels stay legible); a quarter tick that would touch "Today" is dropped.
    const endX = points[points.length - 1].x;
    todayTick.setAttribute('x1', String(endX));
    todayTick.setAttribute('x2', String(endX));
    todayTick.setAttribute('y1', String(plotBottom));
    todayTick.setAttribute('y2', String(plotBottom + 6));
    todayText.setAttribute('x', String(endX));
    todayText.setAttribute('y', String(plotBottom + BOTTOM_M - 8));
    todayText.setAttribute('text-anchor', 'middle');
    const todayBox = todayText.getBBox();
    for (const qt of quarterTexts) {
      const hide = narrow && qt.d.getUTCMonth() % 6 !== 0;
      qt.el.style.display = hide ? 'none' : '';
      qt.el.setAttribute('x', String(xScale(qt.d)));
      qt.el.setAttribute('y', String(plotBottom + BOTTOM_M - 8));
      qt.el.setAttribute('text-anchor', 'middle');
      if (!hide) {
        const q = qt.el.getBBox();
        if (q.x + q.width + 6 > todayBox.x && q.x < todayBox.x + todayBox.width + 6) qt.el.style.display = 'none';
      }
    }

    // area and line (the line is normalised with pathLength, so no length bookkeeping is needed)
    areaGen.y0(plotBottom);
    areaEl.setAttribute('d', areaGen(points) ?? '');
    pathEl.setAttribute('d', lineGen(points) ?? '');
    if (!played && !scrollDriven) {
      pathEl.style.strokeDasharray = '1';
      pathEl.style.strokeDashoffset = '1';
    }

    // dots, at their nudged positions
    dotItems.forEach((di, k) => {
      di.x = xs[k];
      di.y = yScale(di.count);
      di.circle.setAttribute('cx', String(di.x));
      di.circle.setAttribute('cy', String(di.y));
      di.circle.setAttribute('r', String(r));
      const [from, to] = rangeOf(dotShare(k), 4);
      di.circle.style.setProperty('--ps', from);
      di.circle.style.setProperty('--pe', to);
    });
    roleMarks.forEach((rm) => {
      const x = xScale(rm.from);
      rm.m.setAttribute('cx', String(x));
      rm.m.setAttribute('cy', String(levelAt(x)));
    });

    keyEl.style.top = narrow ? '' : `${root.offsetTop + plotTop + 6}px`;
    keyEl.style.left = narrow ? '' : `${root.offsetLeft + LEFT_M + 12}px`;
    const [lineA, lineB] = [`${DRAW_FROM}%`, `${DRAW_TO}%`];
    root.style.setProperty('--tr-a', lineA);
    root.style.setProperty('--tr-b', lineB);
    root.style.setProperty('--tr-area', `${DRAW_TO - 6}%`);
    roleMarks.forEach((rm) => {
      const [from, to] = rangeOf(xShare(xScale(rm.from)), 4);
      rm.m.style.setProperty('--ps', from);
      rm.m.style.setProperty('--pe', to);
    });

    // crosshair hit area
    crossRect.setAttribute('x', String(LEFT_M));
    crossRect.setAttribute('y', String(plotTop));
    crossRect.setAttribute('width', String(width - mRight - LEFT_M));
    crossRect.setAttribute('height', String(plotBottom - plotTop));
    crossRect.setAttribute('fill', 'transparent');
    crossRect.setAttribute('pointer-events', 'all');

    hairline.setAttribute('x1', String(LEFT_M));
    hairline.setAttribute('x2', String(LEFT_M));
    hairline.setAttribute('y1', String(plotTop));
    hairline.setAttribute('y2', String(plotBottom));
    hairline.style.opacity = '0';
  }

  // crosshair interactions
  function onMove(e: PointerEvent) {
    const svgRect = svgEl.getBoundingClientRect();
    const px = e.clientX - svgRect.left;
    const width = Math.floor(root.clientWidth);
    const clamped = Math.max(LEFT_M, Math.min(width - mRight, px));
    const date = xScale.invert(clamped);
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
    const html = `<span class="mono">${fmtMonth(date)}</span><br><strong>${escapeHtml(nearest.title)}</strong>`;
    showTip(html, e.clientX, e.clientY);
  }
  function onLeave() {
    hairline.style.opacity = '0';
    hideTip();
  }
  crossRect.addEventListener('pointermove', onMove);
  crossRect.addEventListener('pointerleave', onLeave);

  layout();
  // Label widths depend on the web fonts.
  void document.fonts?.ready.then(layout);

  // Motion. With scroll-driven animations the CSS draws the line and pops the dots as the card scrolls
  // through the viewport (ranges set per element in layout). Without them: the same sequence, played once
  // when the card becomes visible. Reduced motion: everything is simply there.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    played = true;
    root.classList.add('is-draw', 'is-area', 'is-in');
    pathEl.style.strokeDasharray = '';
    pathEl.style.strokeDashoffset = '0';
  } else if (scrollDriven) {
    root.classList.add('tr--sd', 'is-in', 'is-area');
  } else {
    onVisible(root, () => {
      void pathEl.getBoundingClientRect();
      requestAnimationFrame(() => {
        pathEl.style.transition = 'stroke-dashoffset 1100ms cubic-bezier(0.2,0.8,0.3,1)';
        pathEl.style.strokeDashoffset = '0';
        root.classList.add('is-draw');
      });
      window.setTimeout(() => root.classList.add('is-area'), 900);
      window.setTimeout(() => {
        played = true;
        root.classList.add('is-in');
        pathEl.style.strokeDasharray = '';
      }, 1500);
    });
  }

  const ro = new ResizeObserver(() => {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(layout, 150);
  });
  ro.observe(root);
}
