// Generic recap builder — composes a show's fetched data + generated spine
// into frames for any requested season range.
//
// PIPELINE
//   1. fetch-recap.mjs    → data/<slug>.json        facts: episodes, plots, images, cast
//   2. generate-spine.mjs → data/<slug>.spine.json  judgement: causal beats, anchors, cliffhangers
//   3. this file                                    composes those into frames
//
// The split is deliberate. Plot facts are grounded in Wikipedia episode
// summaries so they can't be hallucinated; the editorial layer decides which
// events are load-bearing and which episode should illustrate each one. See the
// long note at the top of generate-spine.mjs for why we ask for a causal SPINE
// rather than "the most important scenes" — a highlight reel optimises for
// peaks, a recap optimises for comprehension, and those select different beats.
//
// Nothing here is show-specific: every show goes through this same builder, so
// adding one is a data drop plus a registry line.

import type { RecapFrame, RecapMeta, SeasonRange } from './types';
import { rangeLabel } from './types';

// --- shapes of the generated files ------------------------------------------

type CastRow = {
  name: string;
  character: string | null;
  episodeCount: number;
  profile: string | null;
  /** In-costume still from TVMaze; null where TVMaze has no character image. */
  inCharacter?: string | null;
};

type EpisodeRow = {
  episode: number;
  name: string;
  overview: string | null;
  plot?: string | null;
  airDate: string | null;
  still: string | null;
  stills?: string[];
};

export type ShowData = {
  slug: string;
  title: string;
  overview: string;
  network: string | null;
  poster: string;
  backdrop: string | null;
  backdrops: string[];
  throughSeason: number;
  totalSeasons: number;
  seasons: Array<{ season: number; episodes: EpisodeRow[] }>;
  cast: CastRow[];
};

type SpineBeat = {
  label: string;
  text: string;
  anchorEpisode: number | null;
  whyLoadBearing?: string;
  needsVerify?: boolean;
};

type SpineSeason = {
  beats: SpineBeat[];
  cliffhanger: { text: string; questions: string[] };
  characters: Array<{ name: string; line: string; note?: string }>;
  /**
   * The finale's actual reveal, from generate-reveal.mjs. Optional, and only
   * present where Wikipedia coverage was too thin for the spine to surface the
   * ending on its own — it comes from model knowledge rather than a source, so
   * it is always flagged needsVerify.
   */
  revealBeat?: SpineBeat & { source?: string; confidence?: string };
};

export type ShowSpine = { seasons: Record<string, SpineSeason> };

// --- name matching ----------------------------------------------------------

const STRIP_TITLES =
  /^(sheriff|deputy|judge|mayor|dr\.?|doctor|mr\.?|mrs\.?|ms\.?|captain|cap|chief|admiral|secretary|gunnery sergeant|sgt\.?|lt\.?|colonel|commander)\s+/i;

