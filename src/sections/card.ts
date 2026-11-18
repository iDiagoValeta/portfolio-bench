import '../styles/card.css';

import type { Checks, Dataset, Project } from '../types';
import { h } from '../lib/dom';
import { hideTip } from '../lib/tooltip';

// Four tonal steps of the category colour, one per index part (depth, craft, recency, shipped).
// The leaderboard bar and the card bars share them.
export const TONES = [100, 72, 50, 32];

const CHECK_LABELS: { key: keyof Checks; label: string }[] = [
  { key: 'readme', label: 'README over 1500 characters' },
  { key: 'license', label: 'Licence file' },
  { key: 'ci', label: 'CI workflow' },
  { key: 'tests', label: 'Tests present' },
  { key: 'description', label: 'Description' },
  { key: 'topics', label: 'At least 3 topics' },
];

let dataset: Dataset;
let drawer: HTMLElement;
let backdrop: HTMLElement;
let catEl: HTMLElement;
let titleEl: HTMLElement;
let linerEl: HTMLElement;
let stackEl: HTMLElement;
let scoreNumEl: HTMLElement;
let weeklyEl: HTMLElement;
let weeklyLabelEl: HTMLElement;
let checksLabelEl: HTMLElement;
let barsEl: HTMLElement;
let checksEl: HTMLElement;
let shippedEl: HTMLElement;
let metricsEl: HTMLElement;
let langsEl: HTMLElement;
let linksEl: HTMLElement;
let opener: HTMLElement | SVGElement | null = null;
let focusables: HTMLElement[] = [];
let isOpen = false;
let prevOverflow = '';
let rootEl: HTMLElement | null = null;
let currentRepo = '';

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

  // Flags and stack share one wrapping row, so a single flag never sits alone on a line.
  // 'featured' is a curation hint, not a property of the project, so the card does not show it.
  stackEl.innerHTML = '';
  for (const f of p.flags.filter((x) => x !== 'featured')) stackEl.append(h('span', { class: 'pill cd-flag' }, flagLabel(f)));
  for (const s of p.stack) stackEl.append(h('span', { class: 'chip' }, s));

  scoreNumEl.textContent = String(p.index);

  // 52-week activity strip: same cell language as the Activity section, category colour,
  // opacity by weekly activity, empty weeks in --line.
  const weekly = p.weekly;
  const wMax = Math.max(1, ...weekly);
  weeklyLabelEl.textContent = `Last ${weekly.length} weeks`;
  weeklyEl.setAttribute('aria-label', `${p.title}: week by week activity over the last ${weekly.length} weeks`);
  weeklyEl.replaceChildren();
  weekly.forEach((v, i) => {
    const cell = h('i', {
      class: v > 0 ? 'cd-wk' : 'cd-wk zero',
      title: v > 0 ? 'Active week' : 'Quiet week',
      style: v > 0 ? `background:var(--cat-${p.category});opacity:${(0.2 + 0.8 * Math.sqrt(v / wMax)).toFixed(2)}` : undefined,
    });
    cell.style.setProperty('--c', String(i));
    weeklyEl.append(cell);
  });

  barsEl.innerHTML = '';
  const components: [string, number][] = [
    ['Depth', p.depth],
    ['Craft', p.craft],
    ['Recency', p.recency],
    ['Shipped', p.shipped],
  ];
  components.forEach(([label, value], i) => {
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
          h('i', { class: 'cd-bar-fill', style: `width:${pct}%;background:color-mix(in srgb, var(--cat-${p.category}) ${TONES[i]}%, var(--surface))` })),
      ),
    );
  });

  checksEl.innerHTML = '';
  const passed = CHECK_LABELS.filter(({ key }) => p.checks[key]).length;
  checksLabelEl.textContent = `Craft checks, ${passed} of ${CHECK_LABELS.length}`;
  for (const { key, label } of CHECK_LABELS) {
    const pass = p.checks[key];
    checksEl.append(
      h(
        'li',
        { class: 'cd-check', 'data-pass': String(pass) },
        h('i', { class: 'cd-check-dot', 'aria-hidden': 'true', style: `--cat:var(--cat-${p.category})` }),
        h('span', { class: 'cd-sr' }, pass ? 'Passed: ' : 'Failed: '),
        h('span', {}, label),
      ),
    );
  }

  shippedEl.replaceChildren(
    h('span', { class: 'cd-shipped-state' }, p.shipped >= 1 ? 'Production' : p.shipped > 0 ? 'Live site or release' : 'Not shipped'),
    document.createTextNode(
      p.shipped >= 1
        ? '. Used by real users, counts 1.'
        : p.shipped > 0
          ? '. Has a live site or a release, counts 0.6.'
          : '. No live site and no release, counts 0.',
    ),
  );

  metricsEl.innerHTML = '';
  const metrics: [string, string][] = [
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
  } else {
    fillLanguages(p);
  }

  fillLinks(p);
  focusables = Array.from(drawer.querySelectorAll<HTMLElement>('button, a[href]'));
}

