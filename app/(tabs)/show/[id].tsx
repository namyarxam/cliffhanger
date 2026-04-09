import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { theme } from '@/src/lib/theme';
import { fetchShow } from '@/src/lib/data';
import { useAuth } from '@/src/providers/AuthProvider';
import {
  getUserShow,
  addShow,
  updateShowStatus,
  removeShow,
  getWatchedEpisodes,
  markExactlyUpTo,
} from '@/src/lib/watchlist';
import EpisodeTimeline from '@/src/components/EpisodeTimeline';
import type { ShowFull, WatchStatus, UserShow } from '@/src/lib/types';

const STATUS_LABELS: Record<WatchStatus, string> = {
  want_to_watch: 'Want to Watch',
  currently_watching: 'Watching',
  watched: 'Watched',
};

const STATUSES: WatchStatus[] = ['want_to_watch', 'currently_watching', 'watched'];

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [show, setShow] = useState<ShowFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userShow, setUserShow] = useState<UserShow | null>(null);
  const [watchedEps, setWatchedEps] = useState<Set<string>>(new Set());

  // Reset everything when navigating to a different show
  useEffect(() => {
    setShow(null);
    setUserShow(null);
    setWatchedEps(new Set());
    setLoading(true);
    setError(null);

    if (!id) return;
    fetchShow(id)
      .then(setShow)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!userId || !id) return;
    getUserShow(userId, id).then(setUserShow).catch(() => {});
  }, [userId, id]);

  useEffect(() => {
    if (!userId || !id || !userShow) return;
    getWatchedEpisodes(userId, id).then(setWatchedEps).catch(() => {});
  }, [userId, id, userShow]);

  const handleAddToWatchlist = useCallback(async () => {
    if (!userId || !show) return;
    try {
      await addShow(userId, show.id, 'want_to_watch', show.title, show.image, show.network);
      setUserShow({
        user_id: userId,
        show_id: show.id,
        status: 'want_to_watch',
        show_title: show.title,
        show_image: show.image,
        show_network: show.network,
        current_season: 0,
        current_episode: 0,
        current_episode_airdate: null,
        added_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch {
      Alert.alert('Error', 'Failed to add show to watchlist');
    }
  }, [userId, show]);

  const handleStatusChange = useCallback(async (status: WatchStatus) => {
    if (!userId || !id || !userShow) return;

    // Re-tapping the active status = un-track the show
    if (status === userShow.status) {
      Alert.alert(
        'Remove from list?',
        'Your episode progress will be saved if you add it back later.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                await removeShow(userId, id);
                setUserShow(null);
              } catch {
                Alert.alert('Error', 'Failed to remove show');
              }
            },
          },
        ],
      );
      return;
    }

    try {
      if (status === 'watched' && show) {
        // Find last aired episode and mark everything as watched
        const today = new Date().toISOString().slice(0, 10);
        let lastSeason = 0;
        let lastEp = 0;
        let lastAirdate: string | null = null;
        for (const s of show.seasons) {
          for (const ep of s.episodes) {
            if (!ep.airdate || ep.airdate <= today) {
              lastSeason = s.number;
              lastEp = ep.number;
              lastAirdate = ep.airdate;
            }
          }
        }
        if (lastSeason > 0) {
          const newSet = await markExactlyUpTo(userId, id, lastSeason, lastEp, show.seasons);
          setWatchedEps(newSet);
        }
        await updateShowStatus(userId, id, 'watched');
        setUserShow(prev => prev ? {
          ...prev,
          status: 'watched',
          current_season: lastSeason,
          current_episode: lastEp,
          current_episode_airdate: lastAirdate,
          updated_at: new Date().toISOString(),
        } : null);
      } else {
        await updateShowStatus(userId, id, status);
        setUserShow(prev => prev ? { ...prev, status, updated_at: new Date().toISOString() } : null);
      }
    } catch {
      Alert.alert('Error', 'Failed to update status');
    }
  }, [userId, id, userShow, show]);

  const handleEpisodeTap = useCallback(async (season: number, episode: number) => {
    if (!userId || !id || !show) return;

    // Auto-add to watchlist if not already added
    if (!userShow) {
      await addShow(userId, id, 'currently_watching', show.title, show.image, show.network);
      const targetSeason = show.seasons.find(s => s.number === season);
      const targetEp = targetSeason?.episodes.find(e => e.number === episode);
      setUserShow({
        user_id: userId,
        show_id: id,
        status: 'currently_watching',
        show_title: show.title,
        show_image: show.image,
        show_network: show.network,
        current_season: season,
        current_episode: episode,
        current_episode_airdate: targetEp?.airdate ?? null,
        added_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    // Optimistic: mark everything up to this episode
    const optimistic = new Set<string>();
    for (const s of show.seasons) {
      for (const ep of s.episodes) {
        if (s.number < season || (s.number === season && ep.number <= episode)) {
          optimistic.add(`S${s.number}E${ep.number}`);
        }
      }
    }
    setWatchedEps(optimistic);

    try {
      const newSet = await markExactlyUpTo(userId, id, season, episode, show.seasons);
      setWatchedEps(newSet);
      setUserShow(prev => prev ? {
        ...prev,
        status: 'currently_watching',
        current_season: season,
        current_episode: episode,
      } : null);
    } catch {
      // Revert — refetch from server
      getWatchedEpisodes(userId, id).then(setWatchedEps).catch(() => {});
    }
  }, [userId, id, show, userShow]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  if (error || !show) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Failed to load show</Text>
        <Text style={styles.errorHint}>{error}</Text>
      </View>
    );
  }

  const isRunning = show.status === 'Running';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Hero: Poster + Info */}
        <View style={styles.hero}>
          {show.image ? (
            <Image source={{ uri: show.image }} style={styles.poster} contentFit="cover" transition={300} />
          ) : (
            <View style={[styles.poster, styles.posterPlaceholder]}>
              <Text style={{ fontSize: 40 }}>📺</Text>
            </View>
          )}

          <View style={styles.heroInfo}>
            <Text style={styles.title}>{show.title}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.meta}>
                {show.year}{show.endYear ? `–${show.endYear}` : ''}
              </Text>
              {isRunning && (
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>AIRING</Text>
                </View>
              )}
            </View>
            <Text style={styles.meta}>{show.genres.join(', ')}</Text>
            {show.network && <Text style={styles.meta}>{show.network}</Text>}
            <Text style={styles.meta}>
              {show.totalSeasons} season{show.totalSeasons !== 1 ? 's' : ''} · {show.totalEpisodes} episode{show.totalEpisodes !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>

        {/* Watchlist Controls */}
        <View style={styles.section}>
          {!userShow ? (
            <Pressable
              style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]}
              onPress={handleAddToWatchlist}
            >
              <Text style={styles.addButtonText}>+ Add to Watchlist</Text>
            </Pressable>
          ) : (
            <View>
              <View style={styles.statusRow}>
                {STATUSES.map(s => (
                  <Pressable
                    key={s}
                    style={[
                      styles.statusPill,
                      userShow.status === s && styles.statusPillActive,
                    ]}
                    onPress={() => handleStatusChange(s)}
                  >
                    <Text style={[
                      styles.statusPillText,
                      userShow.status === s && styles.statusPillTextActive,
                    ]}>
                      {STATUS_LABELS[s]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* Episode Timeline */}
        <EpisodeTimeline
          seasons={show.seasons}
          totalEpisodes={show.totalEpisodes}
          watchedEps={watchedEps}
          currentSeason={userShow?.current_season ?? 0}
          currentEpisode={userShow?.current_episode ?? 0}
          onEpisodeTap={handleEpisodeTap}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  content: {
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    backgroundColor: theme.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    color: '#f87171',
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
  },
  errorHint: {
    color: theme.textFaint,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    marginTop: 4,
  },

  // Hero
  hero: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 27,
    gap: 16,
  },
  poster: {
    width: 120,
    height: 170,
    borderRadius: 8,
  },
  posterPlaceholder: {
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroInfo: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 20,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  meta: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(74,222,128,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#4ade80',
  },
  liveText: {
    fontSize: 10,
    fontFamily: 'DMSans_700Bold',
    color: '#4ade80',
    letterSpacing: 0.5,
  },

  // Watchlist controls
  section: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  addButton: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'DMSans_600SemiBold',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statusPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
  },
  statusPillActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  statusPillText: {
    fontSize: 12,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
  },
  statusPillTextActive: {
    color: '#fff',
  },
});