const tokens = (s: string): string[] =>
  s
    .replace(STRIP_TITLES, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(t => t.length > 2);

// --- builder ----------------------------------------------------------------

export function createRecap(data: ShowData, spineFile: ShowSpine) {
  const seasons = spineFile.seasons;
  const keyArt: string = data.backdrop ?? data.backdrops[0] ?? data.poster;

  /**
   * Match a spine-supplied character name to a cast photo.
   *
   * The two vocabularies don't line up: the spine writes "Deputy Billings" or
   * "Sims", the cast list has "Paul Billings" and "Robert Sims". Exact matching
   * drops roughly half the cards, so fall back to a shared significant token —
   * almost always the surname, and specific enough not to collide within a
   * single show's cast.
   */
  function castRowFor(name: string): CastRow | null {
    const want = tokens(name);
    if (want.length === 0) return null;

    const exact = data.cast.find(c => c.character && tokens(c.character).join(' ') === want.join(' '));
    if (exact) return exact;

    return (
      data.cast.find(c => {
        if (!c.character) return false;
        const have = tokens(c.character);
        return want.some(w => have.includes(w));
      }) ?? null
    );
  }

  /**
   * Picture for a character card, preferring the CHARACTER over the ACTOR.
   *
   * TMDB profiles are actor headshots — frequently a red-carpet or studio
   * portrait bearing no resemblance to the role, which is the opposite of
   * useful when the card's whole job is "remind me who this person in the show
   * is". TVMaze supplies in-costume stills for a subset of the cast, so those
   * come first and the headshot is the fallback.
   */
  function portraitOf(name: string): string | null {
    const row = castRowFor(name);
    return row?.inCharacter ?? row?.profile ?? null;
  }

  /**
   * Pick a still for an episode, preferring one not already used.
   *
   * A finale routinely carries two beats plus the cliffhanger, all anchored to
   * the same episode — which rendered consecutive frames with an identical
   * picture. TMDB holds several stills per episode, so walk that pool and take
   * the first unused one. Falls back to the primary still when the pool is
   * exhausted: a repeated in-context frame still beats generic key art.
   */
  function freshStill(season: number, episode: number | null, used: Set<string>): string {
    if (episode == null) return keyArt;
    const ep = data.seasons.find(s => s.season === season)?.episodes.find(e => e.episode === episode);
    if (!ep) return keyArt;
    const pool = (ep.stills?.length ? ep.stills : [ep.still]).filter((u): u is string => !!u);
    const chosen = pool.find(u => !used.has(u)) ?? ep.still ?? keyArt;
    used.add(chosen);
    return chosen;
  }

  /**
   * Beats sorted by anchor episode.
   *
   * The generator is asked for chronological order and does not reliably
   * deliver it — Silo S2 came back E1→E4→E6→E9→E8→E7→E10, which reads as a
   * jumbled story and defeats the point of building a causal spine. Ordering is
   * objectively checkable, so it's enforced here rather than left to the
   * prompt. Beats with no valid anchor sort last rather than to the front.
   */
  function orderedBeats(season: number): SpineBeat[] {
    const s = seasons[String(season)];
    const sorted = [...(s?.beats ?? [])].sort(
      (a, b) => (a.anchorEpisode ?? 99) - (b.anchorEpisode ?? 99),
    );
    // The reveal always closes the season — appended rather than substituted,
    // so the grounded finale beat still sets the situation up and the reveal
    // pays it off, instead of unverified content displacing verified.
    return s?.revealBeat ? [...sorted, s.revealBeat] : sorted;
  }

  const availableSeasons = Object.keys(seasons)
    .map(Number)
    .sort((a, b) => a - b);

  const meta: RecapMeta = {
    slug: data.slug,
    title: data.title,
    totalSeasons: data.totalSeasons,
    availableSeasons,
    network: data.network,
    poster: data.poster,
    backdrop: keyArt,
  };

  /** Beats the generator couldn't ground in the source summaries. Surfaced so
   *  review is a short list rather than a full re-read. */
  const needsVerify = availableSeasons.flatMap(s =>
    // Labels already carry their own "S1 · " prefix, so don't add a second one.
    orderedBeats(s)
      .filter(b => b.needsVerify)
      .map(b => b.label),
  );

  function buildFrames(range: SeasonRange): RecapFrame[] {
    const included = availableSeasons.filter(s => s >= range.from && s <= range.through);
    if (included.length === 0) return [];
    const boundary = included[included.length - 1];
    const atBoundary = seasons[String(boundary)];

    const open: RecapFrame[] = [
      {
        act: 'open',
        kind: 'title',
        // Key art, not an episode still — a title card shouldn't imply a scene.
        image: keyArt,
        dim: 0.15,
        kicker: 'Last time on',
        title: data.title.toUpperCase(),
        meta: `${included.length > 1 ? 'Seasons' : 'Season'} ${rangeLabel(range).slice(1)} · ${data.network ?? ''}`.trim(),
      },
      {
        act: 'open',
        kind: 'beat',
        image: keyArt,
        dim: 0.45,
        season: 0,
        label: 'The premise',
        // The show's own logline, straight from TMDB. Orients a reader who has
        // forgotten not just the plot but the setup.
        text: data.overview,
      },
    ];

    // Tracks stills already spoken for, so two beats anchored to the same
    // episode draw different frames from that episode's pool.
    const usedStills = new Set<string>();

    const players: RecapFrame[] = (atBoundary?.characters ?? []).map(c => {
      const portrait = portraitOf(c.name);
      return {
        act: 'players',
        kind: 'character',
        // The headshot itself, full-bleed. Two reasons: it's the only
        // portrait-shaped asset available, so it actually fits a phone screen;
        // and a face can't "disagree" with a sentence about who that person is,
        // which was the mismatch problem episode stills had here.
        image: portrait ?? keyArt,
        // Lighter than the key-art treatment — the picture is the subject now,
        // so it only needs enough scrim to keep the copy readable.
        dim: portrait ? 0.28 : 0.55,
        name: c.name,
        // The generator returns a role sentence, not a performer. Actor credit
        // comes from the matched cast row.
        actor: castRowFor(c.name)?.name ?? '',
        line: c.line,
        note: c.note,
      };
    });

    const story: RecapFrame[] = included.flatMap(s =>
      orderedBeats(s).map(b => ({
        act: 'story' as const,
        kind: 'beat' as const,
        // Anchored to the episode the generator chose, so the picture depicts
        // the moment the words describe.
        image: freshStill(s, b.anchorEpisode, usedStills),
        dim: 0.18,
        season: s,
        label: b.label,
        text: b.text,
      })),
    );

    const ending = atBoundary?.cliffhanger;
    const finaleEp = data.seasons.find(s => s.season === boundary)?.episodes.length ?? null;
    const cliffhanger: RecapFrame[] = ending
      ? [
          {
            act: 'cliffhanger',
            kind: 'cliffhanger',
            // Finale episode, but a different still from the beats that just ran.
            image: freshStill(boundary, finaleEp, usedStills),
            dim: 0.3,
            kicker: 'Where you left off',
            text: ending.text,
            questions: ending.questions,
          },
        ]
      : [];

    return [...open, ...players, ...story, ...cliffhanger];
  }

  return { meta, buildFrames, needsVerify };
}
