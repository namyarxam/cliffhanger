import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Modal,
  FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import RatingSelector, { getUserRatingColor } from '@/src/components/RatingSelector';
import { getLists, addListItem, removeListItem, getListsContainingItem } from '@/src/lib/lists';
import { getFriends } from '@/src/lib/friends';
import type { ListWithItems } from '@/src/lib/types';
import { supabase } from '@/src/lib/supabase';
import type { ShowFull, WatchStatus, UserShow, UserProfile } from '@/src/lib/types';

const STATUS_LABELS: Record<WatchStatus, string> = {
  want_to_watch: 'Watchlist',
  currently_watching: 'Watching',
  watched: 'Watched',
};

const STATUSES: WatchStatus[] = ['want_to_watch', 'currently_watching', 'watched'];

export default function ShowDetailScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;


  const [show, setShow] = useState<ShowFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userShow, setUserShow] = useState<UserShow | null>(null);
  const [watchedEps, setWatchedEps] = useState<Set<string>>(new Set());
  const [userLists, setUserLists] = useState<ListWithItems[]>([]);
  const [listsContaining, setListsContaining] = useState<Set<string>>(new Set());
  const [listModalVisible, setListModalVisible] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [friendRatingsVisible, setFriendRatingsVisible] = useState(false);
  const [friendsWatching, setFriendsWatching] = useState<{ profile: UserProfile; status: string; season: number; episode: number; rating: number | null }[]>([]);

  // Reset everything when navigating to a different show
  useEffect(() => {
    setShow(null);
    setUserShow(null);
    setWatchedEps(new Set());
    setUserLists([]);
    setListsContaining(new Set());
    setFriendsWatching([]);
    setLoading(true);
    setError(null);

    if (!id) return;
    fetchShow(id)
      .then(setShow)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

    if (userId) {
      getLists(userId).then(l => setUserLists(l.filter(ll => ll.type === 'shows'))).catch(() => {});
      getListsContainingItem(userId, id).then(ids => setListsContaining(new Set(ids))).catch(() => {});

      // Fetch friends who watch this show
      getFriends(userId).then(async (friends) => {
        if (friends.length === 0) return;
        const friendIds = friends.map(f => f.user.id);
        const { data } = await supabase
          .from('user_shows')
          .select('user_id, status, current_season, current_episode, rating')
          .eq('show_id', id)
          .in('user_id', friendIds);

        if (!data || data.length === 0) { setFriendsWatching([]); return; }

        const profileMap = new Map(friends.map(f => [f.user.id, f.user]));
        setFriendsWatching(data.map(d => ({
          profile: profileMap.get(d.user_id)!,
          status: d.status,
          season: d.current_season,
          episode: d.current_episode,
          rating: d.rating ?? null,
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

  const handleAddToList = useCallback(async (listId: string) => {
    if (!show) return;
    try {
      await addListItem(listId, show.id, show.title, show.image);
      setListsContaining(prev => new Set(prev).add(listId));
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to add');
    }
  }, [show]);

  const handleRemoveFromList = useCallback(async (listId: string) => {
    if (!show) return;
    try {
      await removeListItem(listId, show.id);
      setListsContaining(prev => {
        const next = new Set(prev);
        next.delete(listId);
        return next;
      });
    } catch {}
  }, [show]);

  const handleAddWithStatus = useCallback(async (status: WatchStatus) => {
    if (!userId || !show) return;
    try {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const { currentSeason, currentEpisode } = await addShow(userId, show.id, status, show.title, show.image, show.network);
      setUserShow({
        user_id: userId,
        show_id: show.id,
        status,
        show_title: show.title,
        show_image: show.image,
        show_network: show.network,
        current_season: currentSeason,
        current_episode: currentEpisode,
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

  const today = new Date().toISOString().slice(0, 10);

  const airedCount = (() => {
    let count = 0;
    for (const s of show.seasons) {
      for (const ep of s.episodes) {
        if (!ep.airdate || ep.airdate <= today) count++;
      }
    }
    return count;
  })();

  const getEpisodesBehind = (season: number, episode: number): number => {
    let behind = 0;
    let pastPosition = false;
    for (const s of show.seasons) {
      for (const ep of s.episodes) {
        if (!ep.airdate || ep.airdate > today) continue;
        if (pastPosition) behind++;
        if (s.number === season && ep.number === episode) pastPosition = true;
      }
    }
    return behind;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} scrollEnabled={scrollEnabled}>
        <Pressable style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.5 }]} onPress={() => {
          if (from) router.push(from as any);
          else router.back();
        }}>
          <FontAwesome name="chevron-left" size={16} color={theme.accent} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

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
            {(() => {
              const friendRatings = friendsWatching.filter(f => f.rating != null);
              const friendAvg = friendRatings.length > 0
                ? friendRatings.reduce((sum, f) => sum + f.rating!, 0) / friendRatings.length
                : null;
              return (
                <View style={styles.ratingsRow}>
                  {show.rating != null && (
                    <View style={styles.ratingBadge}>
                      <Text style={[styles.ratingBadgeNumber, { color: getUserRatingColor(show.rating) }]}>
                        {show.rating.toFixed(1)}
                      </Text>
                      <Text style={styles.ratingBadgeLabel}>TVMaze</Text>
                    </View>
                  )}
                  {friendAvg != null && (
                    <Pressable
                      style={({ pressed }) => [styles.ratingBadge, styles.ratingBadgeTappable, pressed && { opacity: 0.7 }]}
                      onPress={() => setFriendRatingsVisible(true)}
                    >
                      <Text style={[styles.ratingBadgeNumber, { color: getUserRatingColor(friendAvg) }]}>
                        {friendAvg.toFixed(1)}
                      </Text>
                      <View style={styles.ratingBadgeLabelRow}>
                        <Text style={styles.ratingBadgeLabel}>Friends</Text>
                        <Text style={styles.ratingBadgeChevron}>▸</Text>
                      </View>
                    </Pressable>
                  )}
                </View>
              );
            })()}
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
            {STATUSES.map(s => {
              const isActive = userShow?.status === s;
              return (
                <Pressable
                  key={s}
                  style={({ pressed }) => [
                    styles.statusPill,
                    !userShow && styles.statusPillEmpty,
                    isActive && styles.statusPillActive,
                    pressed && !isActive && styles.statusPillPressed,
                  ]}
                  onPress={() => userShow ? handleStatusChange(s) : handleAddWithStatus(s)}
                >
                  {!userShow && <Text style={styles.statusPillPlus}>+</Text>}
                  <Text style={[
                    styles.statusPillText,
                    isActive && styles.statusPillTextActive,
                  ]}>
                    {STATUS_LABELS[s]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Friends watching this show (hidden on Watched tab — it has its own version with ratings) */}
        {friendsWatching.length > 0 && (!userShow || userShow.status !== 'watched') && (
          <View style={styles.friendsSection}>
            <Text style={styles.friendsSectionTitle}>Friends watching</Text>
            {friendsWatching.map(fw => {
              const behind = fw.season > 0 ? getEpisodesBehind(fw.season, fw.episode) : 0;
              return (
                <View key={fw.profile.id} style={styles.friendWatchRow}>
                  <View style={styles.friendAvatar}>
                    <Text style={styles.friendAvatarText}>
                      {(fw.profile.display_name[0] || '?').toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.friendName} numberOfLines={1}>{fw.profile.display_name}</Text>
                  {fw.status === 'watched' ? (
                    <Text style={styles.friendCaughtUp}>Finished</Text>
                  ) : fw.season === 0 ? (
                    <Text style={styles.friendProgress}>Not started</Text>
                  ) : behind === 0 ? (
                    <Text style={styles.friendCaughtUp}>Caught up</Text>
                  ) : (
                    <Text style={styles.friendProgress}>{behind} ep{behind !== 1 ? 's' : ''} behind</Text>
                  )}
                </View>
              );
            })}
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

        {/* Watched: rating + friends status */}
        {userShow && userShow.status === 'watched' && (
          <>
            <RatingSelector
              rating={userShow.rating ?? null}
              onRate={handleRate}
              onDragStart={() => setScrollEnabled(false)}
              onDragEnd={() => setScrollEnabled(true)}
            />
            {friendsWatching.filter(fw => fw.status !== 'want_to_watch').length > 0 && (
              <View style={styles.friendsStatusSection}>
                <Text style={styles.friendsSectionTitle}>Friends</Text>
                {friendsWatching
                  .filter(fw => fw.status !== 'want_to_watch')
                  .sort((a, b) => {
                    // Show "watched" friends first (with ratings), then "currently_watching"
                    if (a.status === 'watched' && b.status !== 'watched') return -1;
                    if (a.status !== 'watched' && b.status === 'watched') return 1;
                    return 0;
                  })
                  .map(fw => {
                    const behind = fw.season > 0 ? getEpisodesBehind(fw.season, fw.episode) : 0;
                    return (
                      <View key={fw.profile.id} style={styles.friendWatchRow}>
                        <View style={styles.friendAvatar}>
                          <Text style={styles.friendAvatarText}>
                            {(fw.profile.display_name[0] || '?').toUpperCase()}
                          </Text>
                        </View>
                        <Text style={styles.friendName} numberOfLines={1}>{fw.profile.display_name}</Text>
                        {fw.status === 'watched' && fw.rating != null ? (
                          <View style={[styles.friendRating, { backgroundColor: `${getUserRatingColor(fw.rating)}20` }]}>
                            <Text style={[styles.friendRatingText, { color: getUserRatingColor(fw.rating) }]}>
                              {fw.rating.toFixed(1)}
                            </Text>
                          </View>
                        ) : fw.status === 'watched' ? (
                          <Text style={styles.friendCaughtUp}>Finished</Text>
                        ) : behind === 0 ? (
                          <Text style={styles.friendCaughtUp}>Caught up</Text>
                        ) : (
                          <Text style={styles.friendProgress}>{behind} ep{behind !== 1 ? 's' : ''} behind</Text>
                        )}
                      </View>
                    );
                  })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Friend Ratings Breakdown Modal */}
      <Modal
        visible={friendRatingsVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setFriendRatingsVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Friend Ratings</Text>
            <Pressable onPress={() => setFriendRatingsVisible(false)}>
              <Text style={styles.modalDone}>Done</Text>
            </Pressable>
          </View>
          <FlatList
            data={friendsWatching.filter(f => f.rating != null).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))}
            keyExtractor={item => item.profile.id}
            renderItem={({ item }) => (
              <View style={styles.friendRatingRow}>
                {item.profile.avatar_url ? (
                  <Image source={{ uri: item.profile.avatar_url }} style={styles.friendRatingAvatarImage} contentFit="cover" />
                ) : (
                  <View style={styles.friendRatingAvatar}>
                    <Text style={styles.friendRatingAvatarText}>
                      {(item.profile.display_name[0] || '?').toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text style={styles.friendRatingName} numberOfLines={1}>{item.profile.display_name}</Text>
                <View style={[styles.friendRatingBadge, { backgroundColor: `${getUserRatingColor(item.rating!)}20` }]}>
                  <Text style={[styles.friendRatingValue, { color: getUserRatingColor(item.rating!) }]}>
                    {item.rating!.toFixed(1)}
                  </Text>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.modalEmpty}>
                <Text style={styles.modalEmptyText}>No friends have rated this show yet</Text>
              </View>
            }
          />
        </View>
      </Modal>

      {/* List Picker Modal */}
      <Modal visible={listModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setListModalVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add to a List</Text>
            <Pressable onPress={() => setListModalVisible(false)}>
              <Text style={styles.modalDone}>Done</Text>
            </Pressable>
          </View>
          <FlatList
            data={userLists}
            keyExtractor={item => item.id}
            renderItem={({ item: list }) => {
              const isInList = listsContaining.has(list.id);
              const isFull = list.items.length >= 4 && !isInList;
              return (
                <Pressable
                  style={({ pressed }) => [styles.listPickerRow, pressed && { opacity: 0.7 }, isFull && { opacity: 0.4 }]}
                  onPress={() => {
                    if (isFull) return;
                    if (isInList) handleRemoveFromList(list.id);
                    else handleAddToList(list.id);
                  }}
                  disabled={isFull}
                >
                  <View style={styles.listPickerInfo}>
                    <Text style={styles.listPickerName}>{list.name}</Text>
                    <Text style={styles.listPickerMeta}>{list.items.length}/4</Text>
                  </View>
                  {isInList && <Text style={styles.listPickerCheck}>✓</Text>}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
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
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backText: {
    fontSize: 15,
    fontFamily: 'DMSans_500Medium',
    color: theme.accent,
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
  listPillButton: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  listPillButtonActive: {
    backgroundColor: 'rgba(255,107,53,0.15)',
  },
  listPillText: {
    fontSize: 12,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.accent,
  },
  listPillTextActive: {
    color: theme.accent,
  },
  listPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  listPickerInfo: {
    flex: 1,
    gap: 2,
  },
  listPickerName: {
    fontSize: 16,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  listPickerMeta: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  listPickerCheck: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
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
  ratingsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ratingBadgeTappable: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: -8,
  },
  ratingBadgeNumber: {
    fontSize: 16,
    fontFamily: 'DMSans_700Bold',
  },
  ratingBadgeLabel: {
    fontSize: 10,
    fontFamily: 'DMSans_500Medium',
    color: theme.textFaint,
  },
  ratingBadgeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  ratingBadgeChevron: {
    fontSize: 8,
    color: theme.textFaint,
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
  friendCaughtUp: {
    fontSize: 12,
    fontFamily: 'DMSans_600SemiBold',
    color: 'rgba(74,222,128,0.7)',
  },
  friendsStatusSection: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  friendRating: {
    minWidth: 36,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  friendRatingText: {
    fontSize: 12,
    fontFamily: 'DMSans_700Bold',
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statusPill: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  statusPillEmpty: {
    borderColor: 'rgba(255,107,53,0.3)',
    borderStyle: 'dashed',
  },
  statusPillPressed: {
    backgroundColor: 'rgba(255,107,53,0.08)',
  },
  statusPillActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
    borderStyle: 'solid',
  },
  statusPillPlus: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
  },
  statusPillText: {
    fontSize: 12,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
  },
  statusPillTextActive: {
    color: '#fff',
  },

  // Friend Ratings Modal
  modalContainer: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  modalDone: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.accent,
  },
  modalEmpty: {
    padding: 32,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  friendRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  friendRatingAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
  },
  friendRatingAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
  },
  friendRatingAvatarText: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
  },
  friendRatingName: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  friendRatingBadge: {
    minWidth: 42,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  friendRatingValue: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
  },
});
