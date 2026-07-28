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
import { evaluate } from './eligibility.mjs';
import { tokens } from './name-match.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');

// Scrim opacity per frame kind. A title card sits over key art and needs
// almost none; a character card is mostly face and needs just enough to keep
// the caption legible; a portrait-less card falls back to key art and needs
// considerably more because the copy lands on a busy scene.
/**
 * Most character cards shown before the story starts.
 *
 * The stored list is as long as coherence demands — Game of Thrones season 1
 * genuinely needs twelve people to match its beats, and cutting that list at
 * the source would put the omissions back. But twelve full-screen cards before
 * a single plot beat is a slog, and the pacing that made Silo work was six.
 *
 * So the two concerns are separated: the data stays complete and checkable,
 * and the recap shows the front of it. Safe to truncate because the repair
 * pass orders by how badly the viewer needs each person, so what falls off the
 * end is always the least load-bearing.
 */
const MAX_CHARACTER_CARDS = 8;

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

// Tokeniser is shared with fetch-recap and audit-spine via name-match.mjs, so
// the three stages agree on who a name resolves to. It used to be forked here,
// which is how a fix to short names and "(voice)" role qualifiers reached the
// fetch-time linking but not this composition step — Vi ended up with a still
// on disk and no still on her card.

function composer(data, castLinks) {
  const keyArt = data.backdrop ?? data.backdrops?.[0] ?? data.poster;

  // Whether this is an animated show, which changes what a valid portrait IS.
  //
  // For live action a TMDB actor headshot is a poor-but-real fallback: it is
  // still the person. For animation it is a category error — the voice actor's
  // face has no relation to the drawn character, so Steven Yeun appears on
  // Mark Grayson's card. There is no "close enough" version of that, so an
  // animated show must NEVER fall back to a profile photo; the only valid
  // portrait is the character art itself (TVMaze), and its absence means key
  // art, not a headshot.
  //
  // Detected from both the TVMaze type and the genres because neither is
  // complete alone: anime is typed 'Scripted' by TVMaze but genre-tagged
  // 'Anime', and some Western cartoons carry the type but not the genre.
  const animated =
    data.showType === 'Animation' ||
    (data.genres ?? []).some(g => /animation|anime/i.test(g));

  /**
   * Explicit links, resolved once by scripts/link-cast.mjs and frozen into the
   * spine. These are the pairs no string comparison can reach, because the
   * recap calls someone by a name the credits never use: "The Governor" is
   * credited as Philip Blake, "Arnold" as Bernard Lowe. Consulted before the
   * algorithm, since a decision already made deliberately should not be
   * re-derived by a heuristic that was unable to make it.
   */
  const linked = name => {
    const link = castLinks[name];
    if (!link) return null;
    return data.cast.find(c => c.name === link.actor && c.character === link.character) ?? null;
  };

  // How many cast members each name token belongs to. A token shared by
  // several people carries no identifying information.
  const tokenOwners = new Map();
  for (const c of data.cast) {
    if (!c.character) continue;
    for (const t of new Set(tokens(c.character))) {
      tokenOwners.set(t, (tokenOwners.get(t) ?? 0) + 1);
    }
  }

  /**
   * Match a spine character name to a cast row.
   *
   * The vocabularies differ — the spine writes "Rhaenyra Targaryen", the cast
   * has "Princess Rhaenyra Targaryen" — so this cannot be an exact comparison.
   * But the previous version fell back to "share ANY token and take the first
   * hit", which on House of the Dragon matched Rhaenyra to the first Targaryen
   * in the list and put Matt Smith's face and credit on her card. Every show
   * with a dynasty had the same hole: one Stark absorbing all the Starks.
   *
   * A surname is not an identifier when twelve people share it, so candidates
   * are scored by token RARITY: a shared token counts for 1/(number of cast
   * members carrying it). Matching only on "Stark" among twelve Starks scores
   * 0.083 and is refused.
   *
   * Rarity alone is not enough either, because a deep cast list carries
   * variants of the same person — "Lord Eddard 'Ned' Stark", "Young Ned Stark"
   * and "Young Ned" are three separate credits, which dilutes "ned" to a third
   * and drags the real Ned below any fixed threshold. So the ranking also
   * weighs how much of the show each candidate is actually in: Sean Bean has
   * ten episodes, the flashback boys have one apiece. Log-scaled, so presence
   * breaks ties between plausible candidates without letting a series regular
   * win on volume alone against a genuine name match.
   *
   * Where nothing clears the bar the answer is nothing at all. A card with no
   * portrait falls back to key art and reads as unremarkable; a card with the
   * wrong face and the wrong actor's name is a straightforward lie — which is
   * what shipped for Rhaenyra Targaryen, credited to Matt Smith.
   */
  const castRowFor = name => {
    const explicit = linked(name);
    if (explicit) return explicit;

    // "Helly R. / Helena Eagan" is one person written two ways. Each side is a
    // whole name and is matched separately — read as a single string, the
    // surname rule misreads which token is the family name, and "Gemma Scout /
    // Ms. Casey" matched Mark Scout.
    const parts = String(name).split(/\s*\/\s*/).map(x => x.trim()).filter(Boolean);
    if (parts.length > 1) {
      for (const p of parts) {
        const hit = castRowFor(p);
        if (hit) return hit;
      }
      return null;
    }

    const want = tokens(name);
    if (!want.length) return null;

    const exact = data.cast.find(c => c.character && tokens(c.character).join(' ') === want.join(' '));
    if (exact) return exact;

    // A surname alone never identifies anyone — "Helena Eagan" matched "Jame
    // Eagan", her father, because Helena is credited as Helly Riggs so "eagan"
    // belonged to one cast member and read as distinctive. A match must share
    // something other than the last token.
    const identifying = want.length > 1 ? new Set(want.slice(0, -1)) : new Set(want);

    let best = null;
    let bestScore = 0;
    for (const c of data.cast) {
      if (!c.character) continue;
      const have = new Set(tokens(c.character));
      const shared = want.filter(w => have.has(w));
      if (!shared.length) continue;
      if (!shared.some(w => identifying.has(w))) continue;
      // Rarer tokens are worth more: a unique given name outweighs a surname
      // half the cast carries. A match resting only on "Stark" among eight
      // Starks scores 0.125 and is refused; "Rhaenyra" scores 1.
      const rarity = shared.reduce((a, w) => a + 1 / (tokenOwners.get(w) ?? 1), 0);
      // Floor on rarity alone: a token carried by more than five cast members
      // identifies nobody, however many episodes the candidate appears in.
      if (rarity < 0.2) continue;
      const score = rarity * Math.log1p(c.episodeCount ?? 0);
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  };

  /**
   * Prefer the CHARACTER over the ACTOR. TMDB profiles are red-carpet
   * headshots that frequently bear no resemblance to the role, which is
   * exactly wrong when the card's whole job is "remind me who this is".
   * TVMaze carries in-costume stills for part of the cast; those win.
   *
   * On animated shows the actor fallback is dropped entirely: a voice actor's
   * face is never the character, so a missing character image resolves to key
   * art rather than a headshot. See `animated` above.
   */
  const portraitOf = name => {
    const row = castRowFor(name);
    if (animated) return row?.inCharacter ?? null;
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
  const { keyArt, castRowFor, portraitOf, freshStill } = composer(data, spine.castLinks ?? {});

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

    // One person, one card.
    //
    // A season can name the same character two ways — Severance's spine lists
    // both "Helly R." and "Helena Eagan", who are the same woman, and rendered
    // two cards with two slightly different descriptions back to back. They
    // are only detectable as one person once both resolve to the same cast
    // member, which is why this lives here rather than in the spine: it is the
    // matching that reveals the duplicate.
    //
    // The earlier card wins, since the list is ordered by how badly the viewer
    // needs each person. Unmatched cards are never treated as duplicates of
    // each other — two people who both failed to match are not the same
    // person.
    const claimed = new Set();
    const deduped = [];
    for (const c of entry.characters ?? []) {
      const row = castRowFor(c.name);
      const key = row ? `${row.name}|${row.character}` : null;
      if (key && claimed.has(key)) continue;
      if (key) claimed.add(key);
      deduped.push(c);
    }

    const characters = deduped.slice(0, MAX_CHARACTER_CARDS).map(c => {
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
    // Eligibility is re-checked at the last possible moment, not trusted from
    // the batch run. A spine on disk only means it was generated once; the
    // rules have already changed under it more than once (anthologies became a
    // rejection after Fargo and The White Lotus were generated), and this is
    // the only gate standing between a rejected show and real users.
    const verdict = evaluate(data);
    if (!verdict.ok) {
      console.log(`\n▸ ${data.title} (${slug})`);
      for (const r of verdict.reasons) console.log(`  ✗ NOT ELIGIBLE: ${r}`);
      continue;
    }

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
