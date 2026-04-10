import { useState, useCallback } from 'react';
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
import { theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getUserShows, getShowsWithNewEpisodes, dismissNewEpisodes } from '@/src/lib/watchlist';
import { getTopShows } from '@/src/lib/topshows';
import WatchlistCard from '@/src/components/WatchlistCard';
import TopShowsRow from '@/src/components/TopShowsRow';
import type { UserShow, TopShow, WatchStatus } from '@/src/lib/types';

function sortTitle(t: string): string {
  return t.replace(/^The\s+/i, '');
}

const SECTION_ORDER: { key: WatchStatus; title: string }[] = [
  { key: 'currently_watching', title: 'Currently Watching' },
  { key: 'want_to_watch', title: 'Want to Watch' },
  { key: 'watched', title: 'Watched' },
];

export default function MyShowsScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const userId = session?.user?.id;

  const [shows, setShows] = useState<UserShow[]>([]);
  const [topShows, setTopShows] = useState<TopShow[]>([]);
  const [showsWithNew, setShowsWithNew] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    if (!userId) return;
    try {
      const [data, newEps, top] = await Promise.all([
        getUserShows(userId),
        getShowsWithNewEpisodes(userId),
        getTopShows(userId),
      ]);
      setShows(data);
      setShowsWithNew(newEps);
      setTopShows(top);
    } catch {
      // silently fail
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

  const handlePress = useCallback(async (id: string) => {
    // Dismiss new episodes indicator when tapping into the show
    if (userId && showsWithNew.has(id)) {
      dismissNewEpisodes(userId, id).catch(() => {});
      setShowsWithNew(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
    router.push(`/show/${id}`);
  }, [router, userId, showsWithNew]);

  const toggleSection = useCallback((title: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }, []);

  const sections = SECTION_ORDER
    .map(({ key, title }) => {
      let allData = shows.filter(s => s.status === key);
      if (key === 'watched') {
        allData = [...allData].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      } else {
        allData = [...allData].sort((a, b) => sortTitle(a.show_title).localeCompare(sortTitle(b.show_title)));
      }
      return {
        title,
        data: collapsed.has(title) ? [] : allData,
        count: allData.length,
      };
    })
    .filter(s => s.count > 0);

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
    <SectionList
      style={styles.container}
      sections={sections}
      keyExtractor={item => item.show_id}
      renderItem={({ item }) => (
        <WatchlistCard
          show={item}
          onPress={handlePress}
          hasNewEpisodes={showsWithNew.has(item.show_id)}
          hidePosters={profile?.show_posters_in_list === false}
        />
      )}
      renderSectionHeader={({ section }) => {
        const isCollapsed = collapsed.has(section.title);
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
        profile?.show_top4_in_list !== false && topShows.length > 0 ? (
          <TopShowsRow shows={topShows} onPress={handlePress} size="large" />
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
  );
}

const styles = StyleSheet.create({
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
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
    backgroundColor: theme.bg,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  sectionCount: {
    fontSize: 13,
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
