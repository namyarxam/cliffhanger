// Recap reads: Supabase, with an on-device cache.
//
// Recaps are not bundled into the app. A finale airs and the recap has to
// exist that week, which a binary release cycle cannot do. They are generated
// offline (scripts/fetch-recap.mjs → generate-spine.mjs → upload-recap.mjs)
// and read from here.
//
// Frames arrive already composed. The pairing of a beat with its picture, and
// of a character with a cast photo, happens once at upload — see the note at
// the top of upload-recap.mjs. This module orders frames and nothing else.
//
// THE SEASON CAP IS NOT ENFORCED HERE
//
// How far a viewer may go is decided by the database (recap_max_season, in
// migration 065). Nothing in this file may widen it. `maxSeason` below is a
// copy for drawing season chips, not the guard — asking for more seasons than
// the cap allows simply returns fewer rows. That asymmetry is deliberate: if
// the cap lived in the client, then stale progress, a bad deep link, or a
// render that beat the progress query would each become a way to spoil
// someone, and none of those are hypothetical bugs.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/src/lib/supabase';
import { silentCatch } from '@/src/lib/errorLog';
import type { RecapFrame, SeasonRange } from '@/src/recap/types';

// ---------------------------------------------------------------- shapes

/** A show on the Recap tab. Mirrors list_recaps_for_user(). */
export type RecapListEntry = {
  slug: string;
  showId: string;
  title: string;
  overview: string | null;
  network: string | null;
  poster: string | null;
  backdrop: string | null;
  totalSeasons: number | null;
  /** Highest season we hold content for. */
  throughSeason: number;
  /** Highest season THIS viewer may see. 0 means none — untracked, muted, or
   *  no season finished yet. Always ≤ throughSeason. */
  maxSeason: number;
  watchStatus: string | null;
  nextEpisodeAirdate: string | null;
  generatedAt: string;
  /**
   * 0 live · 1 not yet earned · 2 spent. Computed server-side alongside the
   * ordering so the two cannot disagree — see migration 069.
   */
  tier: 0 | 1 | 2;
};

/** One season's composed content, as stored. */
export type RecapSeason = {
  season: number;
  beats: Array<{ label: string; text: string; image: string; dim: number }>;
  cliffhanger: { text: string; questions: string[]; image: string; dim: number } | null;
  characters: Array<{
    name: string;
    actor: string;
    line: string;
    note: string | null;
    image: string;
    dim: number;
  }>;
};

// ---------------------------------------------------------------- cache
//
// A season is ~3.5 KB, so the cache exists for latency and for the plane
// case, not to save bytes. Entries are keyed per season rather than per range
// because ranges are composed from seasons: fetching S1–S3 after S1 is cached
// should only pull S2 and S3.
//
// generatedAt is stored alongside and compared against the value from the
// list query, so re-uploading a corrected recap invalidates it without
// anything version-bumping by hand.

const CACHE_PREFIX = 'recap:v1:';
const seasonKey = (slug: string, season: number) => `${CACHE_PREFIX}${slug}:${season}`;
const stampKey = (slug: string) => `${CACHE_PREFIX}${slug}:generatedAt`;

async function readCachedSeasons(slug: string, seasons: number[], generatedAt: string) {
  try {
    const stamp = await AsyncStorage.getItem(stampKey(slug));
    // A re-upload changes the stamp; treat everything cached for this show as
    // stale rather than reasoning about which seasons actually changed.
    if (stamp !== generatedAt) return null;

    const pairs = await AsyncStorage.multiGet(seasons.map(s => seasonKey(slug, s)));
    const found: RecapSeason[] = [];
    for (const [, value] of pairs) {
      if (!value) return null; // partial hit is a miss — simpler than merging
      found.push(JSON.parse(value) as RecapSeason);
    }
    return found.sort((a, b) => a.season - b.season);
  } catch (e) {
    silentCatch('recaps:readCache')(e);
    return null;
  }
}

async function writeCachedSeasons(slug: string, seasons: RecapSeason[], generatedAt: string) {
  try {
    await AsyncStorage.multiSet(seasons.map(s => [seasonKey(slug, s.season), JSON.stringify(s)]));
    await AsyncStorage.setItem(stampKey(slug), generatedAt);
  } catch (e) {
    // A failed write costs a refetch, never correctness.
    silentCatch('recaps:writeCache')(e);
  }
}

// ---------------------------------------------------------------- queries

