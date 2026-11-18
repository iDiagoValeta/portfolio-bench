import '../styles/leaderboard.css';

import { utcFormat } from 'd3-time-format';
import { scalePow } from 'd3-scale';
import type { CategoryId, Checks, Dataset, Project } from '../types';
import type { Profile } from '../types-profile';
import { h, onVisible } from '../lib/dom';
import { showTip, hideTip } from '../lib/tooltip';
import { asOfDate } from '../lib/format';
import { openCard, TONES } from './card';

type CatFilter = 'all' | CategoryId;
type Metric = 'index' | 'depth' | 'craft' | 'recency' | 'shipped';

const METRICS: { id: Metric; label: string }[] = [
  { id: 'index', label: 'Index' },
  { id: 'depth', label: 'Depth' },
  { id: 'craft', label: 'Craft' },
  { id: 'recency', label: 'Recency' },
  { id: 'shipped', label: 'Shipped' },
];

// The six hygiene checks that make up craft, for the count in the row's accessible name.
const CHECKS: { id: keyof Checks; label: string }[] = [
  { id: 'readme', label: 'README over 1,500 characters' },
  { id: 'license', label: 'License' },
  { id: 'ci', label: 'CI workflow' },
  { id: 'tests', label: 'Tests' },
  { id: 'description', label: 'Description' },
  { id: 'topics', label: 'Three or more topics' },
];

const TOP = 10;
const WEEK_MS = 7 * 86_400_000;
const fmtDay = utcFormat('%b %-d, %Y');


function pct(v: number): number {
  return Math.round(v * 100);
}

// The four parts of the index, in the order the bar stacks them.
const PARTS = ['depth', 'craft', 'recency', 'shipped'] as const;
const PART_LABEL: Record<(typeof PARTS)[number], string> = { depth: 'Depth', craft: 'Craft', recency: 'Recency', shipped: 'Shipped' };

const trimNum = (n: number): string => String(Math.round(n * 10) / 10);

function legend(cls: string): HTMLElement {
  const wrap = h('div', { class: `lb-legend ${cls}`, 'aria-hidden': 'true' });
  PARTS.forEach((k, i) => {
    wrap.append(h('span', { class: 'lb-key' }, h('i', { style: `--t:${TONES[i]}%` }), PART_LABEL[k]));
  });
  return wrap;
}

function shippedKind(p: Project): 'prod' | 'live' | 'release' | null {
  if (p.shipped >= 1) return 'prod';
  if (p.shipped > 0) return p.url ? 'live' : 'release';
  return null;
}

const SHIPPED_LABEL = { prod: 'Production', live: 'Live', release: 'Release' } as const;

