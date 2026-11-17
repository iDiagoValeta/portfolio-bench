import '../styles/table.css';

import type { Dataset, Project } from '../types';
import type { Profile } from '../types-profile';
import { h, onVisible } from '../lib/dom';
import { asOfDate, formatCompact, relativeTime } from '../lib/format';
import { openCard } from './card';

type SortKey = 'rank' | 'project' | 'category' | 'index' | 'commits' | 'stars' | 'updated' | 'flags';

interface Column {
  key: SortKey;
  label: string;
  numeric?: boolean;
  defaultDir: 'asc' | 'desc';
}

const COLUMNS: Column[] = [
  { key: 'rank', label: '#', defaultDir: 'asc' },
  { key: 'project', label: 'Project', defaultDir: 'asc' },
  { key: 'category', label: 'Category', defaultDir: 'asc' },
  { key: 'index', label: 'Index', numeric: true, defaultDir: 'desc' },
  { key: 'commits', label: 'Commits', numeric: true, defaultDir: 'desc' },
  { key: 'stars', label: 'Stars', numeric: true, defaultDir: 'desc' },
  { key: 'updated', label: 'Updated', defaultDir: 'desc' },
  { key: 'flags', label: 'Flags', defaultDir: 'asc' },
];

export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  void profile;

  const asOf = asOfDate(data.asOf);
  const catLabel = (id: string): string => data.categories.find((c) => c.id === id)?.label ?? id;
  // Canonical rank is the project's place in the index-sorted dataset, stable under other sorts.
  const rank = new Map(data.projects.map((p, i) => [p.repo, i + 1]));
  const flagLabel = (f: string): string => f.charAt(0).toUpperCase() + f.slice(1);

  const root = h('div', { class: 'card t-card' });
  const scroller = h('div', { class: 't-scroll' });
  const table = h('table', { class: 't-table' });
  const thead = h('thead');
  const headRow = h('tr');
  const tbody = h('tbody');
  table.append(thead, tbody);
  thead.append(headRow);
  scroller.append(table);
  root.append(scroller);
  el.append(root);

  const thEls = new Map<SortKey, HTMLTableCellElement>();
  const sort: { key: SortKey; dir: 'asc' | 'desc' } = { key: 'index', dir: 'desc' };

  for (const col of COLUMNS) {
    const th = h('th', {
      scope: 'col',
      class: col.numeric ? 't-num' : null,
      'aria-sort': 'none',
    });
    const arrow = h('span', { class: 't-arrow', 'aria-hidden': 'true' }, '↕');
    const btn = h('button', { type: 'button', class: 't-sort' }, col.label, arrow);
    btn.addEventListener('click', () => {
      if (sort.key === col.key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
      else {
        sort.key = col.key;
        sort.dir = col.defaultDir;
      }
      render();
    });
    th.append(btn);
    headRow.append(th);
    thEls.set(col.key, th);
  }

  const rows = new Map<string, HTMLTableRowElement>();

  function valueFor(p: Project, key: SortKey): string | number {
    switch (key) {
      case 'rank':
        return rank.get(p.repo) ?? 0;
      case 'project':
        return p.title.toLowerCase();
      case 'category':
        return catLabel(p.category).toLowerCase();
      case 'index':
        return p.index;
      case 'commits':
        return p.commits;
      case 'stars':
        return p.stars;
      case 'updated':
        return Date.parse(p.pushedAt);
      case 'flags':
        return p.flags.map(flagLabel).join(',').toLowerCase();
    }
  }

  function compare(a: Project, b: Project): number {
    const av = valueFor(a, sort.key);
    const bv = valueFor(b, sort.key);
    let cmp: number;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    if (cmp === 0) return (rank.get(a.repo) ?? 0) - (rank.get(b.repo) ?? 0);
    return sort.dir === 'asc' ? cmp : -cmp;
  }

  function buildRow(p: Project): HTMLTableRowElement {
    const tr = h('tr', { class: 't-row', tabindex: '0' });

    const tdRank = h('td', { class: 't-rank num' }, String(rank.get(p.repo) ?? ''));

    const tdProject = h(
      'td',
      { class: 't-project' },
      h('span', { class: 't-title' }, p.title),
      h('span', { class: 't-repo' }, p.repo),
    );

    const tdCat = h(
      'td',
      { class: 't-cat' },
      h('i', { class: 't-sq', style: `background:var(--cat-${p.category})` }),
      document.createTextNode(catLabel(p.category)),
    );

    const fill = h('i', { class: 't-index-fill', style: `background:var(--cat-${p.category});width:0%` });
    fill.dataset.pct = String(p.index);
    const tdIndex = h(
      'td',
      { class: 't-num t-index' },
      h('span', { class: 't-index-track' }, fill),
      h('span', { class: 'num t-index-val' }, String(p.index)),
    );

    const tdCommits = h('td', { class: 't-num num' }, formatCompact(p.commits));
    const tdStars = h('td', { class: 't-num num' }, formatCompact(p.stars));
    const tdUpdated = h('td', { class: 't-updated' }, relativeTime(p.pushedAt, asOf));

    const tdFlags = h('td', { class: 't-flags' });
    // Only Local and Production get pills; "featured" is used by the charts, not this column.
    for (const f of p.flags) {
      if (f === 'local') tdFlags.append(h('span', { class: 't-flag' }, 'Local'));
      else if (f === 'production') tdFlags.append(h('span', { class: 't-flag' }, 'Production'));
    }

    tr.append(tdRank, tdProject, tdCat, tdIndex, tdCommits, tdStars, tdUpdated, tdFlags);

    tr.addEventListener('click', () => openCard(p.repo));
    tr.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        openCard(p.repo);
      }
    });

    return tr;
  }

  function render(): void {
    const sorted = [...data.projects].sort(compare);
    for (const p of sorted) {
      let tr = rows.get(p.repo);
      if (!tr) {
        tr = buildRow(p);
        rows.set(p.repo, tr);
      }
      tbody.append(tr);
    }
    COLUMNS.forEach((col) => {
      const th = thEls.get(col.key)!;
      const active = col.key === sort.key;
      th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      const arrow = th.querySelector<HTMLElement>('.t-arrow')!;
      arrow.textContent = active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕';
      arrow.classList.toggle('is-active', active);
    });
  }

  render();

  onVisible(root, () => {
    tbody.querySelectorAll<HTMLElement>('.t-index-fill').forEach((fill) => {
      fill.style.width = `${fill.dataset.pct ?? '0'}%`;
    });
  });

  let resizeTimer: number | null = null;
  const ro = new ResizeObserver(() => {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(render, 150);
  });
  ro.observe(el);
}
