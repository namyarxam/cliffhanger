import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchShow } from '@/src/lib/data';
import { useAuth } from '@/src/providers/AuthProvider';
import {
  getUserShow,
  getWatchedEpisodes,
  cacheShowMetadata,
  getLastAiredEpisode,
} from '@/src/lib/watchlist';
import { getLists, getListsContainingItem } from '@/src/lib/lists';
import { getFriends } from '@/src/lib/friends';
import { supabase } from '@/src/lib/supabase';
import { silentCatch } from '@/src/lib/errorLog';
import type { ShowFull, UserShow, UserProfile, ListWithItems } from '@/src/lib/types';

export interface FriendWatching {
  profile: UserProfile;
  status: string;
  season: number;
  episode: number;
  rating: number | null;
}

export function useShowData(id: string | undefined) {
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [show, setShow] = useState<ShowFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userShow, setUserShow] = useState<UserShow | null>(null);
  const [watchedEps, setWatchedEps] = useState<Set<string>>(new Set());
  const [userLists, setUserLists] = useState<ListWithItems[]>([]);
  const [listsContaining, setListsContaining] = useState<Set<string>>(new Set());
  const [friendsWatching, setFriendsWatching] = useState<FriendWatching[]>([]);

  const fetchFriendsWatching = useCallback(async () => {
    if (!userId || !id) return;
    try {
      const friends = await getFriends(userId);
      if (friends.length === 0) { setFriendsWatching([]); return; }
      const friendIds = friends.map(f => f.user.id);
      const { data } = await supabase
        .from('user_shows')
        .select('user_id, status, current_season, current_episode, rating')
        .eq('show_id', id)
        .in('user_id', friendIds);

      if (!data || data.length === 0) { setFriendsWatching([]); return; }

      const profileMap = new Map(friends.map(f => [f.user.id, f.user]));
      setFriendsWatching(data.map(d => {
        const friendProfile = profileMap.get(d.user_id)!;
        return {
          profile: friendProfile,
          status: d.status,
          season: d.current_season,
          episode: d.current_episode,
          rating: friendProfile?.hide_ratings ? null : (d.rating ?? null),
        };
      }).filter(d => d.profile));
    } catch (e) { silentCatch('show:friendsWatching')(e); }
  }, [userId, id]);

  const fetchAll = useCallback(() => {
    setShow(null);
    setUserShow(null);
    setWatchedEps(new Set());
    setUserLists([]);
    setListsContaining(new Set());
    setFriendsWatching([]);
    setLoading(true);
    setError(null);

    if (!id) return;
    fetchShow(id)
      .then(setShow)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

    if (userId) {
      getLists(userId).then(l => setUserLists(l.filter(ll => ll.type === 'shows'))).catch(silentCatch('show:lists'));
      getListsContainingItem(userId, id).then(ids => setListsContaining(new Set(ids))).catch(silentCatch('show:listsContaining'));
      fetchFriendsWatching();
    }
  }, [id, userId, fetchFriendsWatching]);

  // Reset everything when navigating to a different show
  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!userId || !id) return;
    getUserShow(userId, id).then(setUserShow).catch(silentCatch('show:userShow'));
  }, [userId, id]);

  // Refresh the My-Shows cache every time the user opens this screen.
  // Drives sub-grouping (status + next airdate) and the cache-fallback
  // "Behind" detection (last-aired episode) without a separate cron job.
  useEffect(() => {
    if (!userId || !id || !show) return;
    const lastAired = getLastAiredEpisode(show.seasons);
    cacheShowMetadata(
      userId,
      id,
      show.status,
      show.nextEpisode
        ? { season: show.nextEpisode.season, episode: show.nextEpisode.number, airdate: show.nextEpisode.airdate }
        : null,
      lastAired ? { season: lastAired.season, episode: lastAired.episode, airdate: lastAired.airdate } : null,
    ).catch(silentCatch('show:cacheMetadata'));
  }, [userId, id, show]);

  useEffect(() => {
    if (!userId || !id || !userShow) return;
    getWatchedEpisodes(userId, id).then(setWatchedEps).catch(silentCatch('show:watchedEps'));
  }, [userId, id, userShow]);

  const refetchWatchedEps = useCallback(() => {
    if (!userId || !id) return;
    getWatchedEpisodes(userId, id).then(setWatchedEps).catch(silentCatch('show:watchedEps'));
  }, [userId, id]);

  return {
    show,
    loading,
    error,
    userId,
    userShow,
    setUserShow,
    watchedEps,
    setWatchedEps,
    userLists,
    listsContaining,
    setListsContaining,
    friendsWatching,
    refetchWatchedEps,
    refetchFriendsWatching: fetchFriendsWatching,
    refetch: fetchAll,
  };
}
