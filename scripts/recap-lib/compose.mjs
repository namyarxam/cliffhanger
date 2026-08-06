// Compose a spine into finished frames: every image URL and scrim value
// frozen here, so what is approved at review is byte-for-byte what every user
// sees. The device does no work beyond rendering.
//
// Ported from the retired upload-recap.mjs. The matching rules in here are the
// accumulated record of every wrong-face bug the first library shipped:
// token-rarity scoring (Rhaenyra vs the first Targaryen in the list),
// episode-weight tie-breaks (Ned Stark vs the flashback boys), the animated
// rule (a voice actor's face is never the character), slash-name splitting
// (Helly R. / Helena Eagan), and one-person-one-card dedupe.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WORK } from './env.mjs';
import { bestMatch, tokens } from './name-match.mjs';

/**
 * Most character cards shown before the story starts. The stored list stays as
 * long as coherence demands; the recap shows the front of it. Safe to truncate
 * because the list is ordered by how badly the viewer needs each person.
 */
const MAX_CHARACTER_CARDS = 8;

/** Sentinel in _cast-images.json meaning "this card should not exist". */
const DROP = 'drop';

// Scrim opacity per frame kind: low when the picture is doing real work, high
// when the background is only atmosphere.
const DIM = { title: 0.15, character: 0.28, characterNoPortrait: 0.55, beat: 0.18, cliffhanger: 0.3 };

/**
 * Hand-sourced portraits for cards nothing automatic can picture — the only
 * route to a face on an animated show TVMaze has no art for, and the escape
 * hatch when a row resolves to the wrong picture. Optional.
 */
export async function loadCastImages() {
  try {
    const raw = JSON.parse(await readFile(resolve(WORK, '_cast-images.json'), 'utf8'));
    delete raw._readme;
    for (const show of Object.keys(raw))
      for (const [k, v] of Object.entries(raw[show])) if (!v) delete raw[show][k];
    return raw;
  } catch {
    return {};
  }
}

function composer(data, castLinks, imageOverrides = {}) {
  const keyArt = data.backdrop ?? data.backdrops?.[0] ?? data.poster;

  // Animation changes what a valid portrait IS: the voice actor's face has no
  // relation to the drawn character, so an animated show never falls back to a
  // profile photo — character art or key art, nothing between.
  const animated =
    data.showType === 'Animation' || (data.genres ?? []).some(g => /animation|anime/i.test(g));

  // Explicit links frozen into the spine — pairs no string comparison can
  // reach ("The Governor" is credited as Philip Blake). Consulted before the
  // algorithm.
  const linked = name => {
    const link = castLinks[name];
    if (!link) return null;
    return data.cast.find(c => c.name === link.actor && c.character === link.character) ?? null;
  };

  const owners = new Map();
  for (const c of data.cast) {
    if (!c.character) continue;
    for (const t of new Set(tokens(c.character))) owners.set(t, (owners.get(t) ?? 0) + 1);
  }

  const castCandidates = data.cast
    .filter(c => c.character)
    .map(c => ({ name: c.character, weight: c.episodeCount ?? 0, row: c }));

  const castRowFor = name => {
    const explicit = linked(name);
    if (explicit) return explicit;
    // "Helly R. / Helena Eagan" is one person written two ways — match each
    // side as a whole name.
    const parts = String(name).split(/\s*\/\s*/).map(x => x.trim()).filter(Boolean);
    if (parts.length > 1) {
      for (const p of parts) {
        const hit = castRowFor(p);
        if (hit) return hit;
      }
      return null;
    }
    // Scoring lives in name-match.mjs, not here — the fork that module was
    // written to end. Where nothing clears the bar the answer is nothing:
    // a card with no portrait reads as unremarkable; a card with the wrong
    // face and the wrong actor's name is a lie.
    return bestMatch(name, castCandidates, owners)?.row ?? null;
  };

  // Prefer the CHARACTER over the ACTOR; hand-sourced override outranks both.
  const portraitOf = name => {
    const override = imageOverrides[name];
    if (override === DROP) return null;
    if (override) return override;
    const row = castRowFor(name);
    if (animated) return row?.inCharacter ?? null;
    return row?.inCharacter ?? row?.profile ?? null;
  };

  // A still not already spoken for — consecutive frames should not repeat a
  // picture while the pool has others.
  const freshStill = (season, episode, used) => {
    if (episode == null) return keyArt;
    const ep = data.seasons.find(s => s.season === season)?.episodes.find(e => e.episode === episode);
    if (!ep) return keyArt;
    const pool = (ep.stills?.length ? ep.stills : [ep.still]).filter(Boolean);
    const chosen = pool.find(u => !used.has(u)) ?? ep.still ?? keyArt;
    used.add(chosen);
    return chosen;
  };

  const isDropped = name => imageOverrides[name] === DROP;

  return { keyArt, castRowFor, portraitOf, freshStill, isDropped };
}

