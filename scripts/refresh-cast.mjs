#!/usr/bin/env node
/**
 * Re-pull the cast array for shows already fetched.
 *
 * fetch-recap.mjs kept the top 45 cast members by episode count, which is
 * plenty for a four-season show and badly short for a long one. Cast is ranked
 * by total appearances, so anyone who dominates the early seasons and then
 * leaves sinks below the cut: Sean Bean is in 10 of Game of Thrones' 73
 * episodes, so Ned Stark — the character season 1 is ABOUT — had no photo and
 * no actor credit. The Walking Dead lost Shane Walsh, Sophia, Otis and The
 * Governor the same way.
 *
 * This exists rather than a re-fetch because the two are not equivalent in
 * risk. A full fetch re-downloads every episode image and re-derives the
 * Wikipedia grounding and the season bound, so re-running it over already
 * reviewed content could quietly change the recap itself. This touches one
 * field.
 *
 * Usage:
 *   node scripts/refresh-cast.mjs --all
 *   node scripts/refresh-cast.mjs --slug game-of-thrones
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');

// Deep enough that a one-season character on an eleven-season show is still
// present. Costs disk in a file that never ships, and nothing at all on device.
const CAST_LIMIT = 250;

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

async function loadEnv() {
  const raw = await readFile(resolve(ROOT, '.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const IMG = (size, path) => (path ? `https://image.tmdb.org/t/p/${size}${path}` : null);

async function getJSON(url, init, label) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${label} ${res.status}`);
  return res.json();
}

async function refresh(slug, auth) {
  const path = resolve(DATA, `${slug}.json`);
  const data = JSON.parse(await readFile(path, 'utf8'));
  if (!data.tmdbId) {
    console.log(`  ${slug.padEnd(18)} skipped — no tmdbId`);
    return;
  }

  const credits = await getJSON(
    `https://api.themoviedb.org/3/tv/${data.tmdbId}/aggregate_credits${auth.query ? `?${auth.query}` : ''}`,
    { headers: auth.headers },
    'TMDB credits',
  );
  const tvmazeCast = data.tvmazeId
    ? await getJSON(`https://api.tvmaze.com/shows/${data.tvmazeId}/cast`, {}, 'TVMaze cast').catch(() => [])
    : [];

  const characterImages = new Map();
  for (const c of tvmazeCast) {
    const n = c.character?.name?.toLowerCase();
    const img = c.character?.image?.original;
    if (n && img && !characterImages.has(n)) characterImages.set(n, img);
  }

  const before = data.cast.length;
  data.cast = (credits.cast ?? [])
    .slice(0, CAST_LIMIT)
    .map(c => {
      const character = c.roles?.[0]?.character ?? null;
      return {
        name: c.name,
        character,
        episodeCount: c.total_episode_count ?? 0,
        profile: IMG('original', c.profile_path),
        inCharacter: character ? characterImages.get(character.toLowerCase()) ?? null : null,
      };
    })
    .filter(c => c.profile || c.inCharacter);

  await writeFile(path, JSON.stringify(data, null, 2));
  console.log(`  ${slug.padEnd(18)} cast ${String(before).padStart(3)} → ${data.cast.length}`);
}

async function main() {
  await loadEnv();
  const token = process.env.TMDB_READ_TOKEN;
  const key = process.env.TMDB_API_KEY;
  const auth = token
    ? { headers: { Authorization: `Bearer ${token}` }, query: '' }
    : { headers: {}, query: `api_key=${key}` };
  if (!token && !key) throw new Error('TMDB_READ_TOKEN or TMDB_API_KEY required');

  const slugs = process.argv.includes('--all')
    ? (await readdir(DATA))
        .filter(f => f.endsWith('.json') && !f.includes('spine') && !f.startsWith('_'))
        .map(f => f.replace('.json', ''))
    : [arg('--slug')].filter(Boolean);

  if (!slugs.length) {
    console.error('\n✗ pass --slug <name> or --all\n');
    process.exit(1);
  }

  console.log('');
  for (const slug of slugs) {
    try {
      await refresh(slug, auth);
    } catch (e) {
      console.log(`  ${slug.padEnd(18)} ✗ ${e.message}`);
    }
  }
  console.log('');
}

main().catch(e => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
