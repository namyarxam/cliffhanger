import { supabase } from './supabase';
import { getFriends } from './friends';
import type { UserShow, EpisodeWatch, WatchStatus, Season } from './types';

// Used by both My Shows ("Popular with Friends" carousel) and the Search
// screen's empty state. Same value across screens so the TanStack cache
// key `qk.popular(userId, limit)` matches and the two screens share one
// cache entry instead of fetching independently.
export const POPULAR_SHOWS_LIMIT_DEFAULT = 25;

// ─── Episode Helpers ──────────────────────────────────────────────────────────

/** Find the last episode that has already aired. */
export function getLastAiredEpisode(
  seasons: Season[],
  today = new Date().toISOString().slice(0, 10),
): { season: number; episode: number; airdate: string } | null {
  let lastSeason = 0;
  let lastEp = 0;
  let lastAirdate = '';
  for (const s of seasons) {
    for (const ep of s.episodes) {
      // Only count episodes with an explicit airdate on/before today.
      // TVMaze leaves airdate=null on placeholder rows for unannounced
      // future episodes — including those would have us write the
      // highest-numbered placeholder as "last aired" and treat the user
      // as perpetually behind a phantom episode that doesn't exist yet.
      // (countAiredEpisodes below uses the same gate.)
      if (ep.airdate && ep.airdate <= today) {
        lastSeason = s.number;
        lastEp = ep.number;
        lastAirdate = ep.airdate;
      }
    }
  }
  return lastSeason > 0 ? { season: lastSeason, episode: lastEp, airdate: lastAirdate } : null;
}

/**
 * Count episodes whose airdate is on or before today. Drives the My Shows
 * progress bar denominator (numerator is the user's episode_watches count).
 * Episodes with no airdate are treated as unaired — TVMaze leaves the field
 * null on placeholder rows for unannounced future episodes.
 */
export function countAiredEpisodes(
  seasons: Season[],
  today = new Date().toISOString().slice(0, 10),
): number {
  let count = 0;
  for (const s of seasons) {
    for (const ep of s.episodes) {
      if (ep.airdate && ep.airdate <= today) count++;
    }
  }
  return count;
}

/** Build a Set of "S{n}E{n}" keys for all episodes up to the given position. */
export function buildEpisodeSet(
  seasons: Season[],
  targetSeason: number,
  targetEpisode: number,
): Set<string> {
  const set = new Set<string>();
  for (const s of seasons) {
    for (const ep of s.episodes) {
      if (s.number < targetSeason || (s.number === targetSeason && ep.number <= targetEpisode)) {
        set.add(`S${s.number}E${ep.number}`);
      }
    }
  }
  return set;
}

export interface PopularShow {
  show_id: string;
  show_title: string;
  show_image: string | null;
  friend_count: number;
  friend_names: string[];
  latestAdd: string;
}

export async function getPopularWithFriends(userId: string, limit: number = POPULAR_SHOWS_LIMIT_DEFAULT): Promise<PopularShow[]> {
  const friends = await getFriends(userId);
  if (friends.length === 0) return [];

  const friendIds = friends.map(f => f.user.id);

  // Capture the error rather than swallowing it. Previously this returned []
  // on any non-data response, which let transient failures (network blips,
  // RLS hiccups, rate-limits) silently blank the carousel. fetchData's
  // allSettled wrapper catches the throw and preserves the prior state.
  // Exclude muted rows. A friend muting a show is a negative signal —
  // counting it toward "Popular with Friends" let shows trend to the top
  // when more friends had bailed than were actually watching.
  const { data, error } = await supabase
    .from('user_shows_full')
    .select('show_id, show_title, show_image, user_id, added_at')
    .in('user_id', friendIds)
    .neq('status', 'muted');

  if (error) throw error;
  if (!data || data.length === 0) return [];

  // Build a name map from friends
  const nameMap = new Map(friends.map(f => [f.user.id, f.user.display_name]));

  // Group by show, count friends, collect names, track most recent add.
  // Title/image are LEFT-JOIN-derived from the centralized `shows` table; if
  // one friend's row has nulls (orphan user_shows row, transient JOIN miss),
  // a later friend's row with populated values is preferred. Without this
  // the first-row-wins behavior could leave a popular entry permanently
  // blank-postered.
  const showMap = new Map<string, { title: string; image: string | null; names: string[]; latestAdd: string }>();
  for (const row of data) {
    let entry = showMap.get(row.show_id);
    if (!entry) {
      entry = { title: row.show_title ?? '', image: row.show_image, names: [], latestAdd: row.added_at };
      showMap.set(row.show_id, entry);
    }
    if (!entry.title && row.show_title) entry.title = row.show_title;
    if (!entry.image && row.show_image) entry.image = row.show_image;
    const name = nameMap.get(row.user_id);
    if (name) entry.names.push(name);
    if (row.added_at > entry.latestAdd) entry.latestAdd = row.added_at;
  }

  // Filter out shows the user already has
  const { data: myShows } = await supabase
    .from('user_shows')
    .select('show_id')
    .eq('user_id', userId);

  const myShowIds = new Set((myShows ?? []).map(s => s.show_id));

  return [...showMap.entries()]
    .filter(([id]) => !myShowIds.has(id))
    .map(([id, info]) => ({
      show_id: id,
      show_title: info.title,
      show_image: info.image,
      friend_count: info.names.length,
      friend_names: info.names,
      latestAdd: info.latestAdd,
    }))
    .sort((a, b) => b.friend_count - a.friend_count || b.latestAdd.localeCompare(a.latestAdd))
    .slice(0, limit);
}

