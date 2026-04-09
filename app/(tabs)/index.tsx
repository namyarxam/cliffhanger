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
import WatchlistCard from '@/src/components/WatchlistCard';
import type { UserShow, WatchStatus } from '@/src/lib/types';

const SECTION_ORDER: { key: WatchStatus; title: string }[] = [
  { key: 'currently_watching', title: 'Currently Watching' },
  { key: 'want_to_watch', title: 'Want to Watch' },
  { key: 'watched', title: 'Watched' },
];

export default function MyShowsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [shows, setShows] = useState<UserShow[]>([]);
  const [showsWithNew, setShowsWithNew] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    try {
      const [data, newEps] = await Promise.all([
        getUserShows(userId),
        getShowsWithNewEpisodes(userId),
      ]);
      setShows(data);
      setShowsWithNew(newEps);
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

  const sections = SECTION_ORDER
    .map(({ key, title }) => ({
      title,
      data: shows.filter(s => s.status === key),
    }))
    .filter(s => s.data.length > 0);

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
        />
      )}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <Text style={styles.sectionCount}>{section.data.length}</Text>
        </View>
      )}
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
