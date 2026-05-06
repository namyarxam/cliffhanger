import { useState, useCallback, useEffect, useMemo } from 'react';
import * as Notifications from 'expo-notifications';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  Pressable,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/src/lib/queryKeys';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getUserShows, getNextEpisodesForShows, getShowsAiringToday, getReturnAnnouncements, markReturnAnnouncementSeen, markNextEpisode, updateShowStatus, getWatchedCounts } from '@/src/lib/watchlist';
import type { NextEpisode, ReturnAnnouncement } from '@/src/lib/watchlist';
import WatchlistCard from '@/src/components/WatchlistCard';
import EpisodeCatchUpSheet from '@/src/components/EpisodeCatchUpSheet';
import ReturnAnnouncementCard from '@/src/components/ReturnAnnouncementCard';
import LoaderFlavor, { SHELF_MESSAGES } from '@/src/components/LoaderFlavor';
import type { UserShow } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';

// Stable empty defaults for `data ?? EMPTY` fallbacks. Without these, every
// render would allocate a fresh `[]` / `new Set()` / `new Map()`, breaking
// referential equality for downstream useMemo deps and forcing the whole
// tree to re-evaluate.
const EMPTY_SHOWS: UserShow[] = [];
const EMPTY_NEXT_EPISODES: Map<string, NextEpisode> = new Map();
const EMPTY_AIRING_TODAY: Set<string> = new Set();
const EMPTY_ANNOUNCEMENTS: ReturnAnnouncement[] = [];
const EMPTY_WATCHED_COUNTS: Map<string, number> = new Map();

// Window for the "Back soon" banner treatment + the iOS app icon badge.
// Keep in sync with SOON_DAYS in ReturnAnnouncementCard.
const SOON_DAYS = 5;

