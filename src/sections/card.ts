import '../styles/card.css';

import type { Checks, Dataset, Project } from '../types';
import { h } from '../lib/dom';
import { formatCompact } from '../lib/format';
import { hideTip } from '../lib/tooltip';

const CHECK_LABELS: { key: keyof Checks; label: string }[] = [
  { key: 'readme', label: 'README over 1500 characters' },
  { key: 'license', label: 'Licence file' },
  { key: 'ci', label: 'CI workflow' },
  { key: 'tests', label: 'Tests present' },
  { key: 'description', label: 'Description' },
  { key: 'topics', label: 'At least 3 topics' },
  { key: 'shipped', label: 'Homepage or release' },
];

let dataset: Dataset;
let drawer: HTMLElement;
let backdrop: HTMLElement;
let catEl: HTMLElement;
let titleEl: HTMLElement;
let linerEl: HTMLElement;
let stackEl: HTMLElement;
let flagsEl: HTMLElement;
let scoreNumEl: HTMLElement;
let barsEl: HTMLElement;
let checksEl: HTMLElement;
let metricsEl: HTMLElement;
let langsEl: HTMLElement;
let linksEl: HTMLElement;
let opener: HTMLElement | null = null;
let focusables: HTMLElement[] = [];
let isOpen = false;
let prevOverflow = '';
let rootEl: HTMLElement | null = null;

function flagLabel(f: string): string {
  return f.charAt(0).toUpperCase() + f.slice(1);
}

function fill(p: Project): void {
  const cat = dataset.categories.find((c) => c.id === p.category);

  catEl.innerHTML = '';
  catEl.append(
    h('i', { class: 'cd-cat-sq', style: `background:var(--cat-${p.category})` }),
    document.createTextNode(cat?.label ?? p.category),
  );

  titleEl.textContent = p.title;
  linerEl.textContent = p.oneLiner;

  stackEl.innerHTML = '';
  for (const s of p.stack) stackEl.append(h('span', { class: 'chip' }, s));

  flagsEl.innerHTML = '';
  for (const f of p.flags) flagsEl.append(h('span', { class: 'pill cd-flag' }, flagLabel(f)));

  scoreNumEl.textContent = String(p.index);
  barsEl.innerHTML = '';
  const components: [string, number][] = [
    ['Craft', p.craft],
    ['Reach', p.reach],
    ['Recency', p.recency],
  ];
  for (const [label, value] of components) {
    const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
    barsEl.append(
      h(
        'div',
        { class: 'cd-bar' },
        h(
          'div',
          { class: 'cd-bar-top' },
          h('span', { class: 'cd-bar-label' }, label),
          h('span', { class: 'cd-bar-val num' }, String(pct)),
        ),
        h('span', { class: 'cd-bar-track' },
          h('i', { class: 'cd-bar-fill', style: `width:${pct}%;background:var(--cat-${p.category})` })),
      ),
    );
  }

  checksEl.innerHTML = '';
  for (const { key, label } of CHECK_LABELS) {
    const pass = p.checks[key];
    checksEl.append(
      h(
        'li',
        { class: 'cd-check', 'data-pass': String(pass) },
        h('span', { class: 'cd-check-icon', 'aria-hidden': 'true' }, pass ? '✓' : '–'),
        h('span', { class: 'cd-sr' }, pass ? 'Passed: ' : 'Failed: '),
        h('span', {}, label),
      ),
    );
  }

  metricsEl.innerHTML = '';
  const metrics: [string, string][] = [
    ['Commits', formatCompact(p.commits)],
    ['Stars', formatCompact(p.stars)],
    ['Created', p.createdAt.slice(0, 10)],
    ['Last push', p.pushedAt.slice(0, 10)],
  ];
  for (const [label, value] of metrics) {
    metricsEl.append(
      h(
        'div',
        { class: 'cd-metric' },
        h('span', { class: 'cd-metric-label' }, label),
        h('span', { class: 'cd-metric-value num' }, value),
      ),
    );
  }

  langsEl.innerHTML = '';
  if (p.languages.length === 0) {
    langsEl.append(h('p', { class: 'cd-lang-empty' }, 'No language data'));
    return;
  }
  // Percentages are over the whole repo (all languages), not only the top 4.
  const total = p.languages.reduce((sum, l) => sum + l.bytes, 0) || 1;
  const top = p.languages.slice(0, 4);
  const otherBytes = p.languages.slice(4).reduce((sum, l) => sum + l.bytes, 0);
  // Neutral greys derived from ink so the stacked bar adapts to the theme; never category colours.
  const greys = ['85%', '68%', '52%', '36%', '20%'];
  const entries: { name: string; bytes: number; grey: string }[] = top.map((l, i) => ({
    name: l.name,
    bytes: l.bytes,
    grey: `color-mix(in srgb, var(--ink) ${greys[i]}, var(--surface))`,
  }));
  if (otherBytes > 0) {
    entries.push({
      name: 'Other',
      bytes: otherBytes,
      grey: `color-mix(in srgb, var(--ink) ${greys[4]}, var(--surface))`,
    });
  }
  const bar = h('div', { class: 'cd-lang-bar' });
  const legend = h('div', { class: 'cd-lang-legend' });
  for (const e of entries) {
    bar.append(h('i', { class: 'cd-lang-seg', style: `flex:${e.bytes || 1} 1 0;background:${e.grey}` }));
    legend.append(
      h(
        'span',
        { class: 'cd-lang' },
        h('i', { class: 'cd-lang-sq', style: `background:${e.grey}` }),
        h('span', { class: 'cd-lang-name' }, e.name),
        h('span', { class: 'cd-lang-pct num' }, `${Math.round((e.bytes / total) * 100)}%`),
      ),
    );
  }
  langsEl.append(bar, legend);

  linksEl.innerHTML = '';
  linksEl.append(
    h('a', { class: 'pill', href: p.repoUrl, target: '_blank', rel: 'noopener' }, 'Repository ↗'),
  );
  if (p.url) {
    linksEl.append(h('a', { class: 'pill', href: p.url, target: '_blank', rel: 'noopener' }, 'Live site ↗'));
  }

  focusables = Array.from(drawer.querySelectorAll<HTMLElement>('button, a[href]'));
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeCard();
    return;
  }
  if (e.key !== 'Tab' || focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !drawer.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !drawer.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

function setSiblingsInert(on: boolean): void {
  const cr = rootEl ?? document.getElementById('card-root');
  if (!cr || !cr.parentElement) return;
  for (const el of Array.from(cr.parentElement.children)) {
    if (el === cr) continue;
    if (on) {
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
    } else {
      el.removeAttribute('inert');
      el.removeAttribute('aria-hidden');
    }
  }
}

export function openCard(repo: string): void {
  const p = dataset.projects.find((x) => x.repo === repo);
  if (!p) return;

  hideTip();

  if (!isOpen) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    prevOverflow = document.documentElement.style.overflow;
    document.addEventListener('keydown', onKeydown);
    setSiblingsInert(true);
  }

  fill(p);
  history.replaceState(null, '', `#p/${encodeURIComponent(p.repo)}`);

  backdrop.classList.add('is-open');
  drawer.classList.add('is-open');
  drawer.toggleAttribute('inert', false);
  drawer.setAttribute('aria-hidden', 'false');
  document.documentElement.style.overflow = 'hidden';
  isOpen = true;

  drawer.querySelector<HTMLElement>('.cd-close')?.focus();
}

