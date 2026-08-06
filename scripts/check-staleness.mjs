#!/usr/bin/env node
/**
 * Which recaps are behind the show?
 *
 * A recap is a snapshot of a show at a moment. Shows keep airing, so every
 * recap in the library is drifting out of date on a schedule nobody is
 * watching. This is the thing that watches it.
 *
 * DETERMINISTIC. No model calls, no judgement, no sampling. It compares two
 * numbers — the highest season we hold a spine for, and the highest season
 * TVMaze says has finished airing — and reports the difference. Run it twice on
 * an unchanged library and it says the same thing both times, which is exactly
 * what the audit and cliffhanger checks cannot promise. Treat this as a test
 * that passes or fails; treat those as sweeps.
 *
 * A season counts as FINISHED when its endDate has passed. Mid-season does not
 * count, matching recap_max_season: you recap seasons you have finished, and a
 * season still going out is one nobody is behind on yet.
 *
 * The final season of an ended show is not a gap. See eligibility.mjs — there
 * is no next season to prepare for, so it is excluded here too rather than
 * showing up as permanent unfinishable work.
 *
 * Reads local spine files rather than the database. The upload is driven from
 * those files, so they are what the next upload would ship; a slug present here
 * but absent from recap_shows is a show that was generated and never uploaded,
 * which is worth knowing separately.
 *
 * Usage:
 *   node scripts/check-staleness.mjs
 *   node scripts/check-staleness.mjs --json     # machine-readable work queue
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'src/recap/data');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * TVMaze season lists, politely.
 *
 * One request per show and a short pause between them. The library is a few
 * hundred shows, so this is a minute of wall-clock — cheap enough to run on a
 * schedule and far cheaper than being wrong about what is missing.
 */
async function seasonsOf(tvmazeId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}/seasons`);
      if (res.status === 429) { await sleep(2000); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(1000);
    }
  }
  throw new Error('unreachable');
}

async function main() {
  const asJson = process.argv.includes('--json');
  const today = new Date().toISOString().slice(0, 10);

  const files = await readdir(DIR);
  const slugs = files.filter(f => f.endsWith('.spine.json')).map(f => f.replace('.spine.json', ''));

  const behind = [];
  const errors = [];
  const waiting = [];

  for (const slug of slugs) {
    let data, spine;
    try {
      data = JSON.parse(await readFile(`${DIR}/${slug}.json`, 'utf8'));
      spine = JSON.parse(await readFile(`${DIR}/${slug}.spine.json`, 'utf8'));
    } catch {
      continue; // spine without a dataset — not this script's problem
    }

    const have = Math.max(...Object.keys(spine.seasons ?? {}).map(Number));
    if (!data.tvmazeId) { errors.push({ slug, error: 'no tvmaze id' }); continue; }

    let seasons;
    try {
      seasons = await seasonsOf(data.tvmazeId);
    } catch (err) {
      errors.push({ slug, error: err.message });
      continue;
    }
    await sleep(120);

    // TVMaze numbers a handful of long-running anime by broadcast YEAR rather
    // than by season. Those produce nonsense here (a "season 2017"), and they
    // are shows the episode caps reject anyway, so they are reported apart from
    // the real work rather than drowning it.
    const numbers = seasons.map(s => s.number);
    if (Math.max(...numbers) > 50) { errors.push({ slug, error: `season numbering looks like years (max S${Math.max(...numbers)})` }); continue; }

    const finished = seasons.filter(s => s.endDate && s.endDate < today).map(s => s.number);
    const latestFinished = finished.length ? Math.max(...finished) : 0;

    const ended = /ended|canceled|cancelled/i.test(data.status ?? '');
    const target = ended ? Math.min(latestFinished, Math.max(...numbers) - 1) : latestFinished;

    if (target > have) {
      // Does the dataset already hold usable source for the gap, or is this
      // waiting on Wikipedia? The answer decides whether the next step is
      // "generate" or "nothing yet".
      const missing = [];
      for (let n = have + 1; n <= target; n++) {
        const s = data.seasons?.find(x => x.season === n);
        const withPlot = s ? s.episodes.filter(e => e.plot).length : 0;
        missing.push({ season: n, sourced: s ? `${withPlot}/${s.episodes.length}` : 'not fetched' });
      }
      const ready = missing.every(m => m.sourced !== 'not fetched' && Number(m.sourced.split('/')[0]) > 0);
      (ready ? behind : waiting).push({ slug, title: data.title, have, target, ended, missing });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ behind, waiting, errors }, null, 2));
    return;
  }

  const line = r =>
    `  ${r.slug.padEnd(34)} S${r.have} → S${r.target}${r.ended ? ' (ended)' : ''}  ` +
    r.missing.map(m => `S${m.season} ${m.sourced}`).join(' ');

  console.log(`\nchecked ${slugs.length} shows against TVMaze\n`);
  console.log(`▸ READY TO GENERATE — source already on disk (${behind.length})`);
  behind.forEach(r => console.log(line(r)));
  console.log(`\n▸ WAITING ON SOURCE — re-fetch first, Wikipedia may have caught up (${waiting.length})`);
  waiting.forEach(r => console.log(line(r)));
  if (errors.length) {
    console.log(`\n▸ SKIPPED (${errors.length})`);
    errors.forEach(r => console.log(`  ${r.slug.padEnd(34)} ${r.error}`));
  }
  console.log();
}

main().catch(err => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
