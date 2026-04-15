import { useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getUserShows, rateShow, updateShowStatus } from '@/src/lib/watchlist';
import RatingSelector, { getUserRatingColor } from '@/src/components/RatingSelector';
import type { UserShow } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';

export default function DroppedScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const [shows, setShows] = useState<UserShow[]>([]);
  const [ratingShowId, setRatingShowId] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const fetchDropped = useCallback(() => {
    if (!userId) return;
    getUserShows(userId)
      .then(s => setShows(s.filter(sh => sh.status === 'dropped')))
      .catch(silentCatch('dropped:fetch'));
  }, [userId]);

  useFocusEffect(useCallback(() => { fetchDropped(); }, [fetchDropped]));

  const handleRate = async (showId: string, rating: number) => {
    if (!userId) return;
    try {
      await rateShow(userId, showId, rating);
      setShows(prev => prev.map(s => s.show_id === showId ? { ...s, rating } : s));
    } catch (e) { silentCatch('dropped:rate')(e); }
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
              setShows(prev => prev.filter(s => s.show_id !== show.show_id));
            } catch (e) { silentCatch('dropped:moveToWatched')(e); }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.5 }]} onPress={() => router.back()}>
          <FontAwesome name="chevron-left" size={16} color={theme.accent} />
          <Text style={styles.backText}>Profile</Text>
        </Pressable>
        <Text style={styles.title}>Dropped</Text>
        <View style={styles.backButton} />
      </View>

      {shows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No dropped shows</Text>
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
                      ? `Dropped at S${item.current_season} E${item.current_episode}`
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

const styles = StyleSheet.create({
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