/**
 * Beats in chronological order — asked of the generator, not reliably
 * delivered, and objectively checkable, so enforced. No-anchor beats sort last.
 */
function orderedBeats(entry) {
  return [...(entry.beats ?? [])].sort((a, b) => (a.anchorEpisode ?? 99) - (b.anchorEpisode ?? 99));
}

/**
 * Compose one show. `spineSeasons` is { [n]: entry }. `throughSeason` may be
 * passed explicitly (extend composes only the NEW seasons, but through_season
 * must still cover the existing ones); defaults to the max composed season.
 */
export function composeShow(data, spineSeasons, { imageOverrides = {}, castLinks = {}, throughSeason = null } = {}) {
  const { keyArt, castRowFor, portraitOf, freshStill, isDropped } = composer(data, castLinks, imageOverrides);

  const composedMax = Math.max(...Object.keys(spineSeasons).map(Number));
  const show = {
    slug: data.slug,
    show_id: String(data.tvmazeId ?? ''),
    title: data.title,
    overview: data.overview,
    network: data.network,
    poster: data.poster,
    backdrop: keyArt,
    total_seasons: data.totalSeasons,
    through_season: Math.max(composedMax, throughSeason ?? 0),
    generated_at: new Date().toISOString(),
  };

  const seasons = Object.entries(spineSeasons).map(([n, entry]) => {
    const season = Number(n);
    const used = new Set();
    const episodes = data.seasons.find(s => s.season === season)?.episodes ?? [];

    const beats = orderedBeats(entry).map(b => ({
      label: b.label,
      text: b.text,
      image: freshStill(season, b.anchorEpisode, used),
      dim: DIM.beat,
    }));

    // One person, one card. Only detectable once both names resolve to the
    // same cast member, which is why the dedupe lives here. Earlier card wins
    // (list is ordered most-essential-first); unmatched cards are never
    // treated as duplicates of each other.
    const claimed = new Set();
    const deduped = [];
    for (const c of entry.characters ?? []) {
      const row = castRowFor(c.name);
      const key = row ? `${row.name}|${row.character}` : null;
      if (key && claimed.has(key)) continue;
      if (key) claimed.add(key);
      deduped.push(c);
    }

    // Drop the TRAILING run of unpicturable cards — what falls off the end is
    // the least load-bearing. A faceless card ranked above a pictured one is
    // kept: cutting it would leave a hole in a meaningful order.
    const kept = deduped.filter(c => !isDropped(c.name));
    const picked = kept.slice(0, MAX_CHARACTER_CARDS);
    let end = picked.length;
    while (end > 0 && !portraitOf(picked[end - 1].name)) end--;

    const characters = picked.slice(0, end).map(c => {
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
      // Feeds recap_max_season, which does exact arithmetic against it.
      episode_count: episodes.length || null,
    };
  });

  return { show, seasons };
}

/** Human-readable composition report; the quiet degradations surfaced. */
export function reportComposition(show, seasons) {
  const missingPortrait = seasons.flatMap(s =>
    s.characters.filter(c => c.image === show.backdrop).map(c => `S${s.season} ${c.name}`),
  );
  const missingActor = seasons.flatMap(s =>
    s.characters.filter(c => !c.actor).map(c => `S${s.season} ${c.name}`),
  );
  const beatCount = seasons.reduce((a, s) => a + s.beats.length, 0);

  console.log(`\n▸ Composed ${show.title} (${show.slug})`);
  console.log(
    `  show_id ${show.show_id || '⚠ MISSING'} · seasons ${seasons.map(s => s.season).join(',')} · ${beatCount} beats · through_season ${show.through_season}`,
  );
  console.log(`  episode counts: ${seasons.map(s => `S${s.season}:${s.episode_count ?? '?'}`).join(' ')}`);
  if (missingPortrait.length) console.log(`  ⚠ no portrait (using key art): ${missingPortrait.join(', ')}`);
  if (missingActor.length) console.log(`  ⚠ no actor matched: ${missingActor.join(', ')}`);
  if (!missingPortrait.length && !missingActor.length)
    console.log('  ✓ every character matched a cast photo and actor');
}
