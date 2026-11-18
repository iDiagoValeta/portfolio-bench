import '../styles/experience.css';

import type { Dataset } from '../types';
import type { Profile } from '../types-profile';
import { h } from '../lib/dom';

// The 6 craft checks, mirroring Checks in types.ts (shipped is its own component).
const CHECKS = ['a substantial README', 'a licence', 'CI', 'tests', 'a description', 'at least three topics'];

export function mount(el: HTMLElement, data: Dataset, profile: Profile): void {
  const w = data.weights;
  const wt = (v: number): string => v.toFixed(2);
  const pct = (v: number): string => `${Math.round(v * 100)}%`;

  // Plain words first; the weights come from the dataset so they can never drift from the formula.
  const parts: { key: keyof Dataset['weights']; name: string; plain: string }[] = [
    { key: 'depth', name: 'Depth', plain: 'How much work went into it, on a log scale against the deepest repo so one giant project does not flatten the rest.' },
    { key: 'craft', name: 'Craft', plain: `Hygiene: ${CHECKS.join(', ')}. Each check passed counts the same.` },
    { key: 'recency', name: 'Recency', plain: 'Still alive: full marks for a push this month, fading to zero at 24 months.' },
    { key: 'shipped', name: 'Shipped', plain: 'In production with real users scores 1, a live site or a release scores 0.6, otherwise 0.' },
  ];

  const card = h('div', { class: 'card md-card reveal' });
  const left = h(
    'div',
    { class: 'md-left' },
    h(
      'p',
      { class: 'md-lead' },
      'Every public repo gets one score from 0 to 100, built from four parts that favour work that is deep and shipped over work that is only tidy.',
    ),
  );
  const list = h('dl', { class: 'md-parts' });
  parts.forEach((pt) => {
    list.append(
      h(
        'div',
        { class: 'md-part' },
        h('dt', { class: 'md-part-head' }, h('span', { class: 'md-part-name' }, pt.name), h('span', { class: 'md-part-w mono' }, pct(w[pt.key]))),
        h('dd', { class: 'md-part-def' }, pt.plain),
      ),
    );
  });
  const right = h(
    'div',
    { class: 'md-right' },
    h(
      'p',
      { class: 'md-formula mono' },
      h('span', { class: 'md-formula-k' }, 'Formula'),
      `round(100 * (${wt(w.depth)} depth + ${wt(w.craft)} craft + ${wt(w.recency)} recency + ${wt(w.shipped)} shipped))`,
    ),
    list,
  );
  card.append(left, right);

  el.append(h('div', { class: 'md' }, card));

  // The data note and the footer live in their own mount so the DOM order equals the visual order.
  const colophon = document.querySelector<HTMLElement>('[data-mount="colophon"]') ?? el;
  colophon.append(
    h(
      'p',
      { class: 'md-data' },
      `Repository data comes from the GitHub API, measured on ${data.asOf} and refreshed at every build. Roles and dates come from my CV.`,
    ),
  );

  const ext = { target: '_blank', rel: 'noopener' };
  colophon.append(
    h(
      'footer',
      { class: 'md-footer' },
      h(
        'div',
        { class: 'md-links' },
        h('a', { href: `mailto:${profile.links.email}` }, 'Email'),
        h('a', { href: profile.links.github, ...ext }, 'GitHub'),
        h('a', { href: profile.links.linkedin, ...ext }, 'LinkedIn'),
        h('a', { href: profile.links.huggingface, ...ext }, 'Hugging Face'),
        h('a', { href: profile.links.cv, ...ext }, 'CV'),
      ),
      h('p', { class: 'md-copy mono' }, `${data.asOf.slice(0, 4)} ${profile.name}`),
    ),
  );
}