// Split out so an empty language list can never skip the links and the focus list below it.
function fillLanguages(p: Project): void {
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
}

function fillLinks(p: Project): void {
  linksEl.innerHTML = '';
  linksEl.append(
    h('a', { class: 'pill', href: p.repoUrl, target: '_blank', rel: 'noopener' }, 'Repository ↗'),
  );
  if (p.url) {
    linksEl.append(h('a', { class: 'pill', href: p.url, target: '_blank', rel: 'noopener' }, 'Live site ↗'));
  }
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

// The title of the leaderboard row for this repo, when it is on screen: the shared element of the morph.
function rowTitleFor(repo: string): HTMLElement | null {
  const row = document.querySelector<HTMLElement>(`.lb-row[data-repo="${CSS.escape(repo)}"]`);
  const t = row?.isConnected ? row.querySelector<HTMLElement>('.lb-title') : null;
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight ? t : null;
}

const NAME = 'view-transition-name';

// Runs update inside a view transition where the row title and the card title share one name, only
// for the length of the transition. Without the API, with reduced motion or with no row on screen, it just runs.
function morph(repo: string, opening: boolean, update: () => void): void {
  const rowTitle = rowTitleFor(repo);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!rowTitle || reduced || !document.startViewTransition) {
    update();
    return;
  }
  const [from, to] = opening ? [rowTitle, titleEl] : [titleEl, rowTitle];
  // The drawer must be in place at once: the transition does the moving, not the slide.
  drawer.classList.add('cd-vt');
  backdrop.classList.add('cd-vt');
  document.documentElement.dataset.vt = opening ? 'card' : 'card-close';
  from.style.setProperty(NAME, 'card-title');
  const t = document.startViewTransition(() => {
    update();
    from.style.removeProperty(NAME);
    to.style.setProperty(NAME, 'card-title');
  });
  void t.finished.finally(() => {
    rowTitle.style.removeProperty(NAME);
    titleEl.style.removeProperty(NAME);
    drawer.classList.remove('cd-vt');
    backdrop.classList.remove('cd-vt');
    delete document.documentElement.dataset.vt;
  });
}

export function openCard(repo: string): void {
  const p = dataset.projects.find((x) => x.repo === repo);
  if (!p) return;

  hideTip();

  const show = (): void => {
    fill(p);
    history.replaceState(null, '', `#p/${encodeURIComponent(p.repo)}`);

    backdrop.classList.add('is-open');
    drawer.classList.add('is-open');
    drawer.toggleAttribute('inert', false);
    drawer.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    drawer.querySelector<HTMLElement>('.cd-close')?.focus();
  };

  if (!isOpen) {
    // A rose petal is an SVG <g>, so SVGElement counts as an opener too.
    opener = document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null;
    prevOverflow = document.documentElement.style.overflow;
    document.addEventListener('keydown', onKeydown);
    setSiblingsInert(true);
    currentRepo = p.repo;
    isOpen = true;
    morph(p.repo, true, show);
  } else {
    currentRepo = p.repo;
    show();
  }
}

function closeCard(): void {
  if (!isOpen) return;
  isOpen = false;
  document.removeEventListener('keydown', onKeydown);

  const repo = currentRepo;
  morph(currentRepo, false, () => {
    drawer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    drawer.toggleAttribute('inert', true);
    drawer.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = prevOverflow;
    setSiblingsInert(false);
    history.replaceState(null, '', location.pathname + location.search);
    // Focus goes back to whatever opened the card, even a roving-tabindex petal with tabindex=-1.
    // Only when that element is gone (a redraw) does it fall back to the rose or the repo's row.
    const target: HTMLElement | SVGElement | null = opener && opener.isConnected
      ? opener
      : document.querySelector<HTMLElement>(`.lb-row[data-repo="${CSS.escape(repo)}"]`) ?? document.querySelector<HTMLElement>('.rose-petal[tabindex="0"], .rose');
    target?.focus();
    opener = null;
  });
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
  scoreNumEl = h('div', { class: 'cd-score-num' });
  weeklyEl = h('div', { class: 'cd-weekly', role: 'img', 'aria-label': '' });
  weeklyLabelEl = h('div', { class: 'cd-label' });
  checksLabelEl = h('div', { class: 'cd-label' });
  barsEl = h('div', { class: 'cd-bars' });
  checksEl = h('ul', { class: 'cd-checks' });
  shippedEl = h('p', { class: 'cd-shipped' });
  metricsEl = h('div', { class: 'cd-metrics' });
  langsEl = h('div', { class: 'cd-langs' });
  linksEl = h('div', { class: 'cd-links' });

  const scoreSection = h(
    'section',
    { class: 'cd-section' },
    h('div', { class: 'cd-label' }, 'Engineering index'),
    h('div', { class: 'cd-score-row' }, scoreNumEl, barsEl),
  );
  const activitySection = h('section', { class: 'cd-section' }, weeklyLabelEl, weeklyEl);
  const checksSection = h('section', { class: 'cd-section' }, checksLabelEl, checksEl, shippedEl);
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
    scoreSection,
    activitySection,
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
