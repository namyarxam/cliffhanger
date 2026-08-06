#!/usr/bin/env node
/**
 * Does the database actually hold what we think we shipped?
 *
 * Every quality check in this pipeline reads local files. None of them has ever
 * looked at Supabase. That gap matters because composition and upload happen in
 * one step: what you approve in review is what SHOULD ship byte-for-byte, but
 * "should" is an assumption nobody has tested, and the whole silent-truncation
 * class came from exactly this shape of assumption — a stage reporting success
 * without anything comparing its output to its input.
 *
 * DETERMINISTIC. No model calls. Every finding is an arithmetic disagreement
 * between two sources of truth, so it converges: fix them and the next run is
 * silent. Contrast audit-spine, which samples and never converges.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY for the same reason the uploader does: the
 * recap tables are readable only to authenticated roles, and this runs headless.
 *
 * Usage:
 *   node scripts/check-shipped.mjs
 *   node scripts/check-shipped.mjs --verbose   # list every show, not just breaks
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'src/recap/data');

async function loadEnv() {
  try {
    const raw = await readFile(resolve(ROOT, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* fall back to the ambient environment */
  }
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  await loadEnv();

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('\n✗ EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set\n');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: shows, error: showErr } = await db
    .from('recap_shows')
    .select('slug, show_id, title, total_seasons, through_season');
  if (showErr) throw new Error(`recap_shows: ${showErr.message}`);

  // Seasons come back in pages; the default PostgREST ceiling would silently
  // truncate a library this size, which is the very failure mode being audited.
  const seasons = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('recap_seasons')
      .select('slug, season, beats, characters, cliffhanger, episode_count')
      .range(from, from + 999);
    if (error) throw new Error(`recap_seasons: ${error.message}`);
    seasons.push(...data);
    if (data.length < 1000) break;
  }

  const bySlug = new Map();
  for (const s of seasons) {
    if (!bySlug.has(s.slug)) bySlug.set(s.slug, []);
    bySlug.get(s.slug).push(s);
  }

  const files = await readdir(DIR);
  const localSlugs = files.filter(f => f.endsWith('.spine.json')).map(f => f.replace('.spine.json', ''));

  const breaks = [];
  const note = (slug, kind, detail) => breaks.push({ slug, kind, detail });

  for (const show of shows) {
    const rows = (bySlug.get(show.slug) ?? []).sort((a, b) => a.season - b.season);
    const dbSeasons = rows.map(r => r.season);

    // --- 1. through_season must equal the seasons actually present ----------
    // This is the number the UI renders ("covers S1-S4 of 6") and the ceiling
    // get_recap clamps to. If it exceeds what is stored, a viewer entitled to a
    // season gets an empty response and the recap looks broken.
    const maxDb = dbSeasons.length ? Math.max(...dbSeasons) : 0;
    if (show.through_season !== maxDb) {
      note(show.slug, 'through_season', `claims S${show.through_season}, holds S${maxDb || 'none'}`);
    }

    // --- 2. no gaps ---------------------------------------------------------
    // A gap cannot be skipped: season 4 makes no sense to someone never told
    // what happened in season 3.
    const gaps = [];
    for (let n = 1; n <= maxDb; n++) if (!dbSeasons.includes(n)) gaps.push(n);
    if (gaps.length) note(show.slug, 'season gap', `missing S${gaps.join(',S')} below S${maxDb}`);

    // --- 3. the database must agree with the file it was built from ---------
    let spine = null;
    try {
      spine = JSON.parse(await readFile(`${DIR}/${show.slug}.spine.json`, 'utf8'));
    } catch {
      note(show.slug, 'no local spine', 'shipped, but no spine file on disk to verify against');
    }
    if (spine) {
      const localSeasons = Object.keys(spine.seasons ?? {}).map(Number).sort((a, b) => a - b);
      const onlyLocal = localSeasons.filter(n => !dbSeasons.includes(n));
      if (onlyLocal.length) note(show.slug, 'not uploaded', `spine has S${onlyLocal.join(',S')}, database does not`);
      const onlyDb = dbSeasons.filter(n => !localSeasons.includes(n));
      if (onlyDb.length) note(show.slug, 'orphan season', `database has S${onlyDb.join(',S')}, spine does not`);
    }

    // --- 4. episode_count feeds the spoiler cap -----------------------------
    // recap_max_season decides "has this viewer finished season N" by exact
    // arithmetic against this number. Null or zero and the cap cannot compute.
    const badCount = rows.filter(r => !r.episode_count).map(r => r.season);
    if (badCount.length) note(show.slug, 'episode_count', `null/zero on S${badCount.join(',S')} — the season cap reads this`);

    // --- 5. every frame needs its image -------------------------------------
    for (const r of rows) {
      const beats = Array.isArray(r.beats) ? r.beats : [];
      if (!beats.length) note(show.slug, 'empty season', `S${r.season} has no beats`);
      const imageless = beats.filter(b => !b.image).length;
      if (imageless) note(show.slug, 'beat without image', `S${r.season}: ${imageless} of ${beats.length}`);
      if (!r.cliffhanger?.text) note(show.slug, 'no cliffhanger', `S${r.season}`);
    }
  }

  // --- 6. generated but never shipped ---------------------------------------
  const shipped = new Set(shows.map(s => s.slug));
  const neverUploaded = localSlugs.filter(s => !shipped.has(s));

  // ---------------------------------------------------------------- report
  console.log(`\n  database: ${shows.length} shows · ${seasons.length} seasons`);
  console.log(`  on disk:  ${localSlugs.length} spines\n`);

  if (verbose) {
    for (const show of shows) {
      const rows = bySlug.get(show.slug) ?? [];
      console.log(`  ${show.slug.padEnd(38)} S1-S${show.through_season} of ${show.total_seasons ?? '?'} · ${rows.length} rows`);
    }
    console.log();
  }

  if (breaks.length) {
    console.log(`▸ ${breaks.length} INVARIANT BREAK(S)\n`);
    const byKind = {};
    for (const b of breaks) (byKind[b.kind] ??= []).push(b);
    for (const [kind, list] of Object.entries(byKind)) {
      console.log(`  ${kind} (${list.length})`);
      for (const b of list) console.log(`    ${b.slug.padEnd(38)} ${b.detail}`);
      console.log();
    }
  } else {
    console.log('▸ all invariants hold\n');
  }

  if (neverUploaded.length) {
    console.log(`▸ generated but never uploaded (${neverUploaded.length})`);
    console.log(`    ${neverUploaded.join(', ')}\n`);
  }

  if (breaks.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