export async function listRecaps(): Promise<RecapListEntry[]> {
  const { data, error } = await supabase.rpc('list_recaps_for_user');
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    slug: r.slug as string,
    showId: r.show_id as string,
    title: r.title as string,
    overview: (r.overview as string) ?? null,
    network: (r.network as string) ?? null,
    poster: (r.poster as string) ?? null,
    backdrop: (r.backdrop as string) ?? null,
    totalSeasons: (r.total_seasons as number) ?? null,
    throughSeason: r.through_season as number,
    maxSeason: (r.max_season as number) ?? 0,
    watchStatus: (r.watch_status as string) ?? null,
    nextEpisodeAirdate: (r.next_episode_airdate as string) ?? null,
    generatedAt: r.generated_at as string,
    // Defaults to the live tier if the column is absent, so a client running
    // ahead of the migration degrades to the old single-list behaviour rather
    // than filing everything under "finished".
    tier: ((r.tier as number) ?? 0) as 0 | 1 | 2,
  }));
}

/**
 * Seasons for a range, from cache when possible.
 *
 * `generatedAt` comes from the list entry and is what makes the cache
 * self-invalidating. The range is passed through to the server untouched;
 * the server decides what comes back.
 */
export async function getRecapSeasons(
  slug: string,
  range: SeasonRange,
  generatedAt: string,
): Promise<RecapSeason[]> {
  const wanted: number[] = [];
  for (let s = range.from; s <= range.through; s++) wanted.push(s);

  const cached = await readCachedSeasons(slug, wanted, generatedAt);
  if (cached) return cached;

  const { data, error } = await supabase.rpc('get_recap', {
    p_slug: slug,
    p_from: range.from,
    p_through: range.through,
  });
  if (error) throw error;

  const seasons: RecapSeason[] = (data ?? []).map((r: Record<string, unknown>) => ({
    season: r.season as number,
    beats: (r.beats as RecapSeason['beats']) ?? [],
    cliffhanger: (r.cliffhanger as RecapSeason['cliffhanger']) ?? null,
    characters: (r.characters as RecapSeason['characters']) ?? [],
  }));

  if (seasons.length) void writeCachedSeasons(slug, seasons, generatedAt);
  return seasons;
}

/**
 * Warm the cache for everything a viewer is currently entitled to.
 *
 * You want a season's recap roughly a year after finishing it, when the next
 * season airs — never at the moment you catch up. So the season that just
 * unlocked can be fetched quietly now and will be sitting on the device long
 * before anyone asks for it. That is what makes a server-enforced cap cost
 * nothing in felt speed: the data still arrives early, it just never arrives
 * early for a season you have not finished.
 *
 * Fire-and-forget. Failure is invisible and self-correcting — the next real
 * open refetches.
 */
export async function prefetchRecap(entry: RecapListEntry): Promise<void> {
  if (entry.maxSeason < 1) return;
  try {
    const seasons: number[] = [];
    for (let s = 1; s <= entry.maxSeason; s++) seasons.push(s);
    const cached = await readCachedSeasons(entry.slug, seasons, entry.generatedAt);
    if (cached) return;
    await getRecapSeasons(entry.slug, { from: 1, through: entry.maxSeason }, entry.generatedAt);
  } catch (e) {
    silentCatch('recaps:prefetch')(e);
  }
}

// ---------------------------------------------------------------- reports

/** Why a frame is wrong. Mirrors the CHECK constraint on recap_reports. */
export type RecapReportReason = 'wrong_photo' | 'wrong_facts' | 'spoiler' | 'wrong_show' | 'other';

export const REPORT_REASONS: Array<{ value: RecapReportReason; label: string }> = [
  // Ordered by how often each has actually occurred during review, except
  // spoiler, which leads because it is the one defect the feature exists to
  // prevent and the only one that cannot be undone for whoever hit it.
  { value: 'spoiler', label: 'Spoils something later' },
  { value: 'wrong_photo', label: 'Wrong photo or actor' },
  { value: 'wrong_facts', label: "This isn't what happened" },
  { value: 'wrong_show', label: 'This is a different show' },
  { value: 'other', label: 'Something else' },
];

/**
 * Flag a frame as wrong.
 *
 * Every serious defect so far was found by a person looking at a slide, and
 * none tripped an automated check — a wrong actor, a spine describing a
 * different series, a character attributed to her father. All were correctly
 * SHAPED, which is all the gates verify. So this is the gate for the rest.
 *
 * The frame's own coordinates are recorded rather than its index, because
 * regenerating a recap renumbers frames while a character keeps their name.
 * Re-reporting the same frame for the same reason is a no-op, not an error:
 * the unique constraint absorbs it, so a viewer tapping twice does not become
 * two votes.
 */
