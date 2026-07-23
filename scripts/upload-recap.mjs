#!/usr/bin/env node
/**
 * Compose a generated recap into finished frames and upload it.
 *
 * WHY COMPOSITION HAPPENS HERE AND NOT ON THE DEVICE
 *
 * Pairing a beat with a picture involves guesswork. The spine names
 * "Deputy Billings"; the cast list has "Paul Billings". Matching those is
 * fuzzy, and a wrong match puts the wrong face on screen. Doing it here means
 * the exact image URLs are frozen in the database, so what you approve during
 * review is byte-for-byte what every user sees — a bad match is a row you can
 * fix, not a surprise that only ever happens on someone else's phone. It also
 * means the device does no work beyond rendering, and downloads less.
 *
 * The cost is that changing how frames are built requires re-running this
 * script rather than shipping an app update. That is one command over a few
 * dozen shows, which is the cheaper side of the trade.
 *
 * This script is the ONLY place composition happens. src/recap/build.ts did it
 * at render time; keeping both would guarantee drift.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY — the recap tables are deliberately
 * read-only to clients, so the anon key cannot write them. That variable must
 * never gain an EXPO_PUBLIC_ prefix: it would be inlined into the shipped
 * bundle, handing every user full read/write on the database.
 *
 * Usage:
 *   node scripts/upload-recap.mjs --slug silo
 *   node scripts/upload-recap.mjs --all
 *   node scripts/upload-recap.mjs --slug silo --dry-run
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');

// Scrim opacity per frame kind. A title card sits over key art and needs
// almost none; a character card is mostly face and needs just enough to keep
// the caption legible; a portrait-less card falls back to key art and needs
// considerably more because the copy lands on a busy scene.
const DIM = { title: 0.15, premise: 0.45, character: 0.28, characterNoPortrait: 0.55, beat: 0.18, cliffhanger: 0.3 };

// ---------------------------------------------------------------- env

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

// ---------------------------------------------------------------- matching

const STRIP_TITLES =
  /^(sheriff|deputy|judge|mayor|dr\.?|doctor|mr\.?|mrs\.?|ms\.?|captain|cap|chief|admiral|secretary|gunnery sergeant|sgt\.?|lt\.?|colonel|commander)\s+/i;

const tokens = s =>
  s
    .replace(STRIP_TITLES, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(t => t.length > 2);

function composer(data) {
  const keyArt = data.backdrop ?? data.backdrops?.[0] ?? data.poster;

  /**
   * Spine names and cast names do not share a vocabulary — the spine writes
   * "Sims", the cast has "Robert Sims". Exact matching drops roughly half the
   * cards, so fall back to a shared significant token, which is almost always
   * the surname and specific enough not to collide inside one show's cast.
   */
  const castRowFor = name => {
    const want = tokens(name);
    if (!want.length) return null;
    const exact = data.cast.find(c => c.character && tokens(c.character).join(' ') === want.join(' '));
    if (exact) return exact;
    return (
      data.cast.find(c => {
        if (!c.character) return false;
        const have = tokens(c.character);
        return want.some(w => have.includes(w));
      }) ?? null
    );
  };

  /**
   * Prefer the CHARACTER over the ACTOR. TMDB profiles are red-carpet
   * headshots that frequently bear no resemblance to the role, which is
   * exactly wrong when the card's whole job is "remind me who this is".
   * TVMaze carries in-costume stills for part of the cast; those win.
   */
  const portraitOf = name => {
    const row = castRowFor(name);
    return row?.inCharacter ?? row?.profile ?? null;
  };

  /**
   * A still for an episode, preferring one not already spoken for. A finale
   * routinely carries two beats plus the cliffhanger, which rendered three
   * consecutive frames with an identical picture. Falls back to the primary
   * still once the pool is exhausted — a repeat in context still beats
   * generic key art.
   */
  const freshStill = (season, episode, used) => {
    if (episode == null) return keyArt;
    const ep = data.seasons.find(s => s.season === season)?.episodes.find(e => e.episode === episode);
    if (!ep) return keyArt;
    const pool = (ep.stills?.length ? ep.stills : [ep.still]).filter(Boolean);
    const chosen = pool.find(u => !used.has(u)) ?? ep.still ?? keyArt;
    used.add(chosen);
    return chosen;
  };

  return { keyArt, castRowFor, portraitOf, freshStill };
}

/**
 * Beats in chronological order.
 *
 * The generator is asked for chronological order and does not reliably
 * deliver it — one Silo season came back E1,E4,E6,E9,E8,E7,E10, which reads
 * as a jumbled story and defeats the point of a causal spine. Ordering is
 * objectively checkable, so it is enforced rather than left to the prompt.
 * Beats with no valid anchor sort last rather than first.
 */
function orderedBeats(seasonEntry) {
  const sorted = [...(seasonEntry.beats ?? [])].sort(
    (a, b) => (a.anchorEpisode ?? 99) - (b.anchorEpisode ?? 99),
  );
  return seasonEntry.revealBeat ? [...sorted, seasonEntry.revealBeat] : sorted;
}

// ---------------------------------------------------------------- compose

