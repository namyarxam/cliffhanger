import { useMemo, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getUserShows } from '@/src/lib/watchlist';
import WatchlistCard from '@/src/components/WatchlistCard';
import { qk, invalidateProgress } from '@/src/lib/queryKeys';

export default function WatchedScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { session, profile } = useAuth();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();

  // Reads the same userShows cache key as My Shows / profile / user-profile.
  // Filtering + sorting is per-screen — keep the cache normalized to the raw
  // userShows array, derive views in render.
  const userShowsQ = useQuery({
    queryKey: qk.userShows.all(userId),
    queryFn: () => getUserShows(userId!),
    enabled: !!userId,
  });
  const shows = useMemo(() => {
    return (userShowsQ.data ?? [])
      .filter(sh => sh.status === 'watched')
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  }, [userShowsQ.data]);

  useFocusEffect(useCallback(() => {
    if (!userId) return;
    invalidateProgress(queryClient, userId);
  }, [userId, queryClient]));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.5 }]} onPress={() => router.replace('/(tabs)/profile')}>
          <FontAwesome name="chevron-left" size={16} color={theme.accent} />
          <Text style={styles.backText}>Profile</Text>
        </Pressable>
        <Text style={styles.title}>Watched</Text>
        <View style={styles.backButton} />
      </View>

      {shows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No watched shows yet</Text>
        </View>
      ) : (
        <FlatList
          data={shows}
          keyExtractor={s => s.show_id}
          renderItem={({ item }) => (
            <WatchlistCard
              show={item}
              onPress={(id) => router.push(`/show/${id}`)}
              hidePosters={profile?.show_posters_in_list === false}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: 80,
  },
  backText: {
    fontSize: 15,
    fontFamily: 'DMSans_500Medium',
    color: theme.accent,
  },
  title: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
});
