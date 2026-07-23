#!/usr/bin/env node
/**
 * Turn a ranked candidate list into a batch manifest.
 *
 * batch-recaps.mjs consumes { slug, show } entries; rank-candidates.mjs emits
 * { title, ... }. This bridges them, and the only real work is the slug, which
 * has two constraints that a naive kebab-case misses:
 *
 *   1. Reuse the slug a show ALREADY has. House of the Dragon is stored as
 *      "hotd", not "house-of-the-dragon"; The Expanse as "expanse", not
 *      "the-expanse". Minting a fresh mechanical slug would re-fetch and
 *      re-generate a show we already hold, under a second slug, and ship it
 *      twice. So existing data files are read first and their title→slug
 *      mapping wins.
 *
 *   2. Never collide. Two titles that kebab to the same slug would have one
 *      silently overwrite the other's data mid-batch. Collisions are detected
 *      and disambiguated with the year rather than left to chance.
 *
 * Ordering is preserved from the candidate list, so the batch generates in
 * rank order and a --limit run does the most-wanted shows first.
 *
 * Usage:
 *   node scripts/build-manifest.mjs --in src/recap/data/_candidates.json --out scripts/batch-manifest.json
 *   node scripts/build-manifest.mjs --limit 50        # first 50 only
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

/** Leading article dropped, lowercased, non-alphanumerics collapsed to dashes. */
const slugify = title =>
  String(title)
    .replace(/^(the|a|an)\s+/i, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents so "Señor" → "senor"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

async function existingSlugByTitle() {
  const map = new Map();
  for (const f of await readdir(DATA)) {
    if (!f.endsWith('.json') || f.includes('.spine') || f.includes('.audit') || f.startsWith('_')) continue;
    try {
      const d = JSON.parse(await readFile(resolve(DATA, f), 'utf8'));
      if (d.title && d.slug) map.set(d.title.toLowerCase(), d.slug);
    } catch {
      // A malformed data file should not sink manifest generation.
    }
  }
  return map;
}

async function main() {
  const inPath = arg('--in', 'src/recap/data/_candidates.json');
  const outPath = arg('--out', 'scripts/batch-manifest.json');
  const limit = arg('--limit') ? Number(arg('--limit')) : Infinity;

  const candidates = JSON.parse(await readFile(resolve(ROOT, inPath), 'utf8'));
  const known = await existingSlugByTitle();

  const used = new Map(); // slug -> title that claimed it
  const manifest = [];
  let reused = 0;
  const collisions = [];

  for (const c of candidates.slice(0, limit)) {
    let slug = known.get(c.title.toLowerCase());
    if (slug) reused++;
    else {
      slug = slugify(c.title);
      // Disambiguate a genuine collision with the year. Only fires between two
      // DIFFERENT titles — a reused slug never reaches here.
      if (used.has(slug) && used.get(slug) !== c.title) {
        const withYear = `${slug}-${c.year}`;
        collisions.push(`${c.title} ↔ ${used.get(slug)} → ${withYear}`);
        slug = withYear;
      }
    }
    used.set(slug, c.title);
    manifest.push({ slug, show: c.title });
  }

  // { shows: [...] } to match validation-set.json, which the runner reads as
  // manifest.shows. rank order is preserved so a --limit run does the
  // most-wanted shows first.
  await writeFile(resolve(ROOT, outPath), JSON.stringify({ shows: manifest }, null, 2));

  console.log(`\n  ${manifest.length} shows → ${outPath}`);
  console.log(`  ${reused} reuse an existing slug, ${manifest.length - reused} new`);
  if (collisions.length) {
    console.log(`\n  ${collisions.length} slug collision(s) disambiguated by year:`);
    for (const c of collisions) console.log(`    ${c}`);
  }
  console.log('');
}

main().catch(e => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