export async function getUserShows(userId: string): Promise<UserShow[]> {
  const { data, error } = await supabase
    .from('user_shows_full')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getUserShow(userId: string, showId: string): Promise<UserShow | null> {
  const { data, error } = await supabase
    .from('user_shows_full')
    .select('*')
    .eq('user_id', userId)
    .eq('show_id', showId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function addShow(
  userId: string,
  showId: string,
  status: WatchStatus,
  title: string,
  image: string | null,
  network: string | null,
  metadata?: {
    showStatus: string | null;
    nextEpisodeAirdate: string | null;
    nextEpisodeSeason: number | null;
    nextEpisodeEpisode: number | null;
    lastAiredSeason: number | null;
    lastAiredEpisode: number | null;
    lastAiredAirdate: string | null;
    totalAiredEpisodes: number | null;
  },
): Promise<{ currentSeason: number; currentEpisode: number }> {
  // Check for existing episode watches to restore progress
  let currentSeason = 0;
  let currentEpisode = 0;

  const { data: watches } = await supabase
    .from('episode_watches')
    .select('season, episode')
    .eq('user_id', userId)
    .eq('show_id', showId)
    .order('season', { ascending: false })
    .order('episode', { ascending: false })
    .limit(1);

  if (watches && watches.length > 0) {
    currentSeason = watches[0].season;
    currentEpisode = watches[0].episode;
  }

  // Upsert the shared TVMaze metadata first. Idempotent across users — every
  // client adding this show writes the same data. If the user_shows insert
  // below fails, the orphan shows row is harmless and gets reused on retry.
  const { error: showError } = await supabase
    .from('shows')
    .upsert({
      show_id: showId,
      show_title: title,
      show_image: image,
      show_network: network,
      show_status: metadata?.showStatus ?? null,
      next_episode_airdate: metadata?.nextEpisodeAirdate ?? null,
      next_episode_season: metadata?.nextEpisodeSeason ?? null,
      next_episode_episode: metadata?.nextEpisodeEpisode ?? null,
      last_aired_season: metadata?.lastAiredSeason ?? null,
      last_aired_episode: metadata?.lastAiredEpisode ?? null,
      last_aired_airdate: metadata?.lastAiredAirdate ?? null,
      total_aired_episodes: metadata?.totalAiredEpisodes ?? null,
      updated_at: new Date().toISOString(),
    });

  if (showError) throw showError;

  const { error } = await supabase
    .from('user_shows')
    .upsert({
      user_id: userId,
      show_id: showId,
      status,
      current_season: currentSeason,
      current_episode: currentEpisode,
      new_episodes_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

  if (error) throw error;
  return { currentSeason, currentEpisode };
}

/**
 * Refresh the cached TVMaze metadata for a show. Called fire-and-forget from
 * useShowData when a show detail page loads, so the My Shows list groupings
 * stay accurate without a separate cron job. One write covers every user
 * tracking the show.
 */
export async function cacheShowMetadata(
  showId: string,
  showStatus: string | null,
  nextEpisode: { season: number; episode: number; airdate: string | null } | null,
  lastAired: { season: number; episode: number; airdate: string | null } | null,
  totalAiredEpisodes: number | null,
): Promise<void> {
  await supabase
    .from('shows')
    .update({
      show_status: showStatus,
      next_episode_airdate: nextEpisode?.airdate ?? null,
      next_episode_season: nextEpisode?.season ?? null,
      next_episode_episode: nextEpisode?.episode ?? null,
      last_aired_season: lastAired?.season ?? null,
      last_aired_episode: lastAired?.episode ?? null,
      last_aired_airdate: lastAired?.airdate ?? null,
      total_aired_episodes: totalAiredEpisodes,
      updated_at: new Date().toISOString(),
    })
    .eq('show_id', showId);
}

export async function updateShowStatus(
  userId: string,
  showId: string,
  status: WatchStatus,
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  // Reset progress if moving back to want_to_watch
  if (status === 'want_to_watch') {
    update.current_season = 0;
    update.current_episode = 0;
  }

  // Only currently_watching can be caught up
  if (status !== 'currently_watching') {
    update.caught_up = false;
  }

  const { error } = await supabase
    .from('user_shows')
    .update(update)
    .eq('user_id', userId)
    .eq('show_id', showId);

  if (error) throw error;
}

export async function removeShow(userId: string, showId: string): Promise<void> {
  // Only remove from list — keep episode watches so progress persists
  const { error } = await supabase
    .from('user_shows')
    .delete()
    .eq('user_id', userId)
    .eq('show_id', showId);

  if (error) throw error;
}

/**
 * Map of show_id → number of episodes the user has marked watched. Powers the
 * progress-bar numerator on the My Shows list.
 *
 * Reads from the `user_episode_watch_counts` view (migration 041) which
 * pre-aggregates watches via GROUP BY in Postgres. One row per show instead
 * of one row per watched episode — payload stays small no matter how many
 * watches a user has, and we sidestep PostgREST's default 1000-row limit
 * that previously caused non-deterministic partial counts on heavy users.
 */
export async function getWatchedCounts(userId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('user_episode_watch_counts')
    .select('show_id, watched_count')
    .eq('user_id', userId);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.show_id, row.watched_count);
  }
  return counts;
}

export async function getWatchedEpisodes(
  userId: string,
  showId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('episode_watches')
    .select('season, episode')
    .eq('user_id', userId)
    .eq('show_id', showId);

  if (error) throw error;

  const set = new Set<string>();
  for (const row of data ?? []) {
    set.add(`S${row.season}E${row.episode}`);
  }
  return set;
}

export async function markUpToEpisode(
  userId: string,
  showId: string,
  targetSeason: number,
  targetEpisode: number,
  allSeasons: Season[],
): Promise<Set<string>> {
  const rows: { user_id: string; show_id: string; season: number; episode: number }[] = [];

  for (const season of allSeasons) {
    for (const ep of season.episodes) {
      if (
        season.number < targetSeason ||
        (season.number === targetSeason && ep.number <= targetEpisode)
      ) {
        rows.push({
          user_id: userId,
          show_id: showId,
          season: season.number,
          episode: ep.number,
        });
      }
    }
  }

  if (rows.length > 0) {
    // ignoreDuplicates skips on-conflict instead of doing an UPDATE — the
    // RLS policy on episode_watches only allows INSERT/SELECT/DELETE, so
    // upsert without this flag fails with 42501 when any of the rows
    // already exist. Marking the same episode again is idempotent anyway.
    const { error } = await supabase
      .from('episode_watches')
      .upsert(rows, { onConflict: 'user_id,show_id,season,episode', ignoreDuplicates: true });

    if (error) throw error;
  }

  // Update current progress on user_shows
  const { error: updateError } = await supabase
    .from('user_shows')
    .update({
      current_season: targetSeason,
      current_episode: targetEpisode,
      status: 'currently_watching',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('show_id', showId);

  if (updateError) throw updateError;

  // Return the new watched set
  const set = new Set<string>();
  for (const row of rows) {
    set.add(`S${row.season}E${row.episode}`);
  }
  return set;
}

export async function markExactlyUpTo(
  userId: string,
  showId: string,
  targetSeason: number,
  targetEpisode: number,
  allSeasons: Season[],
): Promise<Set<string>> {
  await supabase
    .from('episode_watches')
    .delete()
    .eq('user_id', userId)
    .eq('show_id', showId);

  const rows: { user_id: string; show_id: string; season: number; episode: number }[] = [];
  const set = new Set<string>();
  let airdate: string | null = null;

  for (const season of allSeasons) {
    for (const ep of season.episodes) {
      if (
        season.number < targetSeason ||
        (season.number === targetSeason && ep.number <= targetEpisode)
      ) {
        rows.push({
          user_id: userId,
          show_id: showId,
          season: season.number,
          episode: ep.number,
        });
        set.add(`S${season.number}E${ep.number}`);
        if (season.number === targetSeason && ep.number === targetEpisode) {
          airdate = ep.airdate;
        }
      }
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('episode_watches')
      .insert(rows);

    if (error) throw error;
  }

  const lastAired = getLastAiredEpisode(allSeasons);
  const isCaughtUp = lastAired != null
    && targetSeason === lastAired.season
    && targetEpisode === lastAired.episode;

  const { error: progressError } = await supabase
    .from('user_shows')
    .update({
      current_season: targetSeason,
      current_episode: targetEpisode,
      current_episode_airdate: airdate,
      status: 'currently_watching',
      caught_up: isCaughtUp,
      new_episodes_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('show_id', showId);

  if (progressError) throw progressError;

  return set;
}

export async function unmarkEpisode(
  userId: string,
  showId: string,
  season: number,
  episode: number,
): Promise<void> {
  const { error } = await supabase
    .from('episode_watches')
    .delete()
    .eq('user_id', userId)
    .eq('show_id', showId)
    .eq('season', season)
    .eq('episode', episode);

  if (error) throw error;
}

export async function toggleShowNotify(
  userId: string,
  showId: string,
  notify: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('user_shows')
    .update({ notify, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('show_id', showId);

  if (error) throw error;
}

export async function rateShow(
  userId: string,
  showId: string,
  rating: number,
): Promise<void> {
  const { error } = await supabase
    .from('user_shows')
    .update({ rating, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('show_id', showId);

  if (error) throw error;
}

export async function getShowsWithNewEpisodes(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('get_shows_with_new_episodes', {
    p_user_id: userId,
  });

  if (error) throw error;
  return new Set((data ?? []).map((r: { show_id: string }) => r.show_id));
}

export async function dismissNewEpisodes(userId: string, showId: string): Promise<void> {
  const { error } = await supabase
    .from('user_shows')
    .update({ new_episodes_seen_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('show_id', showId);

  if (error) throw error;
}

export interface ReturnAnnouncement {
  show_id: string;
  show_title: string;
  show_image: string | null;
  next_episode_airdate: string | null;
  returning_announced_at: string;
}

/**
 * Currently-watching shows where the refresh cron caught a hiatus → returning
 * transition the user hasn't acknowledged yet. Drives the "Coming back!"
 * banner. Filters out announcements whose return date already passed —
 * those shows have either aired (now in Behind) or stayed silent again.
 */
export async function getReturnAnnouncements(userId: string): Promise<ReturnAnnouncement[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('user_shows_full')
    .select('show_id, show_title, show_image, next_episode_airdate, returning_announced_at, returning_seen_at')
    .eq('user_id', userId)
    .eq('status', 'currently_watching')
    .not('returning_announced_at', 'is', null)
    .gte('next_episode_airdate', today)
    .order('next_episode_airdate', { ascending: true });

  if (error) throw error;
  return (data ?? [])
    .filter(r => r.returning_seen_at == null || r.returning_seen_at < r.returning_announced_at)
    .map(r => ({
      show_id: r.show_id,
      show_title: r.show_title,
      show_image: r.show_image,
      next_episode_airdate: r.next_episode_airdate,
      returning_announced_at: r.returning_announced_at,
    }));
}

export async function markReturnAnnouncementSeen(userId: string, showId: string): Promise<void> {
  const { error } = await supabase
    .from('user_shows')
    .update({ returning_seen_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('show_id', showId);

  if (error) throw error;
}

/** Returns the set of show_ids where the user has an unwatched episode airing today. */
export async function getShowsAiringToday(userId: string): Promise<Set<string>> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: userShows } = await supabase
    .from('user_shows')
    .select('show_id, current_season, current_episode')
    .eq('user_id', userId)
    .eq('status', 'currently_watching');
  if (!userShows || userShows.length === 0) return new Set();

  const { data: entries } = await supabase
    .from('schedule')
    .select('show_id, season, episode')
    .in('show_id', userShows.map(s => s.show_id))
    .eq('airdate', today);
  if (!entries || entries.length === 0) return new Set();

  const posByShow = new Map(userShows.map(s => [s.show_id, { s: s.current_season, e: s.current_episode }]));
  const airing = new Set<string>();
  for (const entry of entries) {
    const pos = posByShow.get(entry.show_id);
    if (!pos) continue;
    if (entry.season > pos.s || (entry.season === pos.s && entry.episode > pos.e)) {
      airing.add(entry.show_id);
    }
  }
  return airing;
}

export interface NextEpisode {
  season: number;
  episode: number;
  airdate: string | null;
  // Total unwatched aired episodes for this show. Powers the "Catch up · N"
  // pill on the home screen. Comes straight from the schedule table so it
  // stays current whenever the cron picks up a new airing — no dependency
  // on the per-row last_aired cache, which only refreshes on show-detail
  // visits.
  behindCount: number;
}

export async function getNextEpisodesForShows(
  userId: string,
): Promise<{ nextEpisodes: Map<string, NextEpisode> }> {
  const { data } = await supabase.rpc('get_next_episodes_for_shows', {
    p_user_id: userId,
  });

  const nextEpisodes = new Map<string, NextEpisode>();
  for (const r of data ?? []) {
    nextEpisodes.set(r.show_id, {
      season: r.next_season,
      episode: r.next_episode,
      airdate: r.next_airdate ?? null,
      behindCount: r.behind_count ?? 1,
    });
  }

  return { nextEpisodes };
}

export async function markNextEpisode(
  userId: string,
  showId: string,
  season: number,
  episode: number,
): Promise<void> {
  // Insert the single episode watch
  const { error: watchError } = await supabase
    .from('episode_watches')
    .upsert(
      { user_id: userId, show_id: showId, season, episode },
      { onConflict: 'user_id,show_id,season,episode' },
    );

  if (watchError) throw watchError;

  // Update user_shows progress
  const { error } = await supabase
    .from('user_shows')
    .update({
      current_season: season,
      current_episode: episode,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('show_id', showId);

  if (error) throw error;
}

// ─── Explore: Airing This Week + Top Rated ───────────────────────────────────

/**
 * Carousel-shaped explore item. The same shape backs all three explore
 * carousels (Popular with Friends, Airing This Week, Top Rated) so the
 * UI can use a single FeaturedCarousel component.
 */
export interface FeaturedShow {
  show_id: string;
  show_title: string | null;
  show_image: string | null;
}

// Top Rated displays N out of a larger pool (90), so when the user mutes
// or adds a show the next-ranked one fills the slot. Airing This Week is
// already capped at 15 server-side by the cron filter.
const TOP_RATED_DISPLAY_LIMIT = 15;

/**
 * Pull the shows the caller has any user_shows row for — used to exclude
 * already-tracked shows from explore carousels. Muted shows are tracked
 * (status='muted') and naturally fall under this single filter.
 */
async function getTrackedShowIds(userId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('user_shows')
    .select('show_id')
    .eq('user_id', userId);
  return new Set((data ?? []).map(r => r.show_id));
}

/**
 * Read the cron-refreshed Airing This Week list. JOINs to `shows` for
 * display metadata. Excludes shows the caller has any user_shows row for
 * (muted, added, watched, etc.) so explore stays a pure "discover"
 * surface.
 */
export async function getAiringThisWeek(userId: string | undefined): Promise<FeaturedShow[]> {
  const { data, error } = await supabase
    .from('airing_this_week')
    .select('rank, show_id, shows!inner(show_id, show_title, show_image)')
    .order('rank', { ascending: true });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const trackedIds = userId ? await getTrackedShowIds(userId) : new Set<string>();

  return data
    .filter(r => !trackedIds.has(r.show_id))
    .map(r => {
      const s = (r as unknown as { shows: { show_id: string; show_title: string | null; show_image: string | null } }).shows;
      return { show_id: s.show_id, show_title: s.show_title, show_image: s.show_image };
    });
}

/**
 * Read the Top Rated pool (90 shows) and surface the top N (default 15)
 * the caller hasn't already tracked. As shows are muted/added the next
 * pool entry fills in — the carousel re-populates without a manual
 * pagination call.
 */
export async function getTopRated(
  userId: string | undefined,
  limit: number = TOP_RATED_DISPLAY_LIMIT,
): Promise<FeaturedShow[]> {
  const { data, error } = await supabase
    .from('top_rated_shows')
    .select('rank, show_id, shows!inner(show_id, show_title, show_image)')
    .order('rank', { ascending: true });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const trackedIds = userId ? await getTrackedShowIds(userId) : new Set<string>();

  const out: FeaturedShow[] = [];
  for (const r of data) {
    if (trackedIds.has(r.show_id)) continue;
    const s = (r as unknown as { shows: { show_id: string; show_title: string | null; show_image: string | null } }).shows;
    out.push({ show_id: s.show_id, show_title: s.show_title, show_image: s.show_image });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Mute a show for the current user. Universal "don't surface this" signal;
 * removes the show from every explore carousel and adds it to the user's
 * Muted Shows screen. Works for both tracked and untracked shows.
 */
export async function muteShow(
  userId: string,
  showId: string,
  title: string,
  image: string | null,
): Promise<void> {
  const { data: existing } = await supabase
    .from('user_shows')
    .select('user_id')
    .eq('user_id', userId)
    .eq('show_id', showId)
    .maybeSingle();

  if (existing) {
    await updateShowStatus(userId, showId, 'muted');
  } else {
    await addShow(userId, showId, 'muted', title, image, null);
  }
}