function composeShow(data, spine) {
  const { keyArt, castRowFor, portraitOf, freshStill } = composer(data);

  const show = {
    slug: data.slug,
    show_id: String(data.showId ?? data.tvmazeId ?? ''),
    title: data.title,
    overview: data.overview,
    network: data.network,
    poster: data.poster,
    backdrop: keyArt,
    total_seasons: data.totalSeasons,
    through_season: Math.max(...Object.keys(spine.seasons).map(Number)),
    generated_at: new Date().toISOString(),
  };

  const seasons = Object.entries(spine.seasons).map(([n, entry]) => {
    const season = Number(n);
    const used = new Set();
    const episodes = data.seasons.find(s => s.season === season)?.episodes ?? [];

    const beats = orderedBeats(entry).map(b => ({
      label: b.label,
      text: b.text,
      image: freshStill(season, b.anchorEpisode, used),
      dim: DIM.beat,
    }));

    const characters = (entry.characters ?? []).map(c => {
      const portrait = portraitOf(c.name);
      return {
        name: c.name,
        // The generator returns a role sentence, never a performer. Actor
        // credit comes from the matched cast row.
        actor: castRowFor(c.name)?.name ?? '',
        line: c.line,
        note: c.note ?? null,
        image: portrait ?? keyArt,
        dim: portrait ? DIM.character : DIM.characterNoPortrait,
      };
    });

    const cliffhanger = entry.cliffhanger
      ? {
          text: entry.cliffhanger.text,
          questions: entry.cliffhanger.questions ?? [],
          image: freshStill(season, episodes.length || null, used),
          dim: DIM.cliffhanger,
        }
      : null;

    return {
      slug: data.slug,
      season,
      beats,
      cliffhanger,
      characters,
      // Feeds recap_max_season: "has this viewer finished season N" is exact
      // arithmetic only if the season's length is known, and the database has
      // no other trustworthy source for older seasons.
      episode_count: episodes.length || null,
    };
  });

  return { show, seasons };
}

// ---------------------------------------------------------------- report

function report(slug, show, seasons) {
  const missingPortrait = seasons.flatMap(s =>
    s.characters.filter(c => c.image === show.backdrop).map(c => `S${s.season} ${c.name}`),
  );
  const missingActor = seasons.flatMap(s =>
    s.characters.filter(c => !c.actor).map(c => `S${s.season} ${c.name}`),
  );
  const beatCount = seasons.reduce((a, s) => a + s.beats.length, 0);

  console.log(`\n▸ ${show.title} (${slug})`);
  console.log(`  show_id ${show.show_id || '⚠ MISSING'} · seasons ${seasons.map(s => s.season).join(',')} · ${beatCount} beats`);
  console.log(`  episode counts: ${seasons.map(s => `S${s.season}:${s.episode_count ?? '?'}`).join(' ')}`);

  // Both of these degrade quietly rather than failing, so they are surfaced
  // here — a character card falling back to key art is the single most
  // visible composition failure and is easy to miss in a list of successes.
  if (missingPortrait.length) console.log(`  ⚠ no portrait (using key art): ${missingPortrait.join(', ')}`);
  if (missingActor.length) console.log(`  ⚠ no actor matched: ${missingActor.join(', ')}`);
  if (!missingPortrait.length && !missingActor.length) console.log('  ✓ every character matched a cast photo and actor');
}

// ---------------------------------------------------------------- main

async function main() {
  await loadEnv();
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const all = argv.includes('--all');
  const slugArg = argv.indexOf('--slug') >= 0 ? argv[argv.indexOf('--slug') + 1] : null;

  const slugs = all
    ? [...new Set((await readdir(DATA)).filter(f => f.endsWith('.spine.json')).map(f => f.replace('.spine.json', '')))]
    : slugArg
      ? [slugArg]
      : [];

  if (!slugs.length) {
    console.error('\n✗ pass --slug <name> or --all\n');
    process.exit(1);
  }

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!url || !key)) {
    console.error('\n✗ EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set\n');
    process.exit(1);
  }
  const db = dryRun ? null : createClient(url, key, { auth: { persistSession: false } });

  for (const slug of slugs) {
    const data = JSON.parse(await readFile(resolve(DATA, `${slug}.json`), 'utf8'));
    const spine = JSON.parse(await readFile(resolve(DATA, `${slug}.spine.json`), 'utf8'));
    const { show, seasons } = composeShow(data, spine);

    report(slug, show, seasons);

    if (!show.show_id) {
      console.error(`  ✗ ${slug} has no TVMaze id — it could not join to user_shows, so the season cap would read 0 and no one would see it. Re-run fetch-recap.mjs.`);
      continue;
    }
    if (dryRun) {
      console.log('  (dry run — nothing written)');
      continue;
    }

    const { error: showErr } = await db.from('recap_shows').upsert(show, { onConflict: 'slug' });
    if (showErr) {
      console.error(`  ✗ recap_shows: ${showErr.message}`);
      continue;
    }
    const { error: seasonErr } = await db.from('recap_seasons').upsert(seasons, { onConflict: 'slug,season' });
    if (seasonErr) {
      console.error(`  ✗ recap_seasons: ${seasonErr.message}`);
      continue;
    }
    console.log(`  ✓ uploaded ${seasons.length} season(s)`);
  }
  console.log('');
}

main().catch(err => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
