import { useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchShow } from '@/src/lib/data';
import { useAuth } from '@/src/providers/AuthProvider';
import {
  getUserShow,
  getWatchedEpisodes,
  cacheShowMetadata,
  getLastAiredEpisode,
  countAiredEpisodes,
} from '@/src/lib/watchlist';
import { getLists, getListsContainingItem } from '@/src/lib/lists';
import { getFriends } from '@/src/lib/friends';
import { supabase } from '@/src/lib/supabase';
import { silentCatch } from '@/src/lib/errorLog';
import { qk } from '@/src/lib/queryKeys';
import type { ShowFull, UserShow, UserProfile, ListWithItems } from '@/src/lib/types';

export interface FriendWatching {
  profile: UserProfile;
  status: string;
  season: number;
  episode: number;
  rating: number | null;
}

const EMPTY_WATCHED_EPS: Set<string> = new Set();
const EMPTY_LISTS_CONTAINING: Set<string> = new Set();
const EMPTY_USER_LISTS: ListWithItems[] = [];
const EMPTY_FRIENDS_WATCHING: FriendWatching[] = [];

export function useShowData(id: string | undefined) {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();
  const enabled = !!id;
  const userEnabled = !!userId && !!id;

  // Show metadata from TVMaze. Doesn't change between visits, so the default
  // 30s staleTime is plenty — most navigations rehydrate from cache.
  const showQuery = useQuery({
    queryKey: qk.show(id),
    queryFn: () => fetchShow(id!),
    enabled,
  });

  const userShowQuery = useQuery({
    queryKey: qk.userShow(userId, id),
    queryFn: () => getUserShow(userId!, id!),
    enabled: userEnabled,
  });

  // Watched episodes only matters once the user has the show on their list.
  // Gating on userShowQuery.data avoids a wasted fetch when the user is
  // viewing a show they haven't added.
  const watchedEpsQuery = useQuery({
    queryKey: qk.watchedEps(userId, id),
    queryFn: () => getWatchedEpisodes(userId!, id!),
    enabled: userEnabled && !!userShowQuery.data,
  });

  const userListsQuery = useQuery({
    queryKey: qk.lists(userId),
    queryFn: async () => {
      const all = await getLists(userId!);
      return all.filter(l => l.type === 'shows');
    },
    enabled: !!userId,
  });

  const listsContainingQuery = useQuery({
    queryKey: qk.listsContaining(userId, id),
    queryFn: async () => new Set(await getListsContainingItem(userId!, id!)),
    enabled: userEnabled,
  });

  const friendsWatchingQuery = useQuery({
    queryKey: qk.friendsWatching(userId, id),
    queryFn: async (): Promise<FriendWatching[]> => {
      const friends = await getFriends(userId!);
      if (friends.length === 0) return [];
      const friendIds = friends.map(f => f.user.id);
      const { data } = await supabase
        .from('user_shows')
        .select('user_id, status, current_season, current_episode, rating')
        .eq('show_id', id!)
        .in('user_id', friendIds);
      if (!data || data.length === 0) return [];
      const profileMap = new Map(friends.map(f => [f.user.id, f.user]));
      return data
        .map(d => {
          const friendProfile = profileMap.get(d.user_id);
          if (!friendProfile) return null;
          return {
            profile: friendProfile,
            status: d.status,
            season: d.current_season,
            episode: d.current_episode,
            rating: friendProfile.hide_ratings ? null : (d.rating ?? null),
          };
        })
        .filter((d): d is FriendWatching => d !== null);
    },
    enabled: userEnabled,
  });

  // Refresh the My-Shows TVMaze cache every time the user opens this screen.
  // Drives sub-grouping (status + next airdate) and the cache-fallback
  // "Behind" detection (last-aired episode) without a separate cron job.
  // Side-effect only — not a query.
  useEffect(() => {
    if (!userId || !id || !showQuery.data) return;
    const show = showQuery.data;
    const lastAired = getLastAiredEpisode(show.seasons);
    cacheShowMetadata(
      id,
      show.status,
      show.nextEpisode
        ? { season: show.nextEpisode.season, episode: show.nextEpisode.number, airdate: show.nextEpisode.airdate }
        : null,
      lastAired ? { season: lastAired.season, episode: lastAired.episode, airdate: lastAired.airdate } : null,
      countAiredEpisodes(show.seasons),
    ).catch(silentCatch('show:cacheMetadata'));
  }, [userId, id, showQuery.data]);

  // Backward-compat setX wrappers — useShowActions writes to these to do
  // optimistic updates. Routing through queryClient.setQueryData means the
  // optimistic write lives in the shared cache and any other screen reading
  // the same key sees it instantly.
  const setUserShow = useCallback<React.Dispatch<React.SetStateAction<UserShow | null>>>(
    (updater) => {
      queryClient.setQueryData<UserShow | null>(qk.userShow(userId, id), prev => {
        if (typeof updater === 'function') {
          return (updater as (p: UserShow | null | undefined) => UserShow | null)(prev ?? null);
        }
        return updater;
      });
    },
    [queryClient, userId, id],
  );

  const setWatchedEps = useCallback<React.Dispatch<React.SetStateAction<Set<string>>>>(
    (updater) => {
      queryClient.setQueryData<Set<string>>(qk.watchedEps(userId, id), prev => {
        const base = prev ?? EMPTY_WATCHED_EPS;
        if (typeof updater === 'function') {
          return (updater as (p: Set<string>) => Set<string>)(base);
        }
        return updater;
      });
    },
    [queryClient, userId, id],
  );

  const setListsContaining = useCallback<React.Dispatch<React.SetStateAction<Set<string>>>>(
    (updater) => {
      queryClient.setQueryData<Set<string>>(qk.listsContaining(userId, id), prev => {
        const base = prev ?? EMPTY_LISTS_CONTAINING;
        if (typeof updater === 'function') {
          return (updater as (p: Set<string>) => Set<string>)(base);
        }
        return updater;
      });
    },
    [queryClient, userId, id],
  );

  const refetchWatchedEps = useCallback(() => {
    if (!userId || !id) return;
    queryClient.invalidateQueries({ queryKey: qk.watchedEps(userId, id) });
  }, [queryClient, userId, id]);

  const refetchUserShow = useCallback(() => {
    if (!userId || !id) return;
    queryClient.invalidateQueries({ queryKey: qk.userShow(userId, id) });
  }, [queryClient, userId, id]);

  const refetchFriendsWatching = useCallback(() => {
    if (!userId || !id) return;
    queryClient.invalidateQueries({ queryKey: qk.friendsWatching(userId, id) });
  }, [queryClient, userId, id]);

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.show(id) });
    if (userId && id) {
      queryClient.invalidateQueries({ queryKey: qk.userShow(userId, id) });
      queryClient.invalidateQueries({ queryKey: qk.watchedEps(userId, id) });
      queryClient.invalidateQueries({ queryKey: qk.lists(userId) });
      queryClient.invalidateQueries({ queryKey: qk.listsContaining(userId, id) });
      queryClient.invalidateQueries({ queryKey: qk.friendsWatching(userId, id) });
    }
  }, [queryClient, userId, id]);

  return {
    show: showQuery.data ?? null,
    loading: showQuery.isLoading,
    error: showQuery.error ? (showQuery.error as Error).message : null,
    userId,
    userShow: userShowQuery.data ?? null,
    setUserShow,
    watchedEps: watchedEpsQuery.data ?? EMPTY_WATCHED_EPS,
    setWatchedEps,
    userLists: userListsQuery.data ?? EMPTY_USER_LISTS,
    listsContaining: listsContainingQuery.data ?? EMPTY_LISTS_CONTAINING,
    setListsContaining,
    friendsWatching: friendsWatchingQuery.data ?? EMPTY_FRIENDS_WATCHING,
    refetchWatchedEps,
    refetchUserShow,
    refetchFriendsWatching,
    refetch,
  };
}
