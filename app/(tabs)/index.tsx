import { useState, useCallback, useMemo } from 'react';
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
import { getUserShows, getNextEpisodesForShows, getPopularWithFriends, getShowsAiringToday, markNextEpisode, updateShowStatus } from '@/src/lib/watchlist';
import type { PopularShow, NextEpisode } from '@/src/lib/watchlist';
import { getDisplayList } from '@/src/lib/lists';
import WatchlistCard from '@/src/components/WatchlistCard';
import EpisodeCatchUpSheet from '@/src/components/EpisodeCatchUpSheet';
import TopShowsRow from '@/src/components/TopShowsRow';
import PopularWithFriendsRow from '@/src/components/PopularWithFriendsRow';
import type { UserShow, ListWithItems } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';

const POPULAR_CAROUSEL_LIMIT = 25;

function sortTitle(t: string): string {
  return t.replace(/^The\s+/i, '');
}

// Sub-groups within Currently Watching, in render order.
//   behind:    aired episodes the user hasn't watched yet (action zone)
//   returning: caught up, TVMaze has a future airdate (sorted asc by date)
//   hiatus:    caught up, TVMaze status is "Running" but no scheduled return
//              (also the fallback bucket for legacy rows with NULL show_status)
//   ended:     caught up, TVMaze status is "Ended" — gets a soft "move to
//              Watched?" nudge on the row
type CWGroup = 'behind' | 'returning' | 'hiatus' | 'ended';

const CW_GROUP_TITLES: Record<CWGroup, string> = {
  behind: 'Behind',
  returning: 'Returning',
  hiatus: 'On Hiatus',
  ended: 'Series Ended',
};

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
  if (hasNextFromSchedule || isBehindFromCache(s)) return 'behind';
  if (s.show_status === 'Ended') return 'ended';
  if (s.next_episode_airdate) return 'returning';
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [catchUpTarget, setCatchUpTarget] = useState<UserShow | null>(null);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    try {
      const [data, episodeData, display, popularShows, airing] = await Promise.all([
        getUserShows(userId),
        getNextEpisodesForShows(userId),
        getDisplayList(userId),
        getPopularWithFriends(userId, POPULAR_CAROUSEL_LIMIT),
        getShowsAiringToday(userId),
      ]);
      setShows(data);
      setNextEpisodes(episodeData.nextEpisodes);
      setDisplayList(display);
      setPopular(popularShows);
      setAiringToday(airing);
    } catch (e) {
      silentCatch('myShows:fetchData')(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

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
  // as a single section.
  const cwGroups: Record<CWGroup, UserShow[]> = { behind: [], returning: [], hiatus: [], ended: [] };
  for (const s of shows) {
    if (s.status !== 'currently_watching') continue;
    cwGroups[classifyCW(s, nextEpisodes.has(s.show_id))].push(s);
  }
  const byTitle = (a: UserShow, b: UserShow) => sortTitle(a.show_title).localeCompare(sortTitle(b.show_title));
  cwGroups.behind.sort(byTitle);
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
      { title: CW_GROUP_TITLES.behind, data: cwGroups.behind },
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

  const sections: typeof userSections = [...userSections];
  if (popular.length > 0) {
    sections.unshift({
      title: POPULAR_SECTION_TITLE,
      data: [],
      count: 0,
      isCarousel: true,
    });
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
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
      keyExtractor={item => item.show_id}
      renderItem={({ item }) => {
        // Schedule cron is the eager source — already carries the airdate so
        // WatchlistCard can decide whether to surface "NEW".
        // Cache fallback walks the user one episode at a time (current+1)
        // rather than jumping to last_aired (would skip and create gaps in
        // episode_watches). We only know the airdate of current+1 when
        // current+1 IS exactly last_aired (the 1-behind case); otherwise null
        // so the card hides "NEW" until the user has fewer episodes to clear.
        const fromSchedule = nextEpisodes.get(item.show_id);
        let nextEp = fromSchedule;
        if (!nextEp && isBehindFromCache(item)) {
          const nextSeason = item.current_season;
          const nextEpisode = item.current_episode + 1;
          const isExactlyLastAired =
            item.last_aired_season === nextSeason && item.last_aired_episode === nextEpisode;
          nextEp = {
            season: nextSeason,
            episode: nextEpisode,
            airdate: isExactlyLastAired ? item.last_aired_airdate : null,
          };
        }
        return (
          <WatchlistCard
            show={item}
            onPress={handlePress}
            nextEpisode={nextEp}
            onMarkNext={handleMarkNext}
            onMarkWatched={handleMarkWatched}
            onCatchUp={handleCatchUp}
            isCaughtUp={item.caught_up}
            hidePosters={profile?.show_posters_in_list === false}
            airsToday={airingToday.has(item.show_id)}
          />
        );
      }}
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
        profile?.show_top4_in_list !== false && displayList && displayList.items.length > 0 ? (
          <TopShowsRow items={displayList.items} onPress={(itemId) => handlePress(itemId)} size="large" />
        ) : null
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