export async function reportRecapFrame(input: {
  userId: string;
  slug: string;
  season: number | null;
  frameKind: string;
  frameLabel: string;
  reason: RecapReportReason;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.from('recap_reports').upsert(
    {
      user_id: input.userId,
      slug: input.slug,
      season: input.season,
      frame_kind: input.frameKind,
      frame_label: input.frameLabel.slice(0, 120),
      reason: input.reason,
      note: input.note?.trim() ? input.note.trim().slice(0, 500) : null,
    },
    { onConflict: 'user_id,slug,season,frame_label,reason', ignoreDuplicates: false },
  );
  if (error) throw error;
}

/** A label identifying the frame well enough to find it again by hand. */
export function frameLabelFor(frame: RecapFrame): string {
  switch (frame.kind) {
    case 'character':
      return frame.name;
    case 'beat':
      return frame.label;
    case 'cliffhanger':
      return 'Cliffhanger';
    case 'title':
      return 'Title card';
  }
}

// ---------------------------------------------------------------- frames

/**
 * Season ranges to offer on a card, newest last.
 *
 * Single seasons only. A whole-series option used to sit at the end, and
 * Game of Thrones offered S1-S8: fifty-six beats plus characters and a
 * cliffhanger, about sixty-six taps. Nobody finishes that, and it is not what
 * the feature is for — you come back because ONE season is about to start and
 * you have forgotten the one before it.
 *
 * Nothing in the data prevents ranges; get_recap still takes a from and a
 * through, and the seasons are stored separately precisely so a range can be
 * composed. This is a decision about what to offer, not a limitation, so
 * restoring a multi-season option later costs one line.
 *
 * Bounded by maxSeason, so a viewer is never offered a season they have not
 * finished.
 */
export function offeredRangesFor(maxSeason: number): SeasonRange[] {
  if (maxSeason < 1) return [];
  const ranges: SeasonRange[] = [];
  for (let s = 1; s <= maxSeason; s++) ranges.push({ from: s, through: s });
  return ranges;
}

/**
 * Order composed seasons into the frame list the story screen taps through.
 *
 * Ordering only — every image and every scrim value was decided at upload.
 * Characters and the cliffhanger come from the LAST season in the range,
 * because both describe where things stand at the boundary the viewer is
 * returning from, not a series-wide summary.
 */
export function buildFrames(entry: RecapListEntry, seasons: RecapSeason[]): RecapFrame[] {
  if (!seasons.length) return [];
  const keyArt = entry.backdrop ?? entry.poster ?? '';
  const boundary = seasons[seasons.length - 1];
  const from = seasons[0].season;
  const through = boundary.season;
  const label = from === through ? `Season ${from}` : `Seasons ${from}–${through}`;

  const open: RecapFrame[] = [
    {
      act: 'open',
      kind: 'title',
      // Key art, not an episode still — a title card should not imply a scene.
      image: keyArt,
      dim: 0.15,
      kicker: 'Last time on',
      title: entry.title.toUpperCase(),
      meta: `${label}${entry.network ? ` · ${entry.network}` : ''}`,
    },
  ];

  // No premise frame.
  //
  // It used to sit here, carrying the show's TMDB logline. Three things were
  // wrong with it. It was the only frame grounded in marketing copy — the
  // source deliberately rejected everywhere else for being vague exactly where
  // a recap must be specific ("seeds of division sow friction across the
  // realm"). It ran two to three times the length of any beat, at the very
  // position where a reader decides whether to continue. And it addressed
  // someone who has never seen the show, which the season cap makes
  // impossible: a recap is only ever offered for seasons the viewer has
  // FINISHED.
  //
  // The mismatch is sharpest on a later-season recap, where the logline
  // re-sets up a conflict the viewer watched resolve seasons ago instead of
  // saying where things stand now. The character cards do that job, specific
  // to the boundary being recapped.

  const players: RecapFrame[] = boundary.characters.map(c => ({
    act: 'players',
    kind: 'character',
    image: c.image,
    dim: c.dim,
    name: c.name,
    actor: c.actor,
    line: c.line,
    note: c.note ?? undefined,
  }));

  const story: RecapFrame[] = seasons.flatMap(s =>
    s.beats.map(b => ({
      act: 'story' as const,
      kind: 'beat' as const,
      image: b.image,
      dim: b.dim,
      season: s.season,
      label: b.label,
      text: b.text,
    })),
  );

  const cliffhanger: RecapFrame[] = boundary.cliffhanger
    ? [
        {
          act: 'cliffhanger',
          kind: 'cliffhanger',
          image: boundary.cliffhanger.image,
          dim: boundary.cliffhanger.dim,
          kicker: 'Where you left off',
          text: boundary.cliffhanger.text,
          questions: boundary.cliffhanger.questions,
        },
      ]
    : [];

  return [...open, ...players, ...story, ...cliffhanger];
}