function closeCard(): void {
  if (!isOpen) return;

  drawer.classList.remove('is-open');
  backdrop.classList.remove('is-open');
  drawer.toggleAttribute('inert', true);
  drawer.setAttribute('aria-hidden', 'true');
  document.documentElement.style.overflow = prevOverflow;
  document.removeEventListener('keydown', onKeydown);
  setSiblingsInert(false);
  history.replaceState(null, '', location.pathname + location.search);
  isOpen = false;

  if (opener && document.contains(opener)) opener.focus();
  opener = null;
}

export function initCard(root: HTMLElement, data: Dataset): void {
  dataset = data;
  rootEl = root;

  backdrop = h('div', { class: 'cd-backdrop' });
  drawer = h('aside', {
    class: 'cd',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'cd-title',
    'aria-hidden': 'true',
    inert: true,
  });

  const head = h('div', { class: 'cd-head' });
  catEl = h('span', { class: 'cd-cat chip' });
  const close = h('button', { class: 'cd-close', type: 'button', 'aria-label': 'Close details' }, '×');
  close.addEventListener('click', closeCard);
  head.append(catEl, close);

  titleEl = h('h2', { class: 'cd-title', id: 'cd-title' });
  linerEl = h('p', { class: 'cd-liner' });
  stackEl = h('div', { class: 'cd-chips' });
  flagsEl = h('div', { class: 'cd-flags' });
  scoreNumEl = h('div', { class: 'cd-score-num' });
  barsEl = h('div', { class: 'cd-bars' });
  checksEl = h('ul', { class: 'cd-checks' });
  metricsEl = h('div', { class: 'cd-metrics' });
  langsEl = h('div', { class: 'cd-langs' });
  linksEl = h('div', { class: 'cd-links' });

  const scoreSection = h(
    'section',
    { class: 'cd-section' },
    h('div', { class: 'cd-label' }, 'Engineering index'),
    h('div', { class: 'cd-score-row' }, scoreNumEl, barsEl),
  );
  const checksSection = h(
    'section',
    { class: 'cd-section' },
    h('div', { class: 'cd-label' }, 'Checks'),
    checksEl,
  );
  const metricsSection = h(
    'section',
    { class: 'cd-section' },
    h('div', { class: 'cd-label' }, 'Metrics'),
    metricsEl,
  );
  const langsSection = h(
    'section',
    { class: 'cd-section' },
    h('div', { class: 'cd-label' }, 'Languages'),
    langsEl,
  );

  const body = h(
    'div',
    { class: 'cd-body' },
    titleEl,
    linerEl,
    stackEl,
    flagsEl,
    scoreSection,
    checksSection,
    metricsSection,
    langsSection,
    linksEl,
  );
  drawer.append(head, body);

  backdrop.addEventListener('click', closeCard);
  root.append(backdrop, drawer);

  const match = /^#p\/(.+)$/.exec(location.hash);
  if (match) {
    const repo = decodeURIComponent(match[1]);
    const p = dataset.projects.find((x) => x.repo === repo);
    if (p) openCard(p.repo);
  }
}
