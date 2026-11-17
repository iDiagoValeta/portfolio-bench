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
  return `${fmtMonth(exp.from)} – ${exp.to ? fmtMonth(exp.to) : 'now'}`;
}

export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  void data;
  const root = h('div', { class: 'xp' });
  let step = 0;

  const list = h('ul', { class: 'xp-list' });
  for (const exp of profile.experience) {
    const current = exp.to === null;
    const body = h(
      'div',
      { class: 'xp-body' },
      h('span', { class: 'xp-dot', 'aria-hidden': 'true' }),
      h('h3', { class: 'xp-role' }, exp.role),
      h('p', { class: 'xp-org' }, `${exp.org} · ${exp.place}`),
      h('p', { class: 'xp-note' }, exp.note),
    );
    list.append(
      h(
        'li',
        { class: `xp-entry${current ? ' xp-entry--current' : ''}`, style: `--i:${step++}` },
        h('div', { class: 'xp-date mono' }, dateRange(exp)),
        body,
      ),
    );
  }
  root.append(list);

  root.append(h('p', { class: 'xp-sub mono' }, 'Education'));
  const edu = h('ul', { class: 'xp-list xp-list--edu' });
  for (const ed of profile.education) {
    const body = h(
      'div',
      { class: 'xp-body' },
      h('span', { class: 'xp-dot', 'aria-hidden': 'true' }),
      h('h3', { class: 'xp-role xp-role--edu' }, ed.title),
      h('p', { class: 'xp-org' }, ed.org),
    );
    edu.append(
      h(
        'li',
        { class: 'xp-entry xp-entry--edu', style: `--i:${step++}` },
        h('div', { class: 'xp-date mono' }, ed.year),
        body,
      ),
    );
  }
  root.append(edu);

  root.append(h('p', { class: 'xp-sub mono' }, 'Skills'));
  const skills = h('div', { class: 'xp-skills' });
  for (const [group, items] of Object.entries(profile.skills)) {
    const chips = h('div', { class: 'xp-chips' });
    for (const item of items) chips.append(h('span', { class: 'xp-chip' }, item));
    skills.append(
      h(
        'div',
        { class: 'xp-skill-group' },
        h('p', { class: 'xp-skill-label mono' }, group),
        chips,
      ),
    );
  }
  root.append(skills);

  el.append(root);

  onVisible(root, () => root.classList.add('is-visible'));
}
