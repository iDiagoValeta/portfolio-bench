import '../styles/experience.css';

import type { Dataset } from '../types';
import type { Profile } from '../types-profile';
import { h } from '../lib/dom';

// The 7 craft checks, mirroring the Checks interface in types.ts.
const CHECKS = [
  'README over 1500 characters',
  'Licence',
  'CI workflow',
  'Tests present',
  'Description',
  'At least 3 topics',
  'Homepage or release',
];

const FORMULA: [string, string][] = [
  ['craft', 'share of the 7 checks passed (listed below)'],
  ['reach', 'log10(1 + stars) / log10(1 + max stars across projects)'],
  ['recency', 'max(0, 1 - months since last push / 24)'],
  ['index', 'round(100 * (0.5 craft + 0.25 reach + 0.25 recency))'],
];

export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  const root = h('div', { class: 'md' });

  const formula = h('div', { class: 'card md-formula' });
  for (const [name, def] of FORMULA) {
    formula.append(
      h('p', { class: 'md-line mono' }, h('span', { class: 'md-var' }, name), ` = ${def}`),
    );
  }
  root.append(formula);

  root.append(h('p', { class: 'md-label mono' }, 'The 7 craft checks'));
  const checks = h('ul', { class: 'md-checks' });
  for (const c of CHECKS) {
    checks.append(h('li', null, h('span', { class: 'md-check-sq', 'aria-hidden': 'true' }), c));
  }
  root.append(checks);

  root.append(
    h(
      'p',
      { class: 'md-data' },
      `Data from the GitHub API as of ${data.asOf}; CV facts from my résumé.`,
    ),
  );

  const year = data.asOf.slice(0, 4);
  const ext = { target: '_blank', rel: 'noopener' };
  const links = h(
    'div',
    { class: 'md-links' },
    h('a', { href: `mailto:${profile.links.email}` }, 'Email'),
    h('a', { href: profile.links.github, ...ext }, 'GitHub'),
    h('a', { href: profile.links.linkedin, ...ext }, 'LinkedIn'),
    h('a', { href: profile.links.huggingface, ...ext }, 'Hugging Face'),
    h('a', { href: profile.links.cv, ...ext }, 'CV'),
  );
  root.append(
    h(
      'footer',
      { class: 'md-footer' },
      links,
      h('p', { class: 'md-copy mono' }, `© ${year} ${profile.name}`),
    ),
  );

  el.append(root);
}
