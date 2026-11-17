import './styles/tokens.css';
import './styles/base.css';

import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

import projectsData from './data/projects.json';
import profileData from '../data/profile.json';

import type { Dataset } from './types';
import type { Profile } from './types-profile';

import * as fingerprint from './sections/fingerprint';
import * as tiles from './sections/tiles';
import * as leaderboard from './sections/leaderboard';
import * as scatter from './sections/scatter';
import * as trajectory from './sections/trajectory';
import * as table from './sections/table';
import * as experience from './sections/experience';
import * as methodology from './sections/methodology';
import * as card from './sections/card';

const data = projectsData as Dataset;
const profile = profileData as Profile;

function mountAll(): void {
  const byMount = (name: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-mount="${name}"]`);

  const fingerprintEl = byMount('fingerprint');
  if (fingerprintEl) fingerprint.mount(fingerprintEl, data, profile);

  const tilesEl = byMount('tiles');
  if (tilesEl) tiles.mount(tilesEl, data, profile);

  const leaderboardEl = byMount('leaderboard');
  if (leaderboardEl) leaderboard.mount(leaderboardEl, data, profile);

  const scatterEl = byMount('scatter');
  if (scatterEl) scatter.mount(scatterEl, data, profile);

  const trajectoryEl = byMount('trajectory');
  if (trajectoryEl) trajectory.mount(trajectoryEl, data, profile);

  const tableEl = byMount('table');
  if (tableEl) table.mount(tableEl, data, profile);

  const experienceEl = byMount('experience');
  if (experienceEl) experience.mount(experienceEl, data, profile);

  const methodologyEl = byMount('methodology');
  if (methodologyEl) methodology.mount(methodologyEl, data, profile);

  const cardRoot = document.getElementById('card-root');
  if (cardRoot) card.initCard(cardRoot, data);
}

const eyebrow = document.getElementById('hero-eyebrow');
if (eyebrow) {
  eyebrow.textContent = `Independent benchmarks · data as of ${data.asOf}`;
}

const sub = document.getElementById('hero-sub');
if (sub) {
  sub.textContent = `${profile.tagline} ${profile.role} · ${profile.location}`;
}

const toggle = document.getElementById('theme-toggle');
toggle?.addEventListener('click', () => {
  const current =
    document.documentElement.getAttribute('data-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('theme', next);
  } catch {
    /* ignore */
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountAll);
} else {
  mountAll();
}