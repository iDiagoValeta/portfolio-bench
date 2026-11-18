import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const media = JSON.parse(readFileSync(new URL('../data/media.json', import.meta.url), 'utf8'));
const { projects } = JSON.parse(readFileSync(new URL('../src/data/projects.json', import.meta.url), 'utf8'));
const pub = (p) => new URL(`../public/${p}`, import.meta.url);

test('every curated project is reviewed: a proof, or null when there is none worth showing', () => {
  const missing = projects.map((p) => p.repo).filter((r) => !(r in media));
  assert.deepEqual(missing, []);
});

test('every media file exists and every entry says what it is and where it comes from', () => {
  for (const [repo, m] of Object.entries(media)) {
    if (m === null) continue;
    assert.ok(['video', 'image'].includes(m.kind), `${repo}: kind`);
    for (const key of ['src', 'poster', 'thumb', 'href']) if (m[key]) assert.ok(existsSync(pub(m[key])), `${repo}: ${m[key]} missing`);
    for (const key of ['alt', 'caption', 'source']) assert.ok(m[key]?.trim(), `${repo}: ${key} empty`);
  }
});
