import '../styles/leaderboard.css';

import type { Dataset, Project } from '../types';
import type { Profile } from '../types-profile';
import { h, onVisible } from '../lib/dom';
import { formatCompact, niceTicks } from '../lib/format';
import { showTip, hideTip } from '../lib/tooltip';
import { openCard } from './card';

type Metric = 'index' | 'commits' | 'stars' | 'craft';
type CatFilter = 'all' | 'llm' | 'agents' | 'ml';

const METRICS: { id: Metric; label: string }[] = [
  { id: 'index', label: 'Index' },
  { id: 'commits', label: 'Commits' },
  { id: 'stars', label: 'Stars' },
  { id: 'craft', label: 'Craft' },
];

let metric: Metric = 'index';
let catFilter: CatFilter = 'all';
let expanded = false;
let visible = false;

function catVar(cat: string): string {
  return `var(--cat-${cat})`;
}

function catLabel(data: Dataset, id: string): string {
  return data.categories.find((c) => c.id === id)?.label ?? id;
}

function metricValue(p: Project, m: Metric): number {
  if (m === 'index') return p.index;
  if (m === 'commits') return p.commits;
  if (m === 'stars') return p.stars;
  return Math.round(p.craft * 100);
}

function formatValue(p: Project, m: Metric): string {
  if (m === 'index') return String(p.index);
  if (m === 'craft') return String(Math.round(p.craft * 100));
  if (m === 'commits') return formatCompact(p.commits);
  return formatCompact(p.stars);
}