function isSoonAnnouncement(a: ReturnAnnouncement): boolean {
  if (!a.next_episode_airdate) return false;
  const epDate = new Date(a.next_episode_airdate + 'T00:00:00');
  const days = Math.round((epDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return days >= 0 && days <= SOON_DAYS;
}

function sortTitle(t: string): string {
  return t.replace(/^The\s+/i, '');
}

// Sub-groups within Currently Watching, in render order.
//   watching:  actively airing right now — either user is behind on aired
//              episodes, or they're caught up and the next episode is within
//              the active-airing window (~14 days). Mid-season state.
//   returning: caught up, next episode is further out (between seasons).
//   hiatus:    not currently airing, no scheduled return. Also the fallback
//              bucket for legacy rows with NULL show_status.
//   ended:     TVMaze status is "Ended" — gets a soft "move to Watched?" nudge.
type CWGroup = 'watching' | 'returning' | 'hiatus' | 'ended';

const CW_GROUP_TITLES: Record<CWGroup, string> = {
  watching: 'Watching',
  returning: 'Returning',
  hiatus: 'On Hiatus',
  ended: 'Series Ended',
};

// Premiere detection. The fingerprint of a season premiere:
//   - Day-of: last aired episode IS E1 of a season newer than user's current.
//             Means cron just bumped last_aired to today's premiere.
//   - Upcoming: caught up, next future episode is E1 of a season newer than
//             user's current.
// Multi-season catch-up (user on S1E4 of a 4-season show) is NOT a premiere
// — last aired is S4Ex with x > 1, so the E1 check fails.
function isPremiereDayState(s: UserShow): boolean {
  return (
    // current_season > 0 guard: premiere copy is only meaningful if the
    // user was actually following the show. Without this, a fresh add of
    // a long-running show (current=0, last_aired=S2E1+) trivially passes
    // the season comparison and misfires as "PREMIERES TODAY".
    s.current_season > 0 &&
    s.last_aired_season != null &&
    s.last_aired_episode === 1 &&
    s.last_aired_season > s.current_season
  );
}
function isPremiereUpcomingState(s: UserShow): boolean {
  return (
    s.current_season > 0 &&
    !!s.next_episode_airdate &&
    s.show_status !== 'Ended' &&
    s.next_episode_season != null &&
    s.next_episode_episode === 1 &&
    s.next_episode_season > s.current_season
  );
}

// "Behind" has two signals:
//   1. The schedule cron picked up an aired episode past the user's progress
//      (fast/eager — works the day a new ep drops, but only if the cron ran).
//   2. The cached last-aired episode (set when the user last opened the show
//      detail page) is past the user's progress (reliable fallback — self-heals
//      on the next show-page visit if the cron missed the episode).
function isBehindFromCache(s: UserShow): boolean {
  if (s.last_aired_season == null || s.last_aired_episode == null) return false;
  if (s.last_aired_season > s.current_season) return true;
  if (s.last_aired_season === s.current_season && s.last_aired_episode > s.current_episode) return true;
  return false;
}

function classifyCW(s: UserShow, hasNextFromSchedule: boolean): CWGroup {
  const isBehind = hasNextFromSchedule || isBehindFromCache(s);
  // Premiere day: user is "behind" by exactly E1 of a new season that just
  // aired. Hold in Returning until they tap the premiere ✓.
  if (isBehind && isPremiereDayState(s)) return 'returning';
  if (isBehind) return 'watching';
  if (s.show_status === 'Ended') return 'ended';
  if (s.next_episode_airdate) {
    // Caught up + airdate: Returning if it's the upcoming-premiere of a new
    // season; otherwise Watching (mid-season caught up, just waiting for
    // the next regular episode).
    return isPremiereUpcomingState(s) ? 'returning' : 'watching';
  }
  return 'hiatus';
}

export default function MyShowsScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { session, profile } = useAuth();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();

  // ─── Queries ────────────────────────────────────────────────────────────
  // All seven were previously useState + a Promise.allSettled fetchData on
  // useFocusEffect. TanStack Query handles cache, dedup, refetch on stale,
  // and stale-while-revalidate — so switching tabs back doesn't show a
  // flash of old data, and a mutation in another screen invalidates these
  // and they refetch in background. Each query is independently failable,
  // matching the old allSettled behavior (one blip doesn't blank the screen).
  const enabled = !!userId;
  const userShowsQuery = useQuery({
    queryKey: ['userShows', userId],
    queryFn: () => getUserShows(userId!),
    enabled,
  });
  const nextEpisodesQuery = useQuery({
    queryKey: ['nextEpisodes', userId],
    queryFn: () => getNextEpisodesForShows(userId!),
    enabled,
  });
  const airingTodayQuery = useQuery({
    queryKey: ['airingToday', userId],
    queryFn: () => getShowsAiringToday(userId!),
    enabled,
  });
  const returnAnnouncementsQuery = useQuery({
    queryKey: ['returnAnnouncements', userId],
    queryFn: () => getReturnAnnouncements(userId!),
    enabled,
  });
  const watchedCountsQuery = useQuery({
    queryKey: ['watchedCounts', userId],
    queryFn: () => getWatchedCounts(userId!),
    enabled,
  });

  // Derived state with safe defaults — keeps the rest of the render code
  // identical to the pre-migration version.
  const shows = userShowsQuery.data ?? EMPTY_SHOWS;
  const nextEpisodes = nextEpisodesQuery.data?.nextEpisodes ?? EMPTY_NEXT_EPISODES;
  const airingToday = airingTodayQuery.data ?? EMPTY_AIRING_TODAY;
  const returnAnnouncements = returnAnnouncementsQuery.data ?? EMPTY_ANNOUNCEMENTS;
  const watchedCounts = watchedCountsQuery.data ?? EMPTY_WATCHED_COUNTS;

  // Initial load = isLoading (no cached data yet). Refresh control = the
  // pull-to-refresh manual trigger (state below).
  const loading = userShowsQuery.isLoading;
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [catchUpTarget, setCatchUpTarget] = useState<UserShow | null>(null);

  // Surface query errors via Sentry once they settle (post-fetch). No render
  // impact — UI keeps last-known data on transient failures, matching the
  // old Promise.allSettled per-slice behavior.
  useEffect(() => {
    if (userShowsQuery.error) silentCatch('myShows:getUserShows')(userShowsQuery.error);
  }, [userShowsQuery.error]);
  useEffect(() => {
    if (nextEpisodesQuery.error) silentCatch('myShows:getNextEpisodes')(nextEpisodesQuery.error);
  }, [nextEpisodesQuery.error]);
  useEffect(() => {
    if (airingTodayQuery.error) silentCatch('myShows:getAiringToday')(airingTodayQuery.error);
  }, [airingTodayQuery.error]);
  useEffect(() => {
    if (returnAnnouncementsQuery.error) silentCatch('myShows:getReturnAnnouncements')(returnAnnouncementsQuery.error);
  }, [returnAnnouncementsQuery.error]);
  useEffect(() => {
    if (watchedCountsQuery.error) silentCatch('myShows:getWatchedCounts')(watchedCountsQuery.error);
  }, [watchedCountsQuery.error]);

  // Mark queries stale on tab focus so they background-refetch if data is
  // older than staleTime. Cached render shows immediately; fresh data swaps
  // in when ready (stale-while-revalidate). Replaces the old useFocusEffect
  // that did a synchronous full-refetch.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      queryClient.invalidateQueries({ queryKey: ['userShows', userId] });
      queryClient.invalidateQueries({ queryKey: ['nextEpisodes', userId] });
      queryClient.invalidateQueries({ queryKey: ['airingToday', userId] });
      queryClient.invalidateQueries({ queryKey: ['returnAnnouncements', userId] });
      queryClient.invalidateQueries({ queryKey: ['watchedCounts', userId] });
    }, [userId, queryClient])
  );

  // Mirror the "soon" announcement count to the iOS app icon badge. Cleared
  // automatically when the user dismisses (returnAnnouncements shrinks) and
  // re-set on every fetchData. Cron sends a parallel silent push from the
  // server side so the badge can update before the user opens the app.
  useEffect(() => {
    const count = returnAnnouncements.filter(isSoonAnnouncement).length;
    Notifications.setBadgeCountAsync(count).catch(silentCatch('myShows:badge'));
  }, [returnAnnouncements]);

  const handlePress = useCallback((id: string) => {
    router.push(`/show/${id}?from=/`);
  }, [router]);

  const handleMarkNext = useCallback(async (showId: string, season: number, episode: number) => {
    if (!userId) return;
    // Optimistic update — writes directly to the cache so dependent screens
    // (show detail, etc) see the change instantly. On error, invalidate so
    // the cache refetches from server truth.
    // The nextEpisodes query stores `{ nextEpisodes: Map }`, not the bare Map —
    // matching the queryFn return shape. Wrapping the bare Map in new Map()
    // would TypeError since the object isn't iterable.
    queryClient.setQueryData<{ nextEpisodes: Map<string, NextEpisode> }>(['nextEpisodes', userId], prev => {
      const nextMap = new Map(prev?.nextEpisodes ?? EMPTY_NEXT_EPISODES);
      nextMap.delete(showId);
      return { nextEpisodes: nextMap };
    });
    queryClient.setQueryData<UserShow[]>(['userShows', userId], prev =>
      (prev ?? EMPTY_SHOWS).map(s =>
        s.show_id === showId ? { ...s, current_season: season, current_episode: episode } : s,
      ),
    );

    try {
      await markNextEpisode(userId, showId, season, episode);
      // Invalidate so any other screens / future renders pick up freshness.
      // The wrapping NextEpisodes query also returns its own caught_up data —
      // letting it refetch handles the "no more next episodes → caught_up=true"
      // transition without us re-implementing it here.
      queryClient.invalidateQueries({ queryKey: ['nextEpisodes', userId] });
      queryClient.invalidateQueries({ queryKey: ['userShows', userId] });
      queryClient.invalidateQueries({ queryKey: ['watchedCounts', userId] });
    } catch (e) {
      silentCatch('myShows:markNext')(e);
      // Rollback the optimistic write by refetching from server.
      queryClient.invalidateQueries({ queryKey: ['userShows', userId] });
      queryClient.invalidateQueries({ queryKey: ['nextEpisodes', userId] });
    }
  }, [userId, queryClient]);

  const toggleSection = useCallback((title: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }, []);

  const handleCatchUp = useCallback((show: UserShow) => {
    setCatchUpTarget(show);
  }, []);

  const handleDismissAnnouncement = useCallback(async (showId: string) => {
    if (!userId) return;
    queryClient.setQueryData<ReturnAnnouncement[]>(
      ['returnAnnouncements', userId],
      prev => (prev ?? EMPTY_ANNOUNCEMENTS).filter(a => a.show_id !== showId),
    );
    try {
      await markReturnAnnouncementSeen(userId, showId);
    } catch (e) {
      silentCatch('myShows:dismissAnnouncement')(e);
      queryClient.invalidateQueries({ queryKey: ['returnAnnouncements', userId] });
    }
  }, [userId, queryClient]);

  const handleAnnouncementPress = useCallback((showId: string) => {
    handleDismissAnnouncement(showId);
    router.push(`/show/${showId}?from=/`);
  }, [router, handleDismissAnnouncement]);

  const handleMarkWatched = useCallback(async (showId: string) => {
    if (!userId) return;
    // Optimistic: drop from the list (Watched isn't shown on My Shows).
    queryClient.setQueryData<UserShow[]>(['userShows', userId], prev =>
      (prev ?? EMPTY_SHOWS).filter(s => s.show_id !== showId),
    );
    try {
      // Await the flip so the show detail page mounts with status='watched'
      // already in the DB — that's what reveals the inline RatingSelector
      // and surfaces the rating prompt.
      await updateShowStatus(userId, showId, 'watched');
      queryClient.invalidateQueries({ queryKey: ['userShows', userId] });
      // Per-show userShow cache lives at qk.userShow(userId, showId). Without
      // this invalidation the show-detail page rehydrates from a pre-watched
      // cache entry, status doesn't read 'watched', and the rating prompt
      // never appears.
      queryClient.invalidateQueries({ queryKey: qk.userShow(userId, showId) });
      router.push(`/show/${showId}?from=/`);
    } catch (e) {
      silentCatch('myShows:markWatched')(e);
      queryClient.invalidateQueries({ queryKey: ['userShows', userId] });
    }
  }, [userId, router, queryClient]);

  // Split currently_watching into the four sub-groups; everything else stays
  // as a single section. Memoized so SectionList sees a stable `sections`
  // reference when nothing in the inputs changed — avoids a full reconcile
  // on every parent render.
  const sections = useMemo(() => {
    const cwGroups: Record<CWGroup, UserShow[]> = { watching: [], returning: [], hiatus: [], ended: [] };
    for (const s of shows) {
      if (s.status !== 'currently_watching') continue;
      cwGroups[classifyCW(s, nextEpisodes.has(s.show_id))].push(s);
    }
    const byTitle = (a: UserShow, b: UserShow) => sortTitle(a.show_title).localeCompare(sortTitle(b.show_title));
    // Within Watching: behind shows surface first (need attention), sorted by
    // title. Caught-up actively-airing shows follow, sorted by their next
    // airdate ascending so the soonest-airing is on top.
    cwGroups.watching.sort((a, b) => {
      const aBehind = nextEpisodes.has(a.show_id) || isBehindFromCache(a);
      const bBehind = nextEpisodes.has(b.show_id) || isBehindFromCache(b);
      if (aBehind !== bBehind) return aBehind ? -1 : 1;
      if (aBehind) return byTitle(a, b);
      return (a.next_episode_airdate ?? '9999-12-31').localeCompare(b.next_episode_airdate ?? '9999-12-31');
    });
    cwGroups.returning.sort((a, b) =>
      (a.next_episode_airdate ?? '9999-12-31').localeCompare(b.next_episode_airdate ?? '9999-12-31'),
    );
    cwGroups.hiatus.sort(byTitle);
    cwGroups.ended.sort(byTitle);

    const wantToWatch = shows
      .filter(s => s.status === 'want_to_watch')
      .sort(byTitle);

    const userSections = (
      [
        { title: CW_GROUP_TITLES.watching, data: cwGroups.watching },
        { title: CW_GROUP_TITLES.returning, data: cwGroups.returning },
        { title: CW_GROUP_TITLES.hiatus, data: cwGroups.hiatus },
        { title: CW_GROUP_TITLES.ended, data: cwGroups.ended },
        { title: 'Watchlist', data: wantToWatch },
      ] as { title: string; data: UserShow[] }[]
    )
      .map(({ title, data }) => ({
        title,
        data: collapsed.has(title) ? [] : data,
        count: data.length,
      }))
      .filter(s => s.count > 0);

    return userSections;
  }, [shows, nextEpisodes, collapsed]);

  // Per-row nextEpisode lookup with cache-fallback baked in. Built once per
  // (shows, nextEpisodes) change so per-row props reference-stable across
  // renders — the previous inline-construction created a fresh object every
  // render for cache-fallback rows, defeating WatchlistCard's memo and
  // preventing SectionList from skipping rendered work for unchanged shows.
  const nextEpisodesWithFallback = useMemo(() => {
    const map = new Map<string, NextEpisode>();
    for (const s of shows) {
      const fromSchedule = nextEpisodes.get(s.show_id);
      if (fromSchedule) {
        map.set(s.show_id, fromSchedule);
      } else if (isBehindFromCache(s)) {
        const nextSeason = s.current_season;
        const nextEpisode = s.current_episode + 1;
        const isExactlyLastAired = s.last_aired_season === nextSeason && s.last_aired_episode === nextEpisode;
        map.set(s.show_id, {
          season: nextSeason,
          episode: nextEpisode,
          airdate: isExactlyLastAired ? s.last_aired_airdate : null,
          behindCount: 1,
        });
      }
    }
    return map;
  }, [shows, nextEpisodes]);

  const hidePosters = profile?.show_posters_in_list === false;

  // useCallback so SectionList's renderItem prop has stable identity across
  // re-renders. Combined with the memoized nextEpisodesWithFallback above,
  // unchanged rows skip re-rendering. Deps must include EVERY value the
  // closure reads — missing one means stale renders worse than the bug we
  // just fixed.
  const renderItem = useCallback(({ item }: { item: UserShow }) => (
    <WatchlistCard
      show={item}
      onPress={handlePress}
      nextEpisode={nextEpisodesWithFallback.get(item.show_id)}
      onMarkNext={handleMarkNext}
      onMarkWatched={handleMarkWatched}
      onCatchUp={handleCatchUp}
      isCaughtUp={item.caught_up}
      hidePosters={hidePosters}
      airsToday={airingToday.has(item.show_id)}
      watchedCount={watchedCounts.get(item.show_id) ?? 0}
    />
  ), [
    handlePress,
    handleMarkNext,
    handleMarkWatched,
    handleCatchUp,
    hidePosters,
    airingToday,
    watchedCounts,
    nextEpisodesWithFallback,
  ]);

  const keyExtractor = useCallback((item: UserShow) =>
    item.status === 'currently_watching'
      ? `${classifyCW(item, nextEpisodes.has(item.show_id))}-${item.show_id}`
      : `${item.status}-${item.show_id}`,
  [nextEpisodes]);

  if (loading) {
    return <LoaderFlavor messages={SHELF_MESSAGES} />;
  }

  if (shows.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No shows yet</Text>
        <Text style={styles.emptyText}>Search for a show and add it to your watchlist</Text>
        <Pressable
          style={({ pressed }) => [styles.searchButton, pressed && { opacity: 0.7 }]}
          onPress={() => router.push('/(tabs)/explore')}
        >
          <Text style={styles.searchButtonText}>Search Shows</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
    <SectionList
      style={styles.container}
      sections={sections}
      keyExtractor={keyExtractor}
      // VirtualizedList only re-evaluates cells when `data` references change
      // OR `extraData` changes. renderItem reads several pieces of state that
      // aren't in the section data (nextEpisodes/airingToday/watchedCounts/
      // hidePosters), so any change to those needs to invalidate cached cells.
      extraData={`${nextEpisodes.size}:${airingToday.size}:${watchedCounts.size}:${shows.length}:${hidePosters ? 1 : 0}`}
      renderItem={renderItem}
      renderSectionHeader={({ section }) => {
        return (
          <Pressable
            style={styles.sectionHeader}
            onPress={() => toggleSection(section.title)}
          >
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionCount}>{section.count}</Text>
          </Pressable>
        );
      }}
      ListHeaderComponent={
        <>
          {returnAnnouncements.length > 0 && (
            <View style={styles.announcementsBlock}>
              {returnAnnouncements.map(a => (
                <ReturnAnnouncementCard
                  key={a.show_id}
                  announcement={a}
                  onPress={handleAnnouncementPress}
                  onDismiss={handleDismissAnnouncement}
                />
              ))}
            </View>
          )}
        </>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            if (!userId) return;
            setRefreshing(true);
            try {
              await Promise.allSettled([
                queryClient.refetchQueries({ queryKey: ['userShows', userId] }),
                queryClient.refetchQueries({ queryKey: ['nextEpisodes', userId] }),
                queryClient.refetchQueries({ queryKey: ['airingToday', userId] }),
                queryClient.refetchQueries({ queryKey: ['returnAnnouncements', userId] }),
                queryClient.refetchQueries({ queryKey: ['watchedCounts', userId] }),
              ]);
            } finally {
              setRefreshing(false);
            }
          }}
          tintColor={theme.accent}
        />
      }
      contentContainerStyle={styles.list}
      stickySectionHeadersEnabled={false}
    />
    <EpisodeCatchUpSheet
      visible={catchUpTarget != null}
      onClose={() => setCatchUpTarget(null)}
      userId={userId}
      showId={catchUpTarget?.show_id ?? null}
      showTitle={catchUpTarget?.show_title ?? ''}
      currentSeason={catchUpTarget?.current_season ?? 0}
      currentEpisode={catchUpTarget?.current_episode ?? 0}
      onMarked={() => {
        if (!userId) return;
        queryClient.invalidateQueries({ queryKey: ['userShows', userId] });
        queryClient.invalidateQueries({ queryKey: ['nextEpisodes', userId] });
        queryClient.invalidateQueries({ queryKey: ['watchedCounts', userId] });
      }}
    />
    </>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  center: {
    flex: 1,
    backgroundColor: theme.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  list: {
    paddingBottom: 20,
  },
  announcementsBlock: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 28,
    paddingBottom: 10,
    backgroundColor: theme.bg,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionCount: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    flex: 1,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    textAlign: 'center',
    marginBottom: 24,
  },
  searchButton: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
  },
});
