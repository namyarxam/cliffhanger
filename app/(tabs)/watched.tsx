import { useMemo, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getUserShows } from '@/src/lib/watchlist';
import WatchlistCard from '@/src/components/WatchlistCard';
import type { UserShow } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';

export default function WatchedScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { session, profile } = useAuth();
  const userId = session?.user?.id;
  const [shows, setShows] = useState<UserShow[]>([]);

  const fetchWatched = useCallback(() => {
    if (!userId) return;
    getUserShows(userId)
      .then(s => {
        const watched = s.filter(sh => sh.status === 'watched')
          .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
        setShows(watched);
      })
      .catch(silentCatch('watched:fetch'));
  }, [userId]);

  useFocusEffect(useCallback(() => { fetchWatched(); }, [fetchWatched]));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.5 }]} onPress={() => router.back()}>
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
