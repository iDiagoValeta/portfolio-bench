import './styles/tokens.css';
import './styles/base.css';

import '@fontsource-variable/funnel-display';
import '@fontsource-variable/funnel-sans';
import '@fontsource-variable/martian-mono';
import '@fontsource-variable/doto';

import projectsData from './data/projects.json';
import profileData from '../data/profile.json';

import type { Dataset } from './types';
import type { Profile } from './types-profile';

import * as rose from './sections/rose';
import * as production from './sections/production';
import * as leaderboard from './sections/leaderboard';
import * as trajectory from './sections/trajectory';
import * as experience from './sections/experience';
import * as methodology from './sections/methodology';
import * as card from './sections/card';

const data = projectsData as Dataset;
const profile = profileData as Profile;

// The CV link lives in profile.json only; the static href in index.html is the no-JS fallback.
document.querySelectorAll<HTMLAnchorElement>('a[data-cv]').forEach((a) => { a.href = profile.links.cv; });

type Mountable = { mount(el: HTMLElement, data: Dataset, profile: Profile): void };

// Every [data-mount] point and the module that fills it.
const MODULES: Record<string, Mountable> = {
  rose,
  proof: production,
  leaderboard,
  trajectory,
  experience,
  methodology,
};

function mountAll(): void {
  for (const [name, mod] of Object.entries(MODULES)) {
    const el = document.querySelector<HTMLElement>(`[data-mount="${name}"]`);
    if (el) mod.mount(el, data, profile);
  }

  const cardRoot = document.getElementById('card-root');
  if (cardRoot) card.initCard(cardRoot, data);
}

// Copy never carries numbers by hand: [data-fact="repos"] reads data.facts.repos,
// "a.b" walks into nested objects, "asOf" and "year" come from the build date.
function factValue(path: string): string {
  if (path === 'asOf') return data.asOf;
  if (path === 'year') return data.asOf.slice(0, 4);
  if (path === 'asOfLong') {
    return new Date(`${data.asOf}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  let v: unknown = data.facts;
  for (const key of path.split('.')) v = (v as Record<string, unknown> | undefined)?.[key];
  if (typeof v === 'number') return v.toLocaleString('en-US');
  return v == null ? '' : String(v);
}
document.querySelectorAll<HTMLElement>('[data-fact]').forEach((el) => {
  el.textContent = factValue(el.dataset.fact ?? '');
});

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function applyTheme(next: string): void {
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('theme', next);
  } catch {
    /* ignore */
  }
}

// Theme switch: a circular reveal that grows from the toggle button (View Transitions API).
// Without the API, or with reduced motion, the theme just changes.
const toggle = document.getElementById('theme-toggle');
toggle?.addEventListener('click', () => {
  const current =
    document.documentElement.getAttribute('data-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  if (!document.startViewTransition || reducedMotion()) return applyTheme(next);
  const r = toggle.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.documentElement.classList.add('theme-vt');
  const vt = document.startViewTransition(() => applyTheme(next));
  vt.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    })
    .catch(() => {});
  vt.finished.finally(() => document.documentElement.classList.remove('theme-vt'));
});

// Fallbacks for browsers without scroll-driven animations: reading progress and section reveals.
if (!CSS.supports('animation-timeline: view()')) {
  const bar = document.querySelector<HTMLElement>('.progress');
  const update = (): void => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar?.style.setProperty('--p', String(max > 0 ? Math.min(1, scrollY / max) : 0));
  };
  addEventListener('scroll', update, { passive: true });
  update();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountAll);
} else {
  mountAll();
}