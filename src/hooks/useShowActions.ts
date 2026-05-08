import { useCallback } from 'react';
import { Alert, LayoutAnimation } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  addShow,
  updateShowStatus,
  removeShow,
  markExactlyUpTo,
  rateShow,
  toggleShowNotify,
  getLastAiredEpisode,
  buildEpisodeSet,
  countAiredEpisodes,
} from '@/src/lib/watchlist';
import { addListItem, removeListItem } from '@/src/lib/lists';
import { silentCatch } from '@/src/lib/errorLog';
import { qk } from '@/src/lib/queryKeys';
import type { ShowFull, Season, WatchStatus, UserShow } from '@/src/lib/types';

// Walk back one episode within a season, or to the last episode of the prior
// season. Returns null when the input is the very first episode of the show.
function getPreviousEpisode(
  seasons: Season[],
  season: number,
  episode: number,
): { season: number; episode: number } | null {
  if (episode > 1) return { season, episode: episode - 1 };
  const prev = seasons.find(s => s.number === season - 1);
  if (!prev || prev.episodes.length === 0) return null;
  const last = prev.episodes[prev.episodes.length - 1];
  return { season: prev.number, episode: last.number };
}

interface ShowActionsDeps {
  userId: string | undefined;
  id: string | undefined;
  show: ShowFull | null;
  userShow: UserShow | null;
  setUserShow: React.Dispatch<React.SetStateAction<UserShow | null>>;
  setWatchedEps: React.Dispatch<React.SetStateAction<Set<string>>>;
  setListsContaining: React.Dispatch<React.SetStateAction<Set<string>>>;
  refetchWatchedEps: () => void;
}

