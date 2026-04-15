import { supabase } from './supabase';
import { getFriends } from './friends';
import type { UserShow, EpisodeWatch, WatchStatus, Season } from './types';

const POPULAR_SHOWS_LIMIT = 6;

// ─── Episode Helpers ──────────────────────────────────────────────────────────

/** Find the last episode that has already aired. */
export function getLastAiredEpisode(
  seasons: Season[],
  today = new Date().toISOString().slice(0, 10),
): { season: number; episode: number; airdate: string | null } | null {
  let lastSeason = 0;
  let lastEp = 0;
  let lastAirdate: string | null = null;
  for (const s of seasons) {
    for (const ep of s.episodes) {
      if (!ep.airdate || ep.airdate <= today) {
        lastSeason = s.number;
        lastEp = ep.number;
        lastAirdate = ep.airdate;
      }
    }
  }
  return lastSeason > 0 ? { season: lastSeason, episode: lastEp, airdate: lastAirdate } : null;
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

export async function getPopularWithFriends(userId: string): Promise<PopularShow[]> {
  const friends = await getFriends(userId);
  if (friends.length === 0) return [];

  const friendIds = friends.map(f => f.user.id);

  const { data } = await supabase
    .from('user_shows')
    .select('show_id, show_title, show_image, user_id, added_at')
    .in('user_id', friendIds);

  if (!data || data.length === 0) return [];

  // Build a name map from friends
  const nameMap = new Map(friends.map(f => [f.user.id, f.user.display_name]));

  // Group by show, count friends, collect names, track most recent add
  const showMap = new Map<string, { title: string; image: string | null; names: string[]; latestAdd: string }>();
  for (const row of data) {
    const entry = showMap.get(row.show_id) ?? { title: row.show_title, image: row.show_image, names: [] as string[], latestAdd: row.added_at };
    const name = nameMap.get(row.user_id);
    if (name) entry.names.push(name);
    if (row.added_at > entry.latestAdd) entry.latestAdd = row.added_at;
    showMap.set(row.show_id, entry);
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
    .slice(0, POPULAR_SHOWS_LIMIT);
}

export async function getUserShows(userId: string): Promise<UserShow[]> {
  const { data, error } = await supabase
    .from('user_shows')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getUserShow(userId: string, showId: string): Promise<UserShow | null> {
  const { data, error } = await supabase
    .from('user_shows')
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

  const { error } = await supabase
    .from('user_shows')
    .upsert({
      user_id: userId,
      show_id: showId,
      status,
      show_title: title,
      show_image: image,
      show_network: network,
      current_season: currentSeason,
      current_episode: currentEpisode,
      new_episodes_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

  if (error) throw error;
  return { currentSeason, currentEpisode };
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
    const { error } = await supabase
      .from('episode_watches')
      .upsert(rows, { onConflict: 'user_id,show_id,season,episode' });

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

export async function getNextEpisodesForShows(
  userId: string,
): Promise<{ nextEpisodes: Map<string, { season: number; episode: number }> }> {
  const { data, error } = await supabase.rpc('get_next_episodes_for_shows', {
    p_user_id: userId,
  });

  const nextEpisodes = new Map<string, { season: number; episode: number }>();
  for (const r of data ?? []) {
    nextEpisodes.set(r.show_id, { season: r.next_season, episode: r.next_episode });
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
