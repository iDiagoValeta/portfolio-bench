import '../styles/experience.css';

import type { Dataset } from '../types';
import type { Profile, ProfileExperience } from '../types-profile';
import { h, onVisible } from '../lib/dom';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function dateRange(exp: ProfileExperience): string {
  return `${fmtMonth(exp.from)} to ${exp.to ? fmtMonth(exp.to) : 'now'}`;
}

export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  void data;
  const root = h('div', { class: 'xp' });
  let step = 0;

  // An education entry that names the employer (e.g. a talent program run by it) belongs with that role.
  const linked = new Set<number>();
  const edLinkedTo = (org: string): { ed: Profile['education'][number]; idx: number } | null => {
    const idx = profile.education.findIndex((ed, i) => !linked.has(i) && ed.title.includes(org));
    if (idx < 0) return null;
    linked.add(idx);
    return { ed: profile.education[idx], idx };
  };

  const list = h('ol', { class: 'xp-list', 'aria-label': 'Experience' });
  // Same window as the chart: roles that ended before 2025 stay on the CV only.
  for (const exp of profile.experience.filter((e) => (e.to ?? '9999') > '2025-01')) {
    const current = exp.to === null;
    const link = edLinkedTo(exp.org);
    list.append(
      h(
        'li',
        { class: `xp-entry${current ? ' xp-entry--current' : ''}`, style: `--i:${step++}` },
        h('span', { class: 'xp-dot', 'aria-hidden': 'true' }),
        h('p', { class: 'xp-date mono' }, dateRange(exp)),
        h('h3', { class: 'xp-role' }, exp.role),
        h('p', { class: 'xp-org' }, `${exp.org}, ${exp.place}`),
        h('p', { class: 'xp-note' }, exp.note),
        link && h('p', { class: 'xp-also' }, h('span', { class: 'xp-also-k mono' }, link.ed.year), `${link.ed.title}, ${link.ed.org}`),
      ),
    );
  }

  const edu = h('ol', { class: 'xp-list xp-list--edu', 'aria-label': 'Education' });
  profile.education.forEach((ed, i) => {
    if (linked.has(i)) return;
    edu.append(
      h(
        'li',
        { class: 'xp-entry xp-entry--edu', style: `--i:${step++}` },
        h('span', { class: 'xp-dot', 'aria-hidden': 'true' }),
        h('p', { class: 'xp-date mono' }, ed.year),
        h('h3', { class: 'xp-role xp-role--edu' }, ed.title),
        h('p', { class: 'xp-org' }, ed.org),
        ed.note && h('p', { class: 'xp-note' }, ed.note),
      ),
    );
  });

  root.append(h('p', { class: 'xp-label' }, 'Experience'), list, h('p', { class: 'xp-label' }, 'Education'), edu);
  el.append(root);

  onVisible(root, () => root.classList.add('is-visible'));
}