export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  void profile;
  let metric: Metric = 'index';
  let expanded = false;
  let visible = false;
  let filter: CatFilter = 'all';

  const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const catLabel = (id: string): string => data.categories.find((c) => c.id === id)?.label ?? id;

  // GitHub weeks start on Sunday and the last one contains asOf. Index 0 is the oldest.
  const weeks = data.projects[0]?.weekly.length ?? 52;
  const end = asOfDate(data.asOf);
  const lastStart = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - end.getUTCDay() * 86_400_000;
  const weekStart = (i: number): Date => new Date(lastStart - (weeks - 1 - i) * WEEK_MS);

  const root = h('div', { class: 'lb' });
  el.append(root);

  // Toolbar: metric tabs and category chips
  const tabsWrap = h('div', { class: 'lb-tabs', role: 'group', 'aria-label': 'Rank by' });
  const chipsWrap = h('div', { class: 'lb-chips', role: 'group', 'aria-label': 'Filter by category' });
  root.append(h('div', { class: 'lb-toolbar' }, tabsWrap, chipsWrap));

  const setMetric = (m: Metric): void => {
    if (m === metric) return;
    metric = m;
    update();
  };

  const tabEls = new Map<Metric, HTMLElement>();
  for (const m of METRICS) {
    const btn = h('button', { class: 'tab', type: 'button', 'aria-pressed': 'false' }, m.label);
    btn.addEventListener('click', () => setMetric(m.id));
    tabEls.set(m.id, btn);
    tabsWrap.append(btn);
  }

  const chipEls = new Map<CatFilter, HTMLElement>();
  const addChip = (id: CatFilter, label: string, color?: string): void => {
    const chip = h('button', { class: 'lb-chip', type: 'button', 'aria-pressed': 'false' });
    if (color) chip.append(h('span', { class: 'sq', style: `background:${color}`, 'aria-hidden': 'true' }));
    chip.append(label);
    chip.addEventListener('click', () => {
      if (filter === id) return;
      filter = id;
      update();
    });
    chipEls.set(id, chip);
    chipsWrap.append(chip);
  };
  addChip('all', 'All');
  for (const c of data.categories) addChip(c.id, c.label, `var(--cat-${c.id})`);

  // Header row: the sortable metrics are buttons, in sync with the tabs.
  const headBtns = new Map<string, HTMLButtonElement>();
  const headCells = new Map<string, HTMLElement>();
  const sortHead = (key: string, label: string, onClick: () => void, cls: string): HTMLElement => {
    const btn = h('button', { class: 'lb-sort', type: 'button' }, h('span', null, label), h('i', { class: 'lb-caret', 'aria-hidden': 'true' }));
    btn.addEventListener('click', onClick);
    headBtns.set(key, btn);
    const cell = h('div', { class: `lb-h ${cls}`, role: 'columnheader', 'aria-sort': 'none' }, btn);
    headCells.set(key, cell);
    return cell;
  };
  const plainHead = (label: string, cls: string, sr = false): HTMLElement =>
    h('div', { class: `lb-h ${cls}`, role: 'columnheader' }, h('span', { class: sr ? 'lb-sr' : '' }, label));

  const head = h('div', { class: 'lb-head', role: 'row' },
    plainHead('#', 'lb-c-rank'),
    plainHead('Project', 'lb-c-proj'),
    sortHead('shipped', 'Shipped', () => setMetric('shipped'), 'lb-c-ship'),
    plainHead('Last 52 weeks', 'lb-c-strip'),
    sortHead('value', 'Index', () => setMetric('index'), 'lb-c-val'),
  );
  headCells.get('value')!.append(legend('lb-legend-head'));
  const rowsWrap = h('div', { class: 'lb-rows', role: 'rowgroup' });
  const compactLegend = legend('lb-legend-compact');
  root.append(
    compactLegend,
    h('div', { class: 'lb-table', role: 'table', 'aria-label': 'Ranking of public repositories' }, h('div', { role: 'rowgroup' }, head), rowsWrap),
  );

  const showAllBtn = h('button', { class: 'lb-showall', type: 'button', 'aria-expanded': 'false' });
  showAllBtn.addEventListener('click', () => {
    expanded = !expanded;
    update();
  });
  root.append(h('div', { class: 'lb-foot' }, showAllBtn, h('a', { class: 'lb-note', href: '#methodology' }, 'How the index is computed')));

  const rowEls = new Map<string, HTMLElement>();

  function buildStrip(p: Project): HTMLElement {
    const max = Math.max(...p.weekly);
    const alpha = scalePow().exponent(0.5).domain([1, Math.max(max, 2)]).range([0.18, 1]).clamp(true);
    const strip = h('div', { class: 'lb-strip', 'aria-hidden': 'true' });
    p.weekly.forEach((v, i) => {
      strip.append(h('i', {
        class: v > 0 ? 'lb-cell' : 'lb-cell zero',
        'data-w': i,
        style: v > 0 ? `--a:${(alpha(v) * 100).toFixed(1)}%` : null,
      }));
    });
    strip.addEventListener('mousemove', (e) => {
      const cell = (e.target as Element).closest<HTMLElement>('.lb-cell');
      if (!cell) { hideTip(); return; }
      const i = Number(cell.dataset.w);
      // The owner does not want volatile counts on the page: the strip shows when work happened, not how much.
      showTip(`Week of ${fmtDay(weekStart(i))}: <strong>${(p.weekly[i] ?? 0) > 0 ? 'active' : 'quiet'}</strong>`, e.clientX, e.clientY);
    });
    strip.addEventListener('mouseleave', hideTip);
    return strip;
  }

  function buildShipped(p: Project): HTMLElement {
    const k = shippedKind(p);
    const cell = h('div', { class: 'lb-c lb-c-ship', role: 'cell' });
    if (k) cell.append(h('span', { class: `lb-badge lb-b-${k}` }, h('i', { 'aria-hidden': 'true' }), SHIPPED_LABEL[k]));
    return cell;
  }

  // Segment length is the part's weight times its score, so the whole bar is the index out of 100.
  function buildBar(p: Project): HTMLElement {
    const track = h('div', { class: 'lb-track', 'aria-hidden': 'true' });
    PARTS.forEach((k, i) => {
      const pts = data.weights[k] * p[k] * 100;
      if (pts <= 0) return;
      const seg = h('i', { class: 'lb-seg', 'data-k': k, style: `--w:${pts.toFixed(2)};--i:${i};--t:${TONES[i]}%` });
      const tip = `<strong>${PART_LABEL[k]}</strong>: ${trimNum(pts)} points of ${trimNum(data.weights[k] * 100)}`;
      seg.addEventListener('mousemove', (e) => showTip(tip, e.clientX, e.clientY));
      seg.addEventListener('mouseleave', hideTip);
      track.append(seg);
    });
    return track;
  }

  function buildRow(p: Project): HTMLElement {
    const passed = CHECKS.filter((c) => p.checks[c.id]).length;
    const k = shippedKind(p);
    const row = h('div', { class: 'lb-row', role: 'row', tabindex: '0', 'data-repo': p.repo, style: `--c:var(--cat-${p.category})` },
      h('div', { class: 'lb-c lb-c-rank', role: 'cell' }),
      h('div', { class: 'lb-c lb-c-proj', role: 'cell' },
        h('span', { class: 'lb-title' }, p.title),
        h('span', { class: 'lb-desc' }, p.oneLiner),
      ),
      h('div', { class: 'lb-meta' },
        buildShipped(p),
        h('div', { class: 'lb-c lb-c-strip', role: 'cell' }, buildStrip(p)),
      ),
      h('div', { class: 'lb-c lb-c-val', role: 'cell' },
        buildBar(p),
        h('span', { class: 'lb-value' }, String(p.index)),
      ),
    );
    row.setAttribute(
      'aria-label',
      `${p.title}, ${catLabel(p.category)}. ${k ? SHIPPED_LABEL[k] + '. ' : ''}Index ${p.index}, depth ${pct(p.depth)}, craft ${passed} of ${CHECKS.length} checks, recency ${pct(p.recency)}. Open project card`,
    );
    row.addEventListener('click', () => {
      hideTip();
      openCard(p.repo);
    });
    row.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.target !== row) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        hideTip();
        openCard(p.repo);
      }
    });
    rowEls.set(p.repo, row);
    return row;
  }

  // Rows move with transforms (FLIP), so every pixel they paint stays inside the clipped table.
  const flips = new WeakMap<HTMLElement, Animation>();
  const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

  function update(): void {
    render(visible);
  }

  // A row that leaves fades out where it stood, taken out of the flow so the others can move at once.
  function leave(row: HTMLElement, top: number): void {
    flips.get(row)?.cancel();
    if (reduced()) { row.remove(); return; }
    row.classList.remove('lb-in');
    row.classList.add('lb-out');
    row.style.top = `${top}px`;
    row.setAttribute('aria-hidden', 'true');
    row.tabIndex = -1;
    row.addEventListener('animationend', () => { if (row.classList.contains('lb-out')) row.remove(); }, { once: true });
  }

  function render(flip: boolean): void {
    const sorted = data.projects
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => filter === 'all' || p.category === filter)
      .sort((a, b) => b.p[metric] - a.p[metric] || b.p.index - a.p.index || a.idx - b.idx);
    const list = (expanded ? sorted : sorted.slice(0, TOP)).map((s) => s.p);
    const keep = new Set(list.map((p) => p.repo));
    root.dataset.metric = metric;

    const animate = flip && !reduced();
    const wrapTop = rowsWrap.getBoundingClientRect().top;
    const oldHeight = rowsWrap.getBoundingClientRect().height;

    // FLIP: remember where every row that stays was before reordering (mid-flight positions included).
    const first = new Map<string, number>();
    rowEls.forEach((row, repo) => {
      if (row.isConnected && !row.classList.contains('lb-out')) first.set(repo, row.getBoundingClientRect().top);
    });
    let rowsLeaving = false;
    if (animate) {
      rowEls.forEach((row) => { flips.get(row)?.cancel(); });
      rowEls.forEach((row, repo) => {
        if (!keep.has(repo) && first.has(repo)) { leave(row, first.get(repo)! - wrapTop); rowsLeaving = true; }
      });
    } else {
      rowEls.forEach((row, repo) => { if (!keep.has(repo) && row.isConnected) row.remove(); });
    }

    // Entering rows wait for the leaving ones to fade, so old and new text never share a place.
    const wait = animate && rowsLeaving ? 90 : 0;
    let ref: Element | null = rowsWrap.firstElementChild;
    list.forEach((p, i) => {
      let row = rowEls.get(p.repo);
      const fresh = !row || !row.isConnected || row.classList.contains('lb-out');
      if (!row) row = buildRow(p);
      if (row.classList.contains('lb-out')) {
        row.classList.remove('lb-out');
        row.style.top = '';
        row.removeAttribute('aria-hidden');
        row.tabIndex = 0;
      }
      row.style.setProperty('--k', visible ? '1' : '0');
      row.querySelector('.lb-c-rank')!.textContent = String(i + 1).padStart(2, '0');
      // The value column shows the metric the table is ranked by (0..100); the bar keeps showing the index.
      row.querySelector('.lb-value')!.textContent = String(metric === 'index' ? p.index : pct(p[metric]));
      // Only move a row that is out of place: re-appending a row would blur it.
      while (ref && ref.classList.contains('lb-out')) ref = ref.nextElementSibling;
      if (ref === row) ref = row.nextElementSibling;
      else rowsWrap.insertBefore(row, ref);
      if (animate && fresh && visible) {
        row.classList.add('lb-in');
        row.style.animationDelay = `${wait + Math.min(i, 8) * 25}ms`;
        row.addEventListener('animationend', () => { row!.classList.remove('lb-in'); row!.style.animationDelay = ''; }, { once: true });
      }
    });

    if (animate) {
      list.forEach((p) => {
        const row = rowEls.get(p.repo)!;
        const was = first.get(p.repo);
        if (was == null) return;
        const dy = was - row.getBoundingClientRect().top;
        if (Math.abs(dy) < 0.5) return;
        // The row that travels furthest sits on top and is opaque, so two rows never show text through each other.
        row.style.zIndex = String(1 + Math.round(Math.abs(dy)));
        row.classList.add('lb-mv');
        const a = row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 480, easing: EASE, delay: wait, fill: 'backwards' });
        flips.set(row, a);
        // A cancelled older animation reports late, so only the row's current one may clear the mover state.
        const done = (): void => { if (flips.get(row) !== a) return; row.classList.remove('lb-mv'); row.style.zIndex = ''; };
        a.addEventListener('finish', done);
        a.addEventListener('cancel', done);
      });
      // The table grows or shrinks with the rows, not before them.
      const newHeight = rowsWrap.getBoundingClientRect().height;
      if (Math.abs(newHeight - oldHeight) > 0.5) {
        rowsWrap.animate([{ height: `${oldHeight}px` }, { height: `${newHeight}px` }], { duration: 480, easing: EASE, delay: wait, fill: 'backwards' });
      }
    }

    tabEls.forEach((btn, id) => btn.setAttribute('aria-pressed', String(id === metric)));
    chipEls.forEach((chip, id) => chip.setAttribute('aria-pressed', String(id === filter)));

    // aria-sort marks the ranking column.
    headCells.get('shipped')!.setAttribute('aria-sort', metric === 'shipped' ? 'descending' : 'none');
    headCells.get('value')!.setAttribute('aria-sort', metric === 'shipped' ? 'none' : 'descending');
    headBtns.get('value')!.firstElementChild!.textContent = METRICS.find((m) => m.id === metric)!.label;

    if (sorted.length <= TOP) {
      showAllBtn.hidden = true;
    } else {
      showAllBtn.hidden = false;
      showAllBtn.textContent = expanded ? `Show top ${TOP}` : 'Show all';
      showAllBtn.setAttribute('aria-expanded', String(expanded));
    }
  }

  render(false);
  onVisible(root, () => {
    visible = true;
    render(false);
  });
}
