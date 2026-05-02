import { useState, useCallback, useEffect, useMemo } from 'react';
import * as Notifications from 'expo-notifications';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getUserShows, getNextEpisodesForShows, getPopularWithFriends, getShowsAiringToday, getReturnAnnouncements, markReturnAnnouncementSeen, markNextEpisode, updateShowStatus, getWatchedCounts } from '@/src/lib/watchlist';
import type { PopularShow, NextEpisode, ReturnAnnouncement } from '@/src/lib/watchlist';
import { getDisplayList } from '@/src/lib/lists';
import WatchlistCard from '@/src/components/WatchlistCard';
import EpisodeCatchUpSheet from '@/src/components/EpisodeCatchUpSheet';
import ReturnAnnouncementCard from '@/src/components/ReturnAnnouncementCard';
import TopShowsRow from '@/src/components/TopShowsRow';
import PopularWithFriendsRow from '@/src/components/PopularWithFriendsRow';
import LoaderFlavor, { SHELF_MESSAGES } from '@/src/components/LoaderFlavor';
import type { UserShow, ListWithItems } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';

const POPULAR_CAROUSEL_LIMIT = 25;

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
    s.last_aired_season != null &&
    s.last_aired_episode === 1 &&
    s.last_aired_season > s.current_season
  );
}
function isPremiereUpcomingState(s: UserShow): boolean {
  return (
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

const POPULAR_SECTION_TITLE = 'Popular with Friends';

export default function MyShowsScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { session, profile } = useAuth();
  const userId = session?.user?.id;

  const [shows, setShows] = useState<UserShow[]>([]);
  const [displayList, setDisplayList] = useState<ListWithItems | null>(null);
  const [nextEpisodes, setNextEpisodes] = useState<Map<string, NextEpisode>>(new Map());
  const [popular, setPopular] = useState<PopularShow[]>([]);
  const [airingToday, setAiringToday] = useState<Set<string>>(new Set());
  const [returnAnnouncements, setReturnAnnouncements] = useState<ReturnAnnouncement[]>([]);
  const [watchedCounts, setWatchedCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [catchUpTarget, setCatchUpTarget] = useState<UserShow | null>(null);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    // Promise.allSettled (not Promise.all) so one transient failure can't
    // blank the screen. With Promise.all, if e.g. getPopularWithFriends had a
    // network blip the entire batch rejects, the catch fires, and NONE of
    // the state updates run — leaving popular at [], shows at [], etc. With
    // allSettled each query updates independently and a partial failure
    // preserves the last-known state for the failing slice.
    const results = await Promise.allSettled([
      getUserShows(userId),
      getNextEpisodesForShows(userId),
      getDisplayList(userId),
      getPopularWithFriends(userId, POPULAR_CAROUSEL_LIMIT),
      getShowsAiringToday(userId),
      getReturnAnnouncements(userId),
      getWatchedCounts(userId),
    ]);

    const [showsR, episodesR, displayR, popularR, airingR, announcementsR, countsR] = results;

    if (showsR.status === 'fulfilled') setShows(showsR.value);
    else silentCatch('myShows:getUserShows')(showsR.reason);

    if (episodesR.status === 'fulfilled') setNextEpisodes(episodesR.value.nextEpisodes);
    else silentCatch('myShows:getNextEpisodes')(episodesR.reason);

    if (displayR.status === 'fulfilled') setDisplayList(displayR.value);
    else silentCatch('myShows:getDisplayList')(displayR.reason);

    if (popularR.status === 'fulfilled') setPopular(popularR.value);
    else silentCatch('myShows:getPopular')(popularR.reason);

    if (airingR.status === 'fulfilled') setAiringToday(airingR.value);
    else silentCatch('myShows:getAiringToday')(airingR.reason);

    if (announcementsR.status === 'fulfilled') setReturnAnnouncements(announcementsR.value);
    else silentCatch('myShows:getReturnAnnouncements')(announcementsR.reason);

    if (countsR.status === 'fulfilled') setWatchedCounts(countsR.value);
    else silentCatch('myShows:getWatchedCounts')(countsR.reason);

    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
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
    // Optimistic: remove from next episodes map and update show progress
    setNextEpisodes(prev => {
      const next = new Map(prev);
      next.delete(showId);
      return next;
    });
    setShows(prev => prev.map(s =>
      s.show_id === showId
        ? { ...s, current_season: season, current_episode: episode }
        : s
    ));

    try {
      await markNextEpisode(userId, showId, season, episode);
      // Refetch to check if there are more new episodes
      const episodeData = await getNextEpisodesForShows(userId);
      setNextEpisodes(episodeData.nextEpisodes);
      // If no more next episodes for this show, it's caught up
      if (!episodeData.nextEpisodes.has(showId)) {
        setShows(prev => prev.map(s =>
          s.show_id === showId ? { ...s, caught_up: true } : s
        ));
      }
    } catch (e) {
      silentCatch('myShows:markNext')(e);
      fetchData();
    }
  }, [userId, fetchData]);

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
    setReturnAnnouncements(prev => prev.filter(a => a.show_id !== showId));
    try {
      await markReturnAnnouncementSeen(userId, showId);
    } catch (e) {
      silentCatch('myShows:dismissAnnouncement')(e);
    }
  }, [userId]);

  const handleAnnouncementPress = useCallback((showId: string) => {
    handleDismissAnnouncement(showId);
    router.push(`/show/${showId}?from=/`);
  }, [router, handleDismissAnnouncement]);

  const handleMarkWatched = useCallback(async (showId: string) => {
    if (!userId) return;
    // Optimistic: drop from the list (Watched isn't shown on My Shows).
    setShows(prev => prev.filter(s => s.show_id !== showId));
    try {
      // Await the flip so the show detail page mounts with status='watched'
      // already in the DB — that's what reveals the inline RatingSelector
      // and surfaces the rating prompt.
      await updateShowStatus(userId, showId, 'watched');
      router.push(`/show/${showId}?from=/`);
    } catch (e) {
      silentCatch('myShows:markWatched')(e);
      fetchData();
    }
  }, [userId, router, fetchData]);

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
        isCarousel: false,
      }))
      .filter(s => s.count > 0);

    const all: typeof userSections = [...userSections];
    if (popular.length > 0) {
      all.unshift({
        title: POPULAR_SECTION_TITLE,
        data: [],
        count: 0,
        isCarousel: true,
      });
    }
    return all;
  }, [shows, nextEpisodes, collapsed, popular.length]);

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
          onPress={() => router.push('/(tabs)/search')}
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
        if (section.isCarousel) {
          return (
            <View>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
              </View>
              <PopularWithFriendsRow items={popular} onPress={handlePress} />
            </View>
          );
        }
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
          {profile?.show_top4_in_list !== false && displayList && displayList.items.length > 0 && (
            <TopShowsRow items={displayList.items} onPress={(itemId) => handlePress(itemId)} size="large" />
          )}
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
          onRefresh={() => {
            setRefreshing(true);
            fetchData();
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
      onMarked={fetchData}
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
