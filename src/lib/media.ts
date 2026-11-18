import '../styles/media.css';

import mediaData from '../../data/media.json';
import { h } from './dom';

// One demo per project, curated in data/media.json. Files live in public/media.
// Every item is the project really running: a screen or terminal recording, or a screenshot of the
// real app when it cannot be run here. A null entry means the project has no demo worth showing.
export interface Media {
  kind: 'video' | 'image';
  src: string;
  poster?: string;    // a frame that shows the result
  thumb?: string;     // 224x140 crop of the telling part, for the leaderboard row
  href?: string;      // what clicking an image opens, when it is not src
  w?: number;
  h?: number;
  alt: string;
  caption: string;
  source: string;     // what was run, on what input, when; shown under the demo
}

const MEDIA = mediaData as Record<string, Media | null>;

export function mediaFor(repo: string): Media | undefined {
  return MEDIA[repo] ?? undefined;
}

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Small preview for a leaderboard row: a crop of the frame that shows the result. Videos play muted
// after the pointer rests on the row.
export function buildThumb(m: Media, hoverTarget: HTMLElement): HTMLElement {
  const box = h('span', { class: `md-thumb md-thumb-${m.kind}`, 'aria-hidden': 'true' },
    h('img', { src: m.thumb ?? m.poster ?? m.src, alt: '', loading: 'lazy', decoding: 'async' }));
  if (m.kind !== 'video') return box;

  box.append(h('i', { class: 'md-thumb-play' }));
  let video: HTMLVideoElement | null = null;
  let timer = 0;
  hoverTarget.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse' || reduced()) return;
    // A short rest first, so rows sliding under a still pointer while scrolling do not start downloads.
    timer = window.setTimeout(() => {
      if (!video) {
        video = h('video', { muted: true, loop: true, playsinline: true, preload: 'none', poster: m.thumb ?? null });
        video.muted = true;
        video.src = m.src;
        box.append(video);
      }
      box.classList.add('is-playing');
      void video.play().catch(() => {});
    }, 250);
  });
  hoverTarget.addEventListener('pointerleave', () => {
    clearTimeout(timer);
    box.classList.remove('is-playing');
    video?.pause();
  });
  return box;
}

// Full demo for the project card. Returns a stop function the card calls when it closes or switches.
export function buildDemo(m: Media): { el: HTMLElement; stop: () => void } {
  const fig = h('figure', { class: `md-demo md-demo-${m.kind}` });
  const ratio = m.w && m.h ? `${m.w} / ${m.h}` : '16 / 10';
  let stop = (): void => {};
  const actions = h('span', { class: 'md-actions' });

  if (m.kind === 'video') {
    const video = h('video', {
      class: 'md-media',
      muted: true,
      loop: true,
      playsinline: true,
      controls: true,
      preload: 'metadata',
      poster: m.poster ?? null,
      'aria-label': m.alt,
      style: `aspect-ratio:${ratio}`,
    });
    video.muted = true;
    video.src = m.src;
    if (!reduced()) {
      video.autoplay = true;
      void video.play().catch(() => {});
    }
    stop = () => video.pause();
    fig.append(video);
    // The card is narrow; terminal text and app screens read properly at full size.
    if (video.requestFullscreen) {
      const full = h('button', { class: 'md-full', type: 'button' }, 'Watch full screen');
      full.addEventListener('click', () => {
        void video.requestFullscreen().then(() => video.play()).catch(() => {});
      });
      actions.append(full);
    }
  } else {
    const tall = m.w && m.h && m.h > m.w * 1.2;
    fig.append(
      h('a', { class: `md-frame${tall ? ' md-tall' : ''}`, href: m.href ?? m.src, target: '_blank', rel: 'noopener', 'aria-label': `${m.alt} Opens full size` },
        h('img', { class: 'md-media', src: m.src, alt: m.alt, loading: 'lazy', decoding: 'async', width: m.w ?? null, height: m.h ?? null })),
    );
  }

  fig.append(
    h('figcaption', { class: 'md-cap' },
      h('span', { class: 'md-cap-text' }, m.caption),
      h('span', { class: 'md-source' }, m.source),
      actions.childElementCount ? actions : null),
  );
  return { el: fig, stop };
}
