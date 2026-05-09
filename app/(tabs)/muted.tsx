import { useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getUserShows, rateShow, updateShowStatus } from '@/src/lib/watchlist';
import RatingSelector, { getUserRatingColor } from '@/src/components/RatingSelector';
import type { UserShow } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';
import { qk } from '@/src/lib/queryKeys';

export default function MutedScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();
  const [ratingShowId, setRatingShowId] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const userShowsQ = useQuery({
    queryKey: qk.userShows.all(userId),
    queryFn: () => getUserShows(userId!),
    enabled: !!userId,
  });
  const shows = useMemo(
    () => (userShowsQ.data ?? []).filter(s => s.status === 'muted'),
    [userShowsQ.data],
  );

  useFocusEffect(useCallback(() => {
    if (!userId) return;
    queryClient.invalidateQueries({ queryKey: qk.userShows.all(userId) });
  }, [userId, queryClient]));

  const handleRate = async (showId: string, rating: number) => {
    if (!userId) return;
    // Optimistic — write the new rating to the shared userShows cache first
    // so RatingSelector lands instantly on release. Without this, the slider
    // falls back to the cached rating prop during the network roundtrip and
    // visibly snaps half a second later. Same pattern as the show detail
    // page's handleRate (src/hooks/useShowActions.ts).
    let prevRating: number | null = null;
    queryClient.setQueryData<UserShow[]>(qk.userShows.all(userId), prev => {
      if (!prev) return prev;
      return prev.map(s => {
        if (s.show_id !== showId) return s;
        prevRating = s.rating ?? null;
        return { ...s, rating };
      });
    });
    try {
      await rateShow(userId, showId, rating);
    } catch (e) {
      silentCatch('muted:rate')(e);
      // Revert on failure so the slider doesn't lie about persisted state.
      queryClient.setQueryData<UserShow[]>(qk.userShows.all(userId), prev =>
        (prev ?? []).map(s => s.show_id === showId ? { ...s, rating: prevRating } : s),
      );
    }
  };

  const handleMoveToWatched = (show: UserShow) => {
    Alert.alert(
      'Move to Watched?',
      `Move "${show.show_title}" to your Watched list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move',
          onPress: async () => {
            if (!userId) return;
            try {
              await updateShowStatus(userId, show.show_id, 'watched');
              queryClient.setQueryData<UserShow[]>(qk.userShows.all(userId), prev =>
                (prev ?? []).map(s => s.show_id === show.show_id ? { ...s, status: 'watched' as const } : s),
              );
            } catch (e) { silentCatch('muted:moveToWatched')(e); }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.5 }]} onPress={() => router.replace('/(tabs)/profile')}>
          <FontAwesome name="chevron-left" size={16} color={theme.accent} />
          <Text style={styles.backText}>Profile</Text>
        </Pressable>
        <Text style={styles.title}>Muted</Text>
        <View style={styles.backButton} />
      </View>

      {shows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No muted shows</Text>
        </View>
      ) : (
        <FlatList
          data={shows}
          keyExtractor={s => s.show_id}
          scrollEnabled={scrollEnabled}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                onPress={() => router.push(`/show/${item.show_id}`)}
              >
                {item.show_image ? (
                  <Image source={{ uri: item.show_image }} style={styles.poster} contentFit="cover" />
                ) : (
                  <View style={[styles.poster, styles.posterPlaceholder]}>
                    <Text style={{ fontSize: 14 }}>📺</Text>
                  </View>
                )}
                <View style={styles.info}>
                  <Text style={styles.showTitle} numberOfLines={1}>{item.show_title}</Text>
                  <Text style={styles.progress}>
                    {item.current_season > 0
                      ? `Muted at S${item.current_season} E${item.current_episode}`
                      : 'Never started'}
                  </Text>
                </View>
                <FontAwesome name="chevron-right" size={12} color={theme.textFaint} />
              </Pressable>

              <View style={styles.actions}>
                <Pressable
                  style={({ pressed }) => [styles.actionButton, ratingShowId === item.show_id && styles.actionButtonActive, pressed && { opacity: 0.7 }]}
                  onPress={() => setRatingShowId(ratingShowId === item.show_id ? null : item.show_id)}
                >
                  {item.rating != null ? (
                    <>
                      <FontAwesome name="star" size={12} color={getUserRatingColor(item.rating)} />
                      <Text style={[styles.actionText, { color: getUserRatingColor(item.rating) }]}>
                        {item.rating.toFixed(1)}
                      </Text>
                    </>
                  ) : (
                    <>
                      <FontAwesome name="star-o" size={12} color={theme.textDim} />
                      <Text style={styles.actionText}>Rate</Text>
                    </>
                  )}
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.7 }]}
                  onPress={() => handleMoveToWatched(item)}
                >
                  <FontAwesome name="check" size={12} color={theme.textDim} />
                  <Text style={styles.actionText}>Move to Watched</Text>
                </Pressable>
              </View>

              {ratingShowId === item.show_id && (
                <RatingSelector
                  rating={item.rating ?? null}
                  onRate={(r) => handleRate(item.show_id, r)}
                  onDragStart={() => setScrollEnabled(false)}
                  onDragEnd={() => setScrollEnabled(true)}
                />
              )}
            </View>
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
  card: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 12,
  },
  poster: {
    width: 44,
    height: 62,
    borderRadius: 4,
  },
  posterPlaceholder: {
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    flex: 1,
    gap: 3,
  },
  showTitle: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  progress: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    marginLeft: 56,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: theme.bgCard,
  },
  actionButtonActive: {
    borderWidth: 1,
    borderColor: theme.accent,
  },
  actionText: {
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
  },
});
