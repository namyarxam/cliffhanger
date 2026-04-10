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
  LayoutAnimation,
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
  rateShow,
} from '@/src/lib/watchlist';
import WatchProgressBar from '@/src/components/WatchProgressBar';
import CaughtUpButton from '@/src/components/CaughtUpButton';
import EpisodePicker from '@/src/components/EpisodePicker';
import RatingSelector from '@/src/components/RatingSelector';
import { isInTopShows, addTopShow, removeTopShow } from '@/src/lib/topshows';
import { getFriends } from '@/src/lib/friends';
import { supabase } from '@/src/lib/supabase';
import type { ShowFull, WatchStatus, UserShow, UserProfile } from '@/src/lib/types';

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
  const [isTop4, setIsTop4] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [friendsWatching, setFriendsWatching] = useState<{ profile: UserProfile; status: string; season: number; episode: number }[]>([]);

  // Reset everything when navigating to a different show
  useEffect(() => {
    setShow(null);
    setUserShow(null);
    setWatchedEps(new Set());
    setIsTop4(false);
    setFriendsWatching([]);
    setLoading(true);
    setError(null);

    if (!id) return;
    fetchShow(id)
      .then(setShow)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

    if (userId) {
      isInTopShows(userId, id).then(setIsTop4).catch(() => {});

      // Fetch friends who watch this show
      getFriends(userId).then(async (friends) => {
        if (friends.length === 0) return;
        const friendIds = friends.map(f => f.user.id);
        const { data } = await supabase
          .from('user_shows')
          .select('user_id, status, current_season, current_episode')
          .eq('show_id', id)
          .in('user_id', friendIds);

        if (!data || data.length === 0) { setFriendsWatching([]); return; }

        const profileMap = new Map(friends.map(f => [f.user.id, f.user]));
        setFriendsWatching(data.map(d => ({
          profile: profileMap.get(d.user_id)!,
          status: d.status,
          season: d.current_season,
          episode: d.current_episode,
        })).filter(d => d.profile));
      }).catch(() => {});
    }
  }, [id, userId]);

  useEffect(() => {
    if (!userId || !id) return;
    getUserShow(userId, id).then(setUserShow).catch(() => {});
  }, [userId, id]);

  useEffect(() => {
    if (!userId || !id || !userShow) return;
    getWatchedEpisodes(userId, id).then(setWatchedEps).catch(() => {});
  }, [userId, id, userShow]);

  const handleToggleTop4 = useCallback(async () => {
    if (!userId || !show) return;
    try {
      if (isTop4) {
        await removeTopShow(userId, show.id);
        setIsTop4(false);
      } else {
        await addTopShow(userId, show.id, show.title, show.image);
        setIsTop4(true);
      }
    } catch (e: any) {
      // silently fail
    }
  }, [userId, show, isTop4]);

  const handleAddWithStatus = useCallback(async (status: WatchStatus) => {
    if (!userId || !show) return;
    try {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      await addShow(userId, show.id, status, show.title, show.image, show.network);
      setUserShow({
        user_id: userId,
        show_id: show.id,
        status,
        show_title: show.title,
        show_image: show.image,
        show_network: show.network,
        current_season: 0,
        current_episode: 0,
        current_episode_airdate: null,
        new_episodes_seen_at: null,
        rating: null,
        added_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch {
      // silently fail
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
                // silently fail
              }
            },
          },
        ],
      );
      return;
    }

    try {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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
      // silently fail
    }
  }, [userId, id, userShow, show]);

  const handleCatchUp = useCallback(async () => {
    if (!userId || !id || !show) return;
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
      // Optimistic
      const optimistic = new Set<string>();
      for (const s of show.seasons) {
        for (const ep of s.episodes) {
          if (s.number < lastSeason || (s.number === lastSeason && ep.number <= lastEp)) {
            optimistic.add(`S${s.number}E${ep.number}`);
          }
        }
      }
      setWatchedEps(optimistic);

      try {
        const newSet = await markExactlyUpTo(userId, id, lastSeason, lastEp, show.seasons);
        setWatchedEps(newSet);
        setUserShow(prev => prev ? {
          ...prev,
          status: 'currently_watching',
          current_season: lastSeason,
          current_episode: lastEp,
          current_episode_airdate: lastAirdate,
        } : null);
      } catch {
        getWatchedEpisodes(userId, id).then(setWatchedEps).catch(() => {});
      }
    }
  }, [userId, id, show]);

  const handleRate = useCallback(async (rating: number) => {
    if (!userId || !id) return;
    try {
      await rateShow(userId, id, rating);
      setUserShow(prev => prev ? { ...prev, rating } : null);
    } catch {
      // silently fail
    }
  }, [userId, id]);

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
        new_episodes_seen_at: null,
        rating: null,
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

  const airedCount = (() => {
    const today = new Date().toISOString().slice(0, 10);
    let count = 0;
    for (const s of show.seasons) {
      for (const ep of s.episodes) {
        if (!ep.airdate || ep.airdate <= today) count++;
      }
    }
    return count;
  })();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} scrollEnabled={scrollEnabled}>
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
            <View style={styles.titleRow}>
              <Text style={styles.title}>{show.title}</Text>
              <Pressable onPress={handleToggleTop4} style={styles.starButton}>
                <Text style={[styles.starIcon, isTop4 && styles.starIconActive]}>
                  {isTop4 ? '★' : '☆'}
                </Text>
              </Pressable>
            </View>
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

        {/* Progress bar — seamless divider */}
        {userShow && (
          <WatchProgressBar
            airedCount={airedCount}
            watchedCount={
              userShow.status === 'watched'
                ? airedCount
                : userShow.status === 'want_to_watch'
                  ? 0
                  : Math.min(watchedEps.size, airedCount)
            }
          />
        )}

        {/* Watchlist Controls */}
        <View style={styles.section}>
          <View style={styles.statusRow}>
            {STATUSES.map(s => (
              <Pressable
                key={s}
                style={[
                  styles.statusPill,
                  userShow?.status === s && styles.statusPillActive,
                ]}
                onPress={() => userShow ? handleStatusChange(s) : handleAddWithStatus(s)}
              >
                <Text style={[
                  styles.statusPillText,
                  userShow?.status === s && styles.statusPillTextActive,
                ]}>
                  {STATUS_LABELS[s]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Want to Watch: show friends watching this show */}
        {userShow && userShow.status === 'want_to_watch' && friendsWatching.length > 0 && (
          <View style={styles.friendsSection}>
            <Text style={styles.friendsSectionTitle}>Friends watching</Text>
            {friendsWatching.map(fw => (
              <View key={fw.profile.id} style={styles.friendWatchRow}>
                <View style={styles.friendAvatar}>
                  <Text style={styles.friendAvatarText}>
                    {(fw.profile.display_name[0] || '?').toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.friendName} numberOfLines={1}>{fw.profile.display_name}</Text>
                <Text style={styles.friendProgress}>
                  {fw.status === 'watched'
                    ? 'Finished'
                    : fw.season > 0
                      ? `S${fw.season} E${fw.episode}`
                      : 'Not started'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Currently Watching: catch up + episode picker */}
        {userShow && userShow.status === 'currently_watching' && (
          <>
            <CaughtUpButton
              onCatchUp={handleCatchUp}
              isCaughtUp={watchedEps.size >= airedCount}
            />
            <EpisodePicker
              seasons={show.seasons}
              watchedEps={watchedEps}
              currentSeason={userShow.current_season}
              currentEpisode={userShow.current_episode}
              onEpisodeTap={handleEpisodeTap}
            />
          </>
        )}

        {/* Watched: rating + read-only episode picker */}
        {userShow && userShow.status === 'watched' && (
          <>
            <RatingSelector
              rating={userShow.rating ?? null}
              onRate={handleRate}
              onDragStart={() => setScrollEnabled(false)}
              onDragEnd={() => setScrollEnabled(true)}
            />
            <EpisodePicker
              seasons={show.seasons}
              watchedEps={watchedEps}
              currentSeason={userShow.current_season}
              currentEpisode={userShow.current_episode}
              onEpisodeTap={handleEpisodeTap}
              readOnly
            />
          </>
        )}
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    flexShrink: 1,
  },
  starButton: {
    padding: 2,
  },
  starIcon: {
    fontSize: 22,
    color: theme.textDim,
  },
  starIconActive: {
    color: '#fbbf24',
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
  buttonPressed: {
    opacity: 0.7,
  },
  friendsSection: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  friendsSectionTitle: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
    marginBottom: 10,
  },
  friendWatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  friendAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendAvatarText: {
    fontSize: 12,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
  },
  friendName: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
    color: theme.text,
  },
  friendProgress: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
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
