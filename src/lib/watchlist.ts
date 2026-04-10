import { supabase } from './supabase';
import type { UserShow, EpisodeWatch, WatchStatus, Season } from './types';

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
): Promise<void> {
  const { error } = await supabase
    .from('user_shows')
    .upsert({
      user_id: userId,
      show_id: showId,
      status,
      show_title: title,
      show_image: image,
      show_network: network,
      current_season: 0,
      current_episode: 0,
      updated_at: new Date().toISOString(),
    });

  if (error) throw error;
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
  await supabase
    .from('user_shows')
    .update({
      current_season: targetSeason,
      current_episode: targetEpisode,
      status: 'currently_watching',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('show_id', showId);

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

  await supabase
    .from('user_shows')
    .update({
      current_season: targetSeason,
      current_episode: targetEpisode,
      current_episode_airdate: airdate,
      status: 'currently_watching',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('show_id', showId);

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

  if (error) return new Set();
  return new Set((data ?? []).map((r: { show_id: string }) => r.show_id));
}

export async function dismissNewEpisodes(userId: string, showId: string): Promise<void> {
  await supabase
    .from('user_shows')
    .update({ new_episodes_seen_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('show_id', showId);
}

export async function getNextEpisodesForShows(
  userId: string,
): Promise<Map<string, { season: number; episode: number }>> {
  const { data, error } = await supabase.rpc('get_next_episodes_for_shows', {
    p_user_id: userId,
  });

  if (error) return new Map();
  const map = new Map<string, { season: number; episode: number }>();
  for (const r of data ?? []) {
    map.set(r.show_id, { season: r.next_season, episode: r.next_episode });
  }
  return map;
}

export async function markNextEpisode(
  userId: string,
  showId: string,
  season: number,
  episode: number,
): Promise<void> {
  // Insert the single episode watch
  await supabase
    .from('episode_watches')
    .upsert(
      { user_id: userId, show_id: showId, season, episode },
      { onConflict: 'user_id,show_id,season,episode' },
    );

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