export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  void profile;
  const root = h('div', { class: 'lb' });
  el.append(root);

  // toolbar
  const tabsWrap = h('div', { class: 'lb-tabs' });
  const chipsWrap = h('div', { class: 'lb-chips' });
  const toolbar = h('div', { class: 'lb-toolbar' }, tabsWrap, chipsWrap);
  root.append(toolbar);

  for (const m of METRICS) {
    const btn = h('button', { class: 'tab', type: 'button', 'aria-pressed': 'false' }, m.label);
    btn.addEventListener('click', () => {
      metric = m.id;
      updateToolbar();
      render();
    });
    tabsWrap.append(btn);
  }

  const allChip = h('button', { class: 'lb-chip', type: 'button', 'aria-pressed': 'true' }, 'All');
  const chipEls: Record<string, HTMLElement> = { all: allChip };
  allChip.addEventListener('click', () => {
    catFilter = 'all';
    updateToolbar();
    render();
  });
  chipsWrap.append(allChip);

  for (const c of data.categories) {
    const chip = h('button', { class: 'lb-chip', type: 'button', 'aria-pressed': 'false' });
    const sq = h('span', { class: 'sq', style: `background:${catVar(c.id)}` });
    chip.append(sq, document.createTextNode(c.label));
    chipEls[c.id] = chip;
    chip.addEventListener('click', () => {
      catFilter = c.id as CatFilter;
      updateToolbar();
      render();
    });
    chipsWrap.append(chip);
  }

  function updateToolbar(): void {
    tabsWrap.querySelectorAll<HTMLButtonElement>('button').forEach((btn, i) => {
      const m = METRICS[i];
      btn.setAttribute('aria-pressed', String(m.id === metric));
    });
    (Object.keys(chipEls) as string[]).forEach((key) => {
      const chip = chipEls[key];
      const active = key === 'all' ? catFilter === 'all' : catFilter === key;
      chip.setAttribute('aria-pressed', String(active));
    });
  }

  // chart
  const chart = h('div', { class: 'lb-chart' });
  const tickLabels = h('div', { class: 'lb-tick-labels' });
  const gridlines = h('div', { class: 'lb-gridlines' });
  const rowsWrap = h('div', { class: 'lb-rows' });
  chart.append(tickLabels, gridlines, rowsWrap);
  root.append(chart);

  const foot = h('div', { class: 'lb-foot' });
  const showAllBtn = h('button', { class: 'lb-showall', type: 'button' }, 'Show all');
  showAllBtn.addEventListener('click', () => {
    expanded = !expanded;
    render();
  });
  foot.append(showAllBtn);
  root.append(foot);

  const note = h('p', { class: 'lb-note mono' });
  const noteLink = h('a', { href: '#methodology' }, 'see methodology');
  note.append(document.createTextNode('Index = 50% craft + 25% reach + 25% recency · '), noteLink);
  root.append(note);

  const rowEls = new Map<string, HTMLElement>();

  function sortedProjects(): { p: Project; idx: number }[] {
    const indexed = data.projects.map((p, idx) => ({ p, idx }));
    const filtered = indexed.filter(({ p }) => catFilter === 'all' || p.category === catFilter);
    return [...filtered].sort((a, b) => {
      const va = metricValue(a.p, metric);
      const vb = metricValue(b.p, metric);
      if (vb !== va) return vb - va;
      return a.idx - b.idx;
    });
  }

  function updateGrid(maxVal: number): void {
    tickLabels.innerHTML = '';
    gridlines.innerHTML = '';
    const ticks = niceTicks(0, maxVal, 4);
    for (const t of ticks) {
      const pct = maxVal > 0 ? (t / maxVal) * 100 : 0;
      const lab = h('span', { class: 'lb-tick-label' });
      lab.style.left = `${pct}%`;
      lab.textContent = formatCompact(t);
      tickLabels.append(lab);

      const line = h('span', { class: 'lb-grid-line' });
      line.style.left = `${pct}%`;
      gridlines.append(line);
    }
  }

  function buildRow(p: Project): HTMLElement {
    const row = h('div', { class: 'lb-row', tabindex: '0', role: 'button' });
    const title = h('div', { class: 'lb-title' }, p.title);
    const track = h('div', { class: 'lb-track' });
    const bar = h('div', { class: 'lb-bar' });
    bar.style.background = catVar(p.category);
    const value = h('span', { class: 'lb-value' });
    track.append(bar, value);
    row.append(title, track);

    row.addEventListener('mouseenter', (e: MouseEvent) => {
      const html = `<strong>${escapeHtml(p.title)}</strong><br>${escapeHtml(catLabel(data, p.category))}<br>Index ${p.index} · Commits ${formatCompact(p.commits)} · Stars ${formatCompact(p.stars)} · Craft ${Math.round(p.craft * 100)}`;
      showTip(html, e.clientX, e.clientY);
    });
    row.addEventListener('mousemove', (e: MouseEvent) => {
      const html = `<strong>${escapeHtml(p.title)}</strong><br>${escapeHtml(catLabel(data, p.category))}<br>Index ${p.index} · Commits ${formatCompact(p.commits)} · Stars ${formatCompact(p.stars)} · Craft ${Math.round(p.craft * 100)}`;
      showTip(html, e.clientX, e.clientY);
    });
    row.addEventListener('mouseleave', () => hideTip());
    row.addEventListener('click', () => openCard(p.repo));
    row.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCard(p.repo);
      }
    });

    rowEls.set(p.repo, row);
    return row;
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function updateRow(row: HTMLElement, p: Project, maxVal: number): void {
    const bar = row.querySelector<HTMLElement>('.lb-bar')!;
    const value = row.querySelector<HTMLElement>('.lb-value')!;
    const title = row.querySelector<HTMLElement>('.lb-title')!;
    title.textContent = p.title;
    bar.style.background = catVar(p.category);
    const v = metricValue(p, metric);
    const pct = maxVal > 0 ? (v / maxVal) * 100 : 0;
    bar.style.width = visible ? `${pct}%` : '0%';
    (row as HTMLElement & { _pct?: number })._pct = pct;
    value.textContent = formatValue(p, metric);
  }

  function render(): void {
    const sorted = sortedProjects();
    // Index and craft are absolute 0..100 scores; counts scale to the whole dataset so a
    // category filter never stretches the bars and makes small projects look big.
    const maxVal = metric === 'index' || metric === 'craft'
      ? 100
      : Math.max(1, ...data.projects.map((p) => metricValue(p, metric)));
    updateGrid(maxVal);

    const visibleList = expanded ? sorted : sorted.slice(0, 12);
    const visibleRepos = new Set(visibleList.map(({ p }) => p.repo));

    // first positions
    const first = new Map<string, DOMRect>();
    rowEls.forEach((el, repo) => {
      if (rowsWrap.contains(el)) first.set(repo, el.getBoundingClientRect());
    });

    // remove not visible
    rowEls.forEach((el, repo) => {
      if (!visibleRepos.has(repo) && rowsWrap.contains(el)) el.remove();
    });

    // append in new order
    for (const { p } of visibleList) {
      let row = rowEls.get(p.repo);
      if (!row) row = buildRow(p);
      updateRow(row, p, maxVal);
      rowsWrap.append(row);
    }

    // FLIP
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      rowEls.forEach((el, repo) => {
        if (!visibleRepos.has(repo)) return;
        const last = el.getBoundingClientRect();
        const f = first.get(repo);
        if (!f) return;
        const dx = f.left - last.left;
        const dy = f.top - last.top;
        if (dx === 0 && dy === 0) return;
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        void el.offsetHeight;
        requestAnimationFrame(() => {
          el.style.transform = '';
        });
      });
    }

    // show all button
    if (sorted.length <= 12) {
      showAllBtn.style.display = 'none';
    } else {
      showAllBtn.style.display = '';
      showAllBtn.textContent = expanded ? 'Show top 12' : `Show all ${sorted.length}`;
    }

    // update aria-pressed
    updateToolbar();
  }

  onVisible(root, () => {
    visible = true;
    // set widths
    rowEls.forEach((el) => {
      const pct = (el as HTMLElement & { _pct?: number })._pct;
      const bar = el.querySelector<HTMLElement>('.lb-bar');
      if (bar && pct != null) bar.style.width = `${pct}%`;
    });
    // in case render hasn't set _pct, re-render
    render();
  });

  // initial render
  render();

  // resize observer
  let resizeTimer: number | null = null;
  const ro = new ResizeObserver(() => {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      render();
    }, 150);
  });
  ro.observe(el);
}