export function useShowActions(deps: ShowActionsDeps) {
  const { userId, id, show, userShow, setUserShow, setWatchedEps, setListsContaining, refetchWatchedEps } = deps;
  const queryClient = useQueryClient();

  // After any mutation that changes user/show data, invalidate the My Shows
  // queries so that screen sees fresh data on next focus. Show-detail's own
  // queries are kept in sync via the setUserShow / setWatchedEps wrappers
  // that write through to the shared cache.
  const invalidateMyShows = useCallback(() => {
    if (!userId) return;
    queryClient.invalidateQueries({ queryKey: qk.userShows.all(userId) });
    queryClient.invalidateQueries({ queryKey: qk.nextEpisodes(userId) });
    queryClient.invalidateQueries({ queryKey: qk.watchedCounts(userId) });
    queryClient.invalidateQueries({ queryKey: qk.airingToday(userId) });
  }, [queryClient, userId]);

  const handleAddToList = useCallback(async (listId: string) => {
    if (!show) return;
    try {
      await addListItem(listId, show.id, show.title, show.image);
      setListsContaining(prev => new Set(prev).add(listId));
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to add');
    }
  }, [show, setListsContaining]);

  const handleRemoveFromList = useCallback(async (listId: string) => {
    if (!show) return;
    try {
      await removeListItem(listId, show.id);
      setListsContaining(prev => {
        const next = new Set(prev);
        next.delete(listId);
        return next;
      });
    } catch (e) { silentCatch('show:removeFromList')(e); }
  }, [show, setListsContaining]);

  const handleAddWithStatus = useCallback(async (status: WatchStatus) => {
    if (!userId || !show) return;
    // Optimistic: render post-click state immediately; reconcile with server result (or revert on failure).
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const nowIso = new Date().toISOString();
    const lastAired = getLastAiredEpisode(show.seasons);
    setUserShow({
      user_id: userId,
      show_id: show.id,
      status,
      show_title: show.title,
      show_image: show.image,
      show_network: show.network,
      show_status: show.status,
      next_episode_airdate: show.nextEpisode?.airdate ?? null,
      next_episode_season: show.nextEpisode?.season ?? null,
      next_episode_episode: show.nextEpisode?.number ?? null,
      last_aired_season: lastAired?.season ?? null,
      last_aired_episode: lastAired?.episode ?? null,
      last_aired_airdate: lastAired?.airdate ?? null,
      returning_announced_at: null,
      returning_seen_at: null,
      total_aired_episodes: countAiredEpisodes(show.seasons),
      current_season: 0,
      current_episode: 0,
      current_episode_airdate: null,
      new_episodes_seen_at: nowIso,
      caught_up: false,
      notify: false,
      rating: null,
      added_at: nowIso,
      updated_at: nowIso,
    });
    try {
      const { currentSeason, currentEpisode } = await addShow(userId, show.id, status, show.title, show.image, show.network, {
        showStatus: show.status,
        nextEpisodeAirdate: show.nextEpisode?.airdate ?? null,
        nextEpisodeSeason: show.nextEpisode?.season ?? null,
        nextEpisodeEpisode: show.nextEpisode?.number ?? null,
        lastAiredSeason: lastAired?.season ?? null,
        lastAiredEpisode: lastAired?.episode ?? null,
        lastAiredAirdate: lastAired?.airdate ?? null,
        totalAiredEpisodes: countAiredEpisodes(show.seasons),
      });
      // addShow restores previous episode_watches progress if the show was added before.
      // If that restored progress differs from our optimistic (0,0), reconcile silently.
      if (currentSeason !== 0 || currentEpisode !== 0) {
        setUserShow(prev => prev ? { ...prev, current_season: currentSeason, current_episode: currentEpisode } : null);
      }
      invalidateMyShows();
    } catch (e) {
      silentCatch('show:addWithStatus')(e);
      setUserShow(null);
    }
  }, [userId, show, setUserShow, invalidateMyShows]);

  const handleStatusChange = useCallback(async (status: WatchStatus, opts?: { confirm?: boolean }) => {
    if (!userId || !id || !userShow) return;
    const confirm = opts?.confirm ?? true;

    // Re-tapping the active status = un-track the show. Default behavior
    // shows a confirm alert (to prevent fat-fingered loss of Watching /
    // Watched progress); callers can opt out with confirm=false — used
    // by the muted toggle, where re-tap is the obvious "unmute" action.
    if (status === userShow.status) {
      const doRemove = async () => {
        try {
          await removeShow(userId, id);
          setUserShow(null);
          invalidateMyShows();
        } catch (e) { silentCatch('show:remove')(e); }
      };
      if (!confirm) {
        await doRemove();
        return;
      }
      Alert.alert(
        'Remove from list?',
        'Your episode progress will be saved if you add it back later.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: doRemove },
        ],
      );
      return;
    }

    // Snapshot for rollback in case server update fails.
    const prevUserShow = userShow;

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (status === 'watched' && show) {
      const lastAired = getLastAiredEpisode(show.seasons);
      // Optimistic: apply the full "watched" state (progress bumped to last aired) immediately.
      setUserShow(prev => prev ? {
        ...prev,
        status: 'watched',
        current_season: lastAired?.season ?? 0,
        current_episode: lastAired?.episode ?? 0,
        current_episode_airdate: lastAired?.airdate ?? null,
        updated_at: new Date().toISOString(),
      } : null);
      if (lastAired) {
        setWatchedEps(buildEpisodeSet(show.seasons, lastAired.season, lastAired.episode));
      }
      try {
        if (lastAired) {
          const newSet = await markExactlyUpTo(userId, id, lastAired.season, lastAired.episode, show.seasons);
          setWatchedEps(newSet);
        }
        await updateShowStatus(userId, id, 'watched');
        invalidateMyShows();
      } catch (e) {
        silentCatch('show:statusChange:watched')(e);
        setUserShow(prevUserShow);
        refetchWatchedEps();
      }
    } else {
      setUserShow(prev => prev ? { ...prev, status, updated_at: new Date().toISOString() } : null);
      try {
        await updateShowStatus(userId, id, status);
        invalidateMyShows();
      } catch (e) {
        silentCatch('show:statusChange')(e);
        setUserShow(prevUserShow);
      }
    }
  }, [userId, id, userShow, show, setUserShow, setWatchedEps, refetchWatchedEps, invalidateMyShows]);

  const handleCatchUp = useCallback(async () => {
    if (!userId || !id || !show) return;
    const lastAired = getLastAiredEpisode(show.seasons);
    if (!lastAired) return;

    // Optimistic
    setWatchedEps(buildEpisodeSet(show.seasons, lastAired.season, lastAired.episode));

    try {
      const newSet = await markExactlyUpTo(userId, id, lastAired.season, lastAired.episode, show.seasons);
      setWatchedEps(newSet);
      setUserShow(prev => prev ? {
        ...prev,
        status: 'currently_watching',
        current_season: lastAired.season,
        current_episode: lastAired.episode,
        current_episode_airdate: lastAired.airdate,
        caught_up: true,
      } : null);
      invalidateMyShows();
    } catch {
      refetchWatchedEps();
    }
  }, [userId, id, show, setWatchedEps, setUserShow, refetchWatchedEps, invalidateMyShows]);

  const handleRate = useCallback(async (rating: number) => {
    if (!userId || !id) return;
    // Optimistic — flip the cached userShow.rating BEFORE awaiting the
    // network write. RatingSelector clears its local tempRating on release
    // and falls back to the `rating` prop (sourced from userShow.rating);
    // without an optimistic write, the slider snaps back to the old value
    // for the duration of the network roundtrip, then jumps to the new
    // value once the await resolves — a visible half-second flash.
    let prevRating: number | null = null;
    setUserShow(prev => {
      if (!prev) return null;
      prevRating = prev.rating ?? null;
      return { ...prev, rating };
    });
    try {
      await rateShow(userId, id, rating);
      invalidateMyShows();
    } catch (e) {
      silentCatch('show:rate')(e);
      // Revert on failure so the slider doesn't lie about persisted state.
      setUserShow(prev => prev ? { ...prev, rating: prevRating } : null);
    }
  }, [userId, id, setUserShow, invalidateMyShows]);

  const handleEpisodeTap = useCallback(async (season: number, episode: number) => {
    if (!userId || !id || !show) return;

    // Tapping the currently-selected episode regresses by one. Lets users
    // undo a misclick or course-correct without hunting for the previous
    // dot. S1E1 → clears all progress (current goes to 0/0); the show stays
    // in currently_watching with no episodes marked.
    if (
      userShow &&
      userShow.current_season === season &&
      userShow.current_episode === episode
    ) {
      const target = getPreviousEpisode(show.seasons, season, episode) ?? { season: 0, episode: 0 };
      setWatchedEps(buildEpisodeSet(show.seasons, target.season, target.episode));
      try {
        const newSet = await markExactlyUpTo(userId, id, target.season, target.episode, show.seasons);
        setWatchedEps(newSet);
        const lastAired = getLastAiredEpisode(show.seasons);
        const tapCaughtUp = lastAired != null && target.season === lastAired.season && target.episode === lastAired.episode;
        setUserShow(prev => prev ? {
          ...prev,
          status: 'currently_watching',
          current_season: target.season,
          current_episode: target.episode,
          caught_up: tapCaughtUp,
        } : null);
        invalidateMyShows();
      } catch {
        refetchWatchedEps();
      }
      return;
    }

    // Auto-add to watchlist if not already added
    if (!userShow) {
      const lastAired = getLastAiredEpisode(show.seasons);
      await addShow(userId, id, 'currently_watching', show.title, show.image, show.network, {
        showStatus: show.status,
        nextEpisodeAirdate: show.nextEpisode?.airdate ?? null,
        nextEpisodeSeason: show.nextEpisode?.season ?? null,
        nextEpisodeEpisode: show.nextEpisode?.number ?? null,
        lastAiredSeason: lastAired?.season ?? null,
        lastAiredEpisode: lastAired?.episode ?? null,
        lastAiredAirdate: lastAired?.airdate ?? null,
        totalAiredEpisodes: countAiredEpisodes(show.seasons),
      });
      const targetSeason = show.seasons.find(s => s.number === season);
      const targetEp = targetSeason?.episodes.find(e => e.number === episode);
      const tapCaughtUp = lastAired != null && season === lastAired.season && episode === lastAired.episode;
      setUserShow({
        user_id: userId,
        show_id: id,
        status: 'currently_watching',
        show_title: show.title,
        show_image: show.image,
        show_network: show.network,
        show_status: show.status,
        next_episode_airdate: show.nextEpisode?.airdate ?? null,
        next_episode_season: show.nextEpisode?.season ?? null,
        next_episode_episode: show.nextEpisode?.number ?? null,
        last_aired_season: lastAired?.season ?? null,
        last_aired_episode: lastAired?.episode ?? null,
        last_aired_airdate: lastAired?.airdate ?? null,
        returning_announced_at: null,
        returning_seen_at: null,
        total_aired_episodes: countAiredEpisodes(show.seasons),
        current_season: season,
        current_episode: episode,
        current_episode_airdate: targetEp?.airdate ?? null,
        new_episodes_seen_at: new Date().toISOString(),
        caught_up: tapCaughtUp,
        notify: false,
        rating: null,
        added_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    // Optimistic
    const lastAired = getLastAiredEpisode(show.seasons);
    const tapCaughtUp = lastAired != null && season === lastAired.season && episode === lastAired.episode;
    setWatchedEps(buildEpisodeSet(show.seasons, season, episode));

    try {
      const newSet = await markExactlyUpTo(userId, id, season, episode, show.seasons);
      setWatchedEps(newSet);
      setUserShow(prev => prev ? {
        ...prev,
        status: 'currently_watching',
        current_season: season,
        current_episode: episode,
        caught_up: tapCaughtUp,
      } : null);
      invalidateMyShows();
    } catch {
      refetchWatchedEps();
    }
  }, [userId, id, show, userShow, setUserShow, setWatchedEps, refetchWatchedEps, invalidateMyShows]);

  const handleToggleNotify = useCallback(async () => {
    if (!userId || !id || !userShow) return;
    const newValue = !userShow.notify;
    setUserShow(prev => prev ? { ...prev, notify: newValue } : null);
    try {
      await toggleShowNotify(userId, id, newValue);
      invalidateMyShows();
    } catch (e) {
      setUserShow(prev => prev ? { ...prev, notify: !newValue } : null);
      silentCatch('show:toggleNotify')(e);
    }
  }, [userId, id, userShow, setUserShow, invalidateMyShows]);

  return {
    handleAddToList,
    handleRemoveFromList,
    handleAddWithStatus,
    handleStatusChange,
    handleCatchUp,
    handleRate,
    handleEpisodeTap,
    handleToggleNotify,
  };
}
