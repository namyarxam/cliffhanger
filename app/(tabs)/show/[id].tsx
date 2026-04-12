import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/src/lib/theme';

import { useShowData } from '@/src/hooks/useShowData';
import { useShowActions } from '@/src/hooks/useShowActions';
import WatchProgressBar from '@/src/components/WatchProgressBar';
import CaughtUpButton from '@/src/components/CaughtUpButton';
import EpisodePicker from '@/src/components/EpisodePicker';
import RatingSelector, { getUserRatingColor } from '@/src/components/RatingSelector';
import FriendRatingsModal from '@/src/components/FriendRatingsModal';
import ListPickerModal from '@/src/components/ListPickerModal';
import type { WatchStatus } from '@/src/lib/types';

const STATUS_LABELS: Record<WatchStatus, string> = {
  want_to_watch: 'Watchlist',
  currently_watching: 'Watching',
  watched: 'Watched',
};

const STATUSES: WatchStatus[] = ['want_to_watch', 'currently_watching', 'watched'];

export default function ShowDetailScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const router = useRouter();

  const data = useShowData(id);
  const {
    show, loading, error, userId,
    userShow, setUserShow, watchedEps, setWatchedEps,
    userLists, listsContaining, setListsContaining,
    friendsWatching, refetchWatchedEps,
  } = data;

  const actions = useShowActions({
    userId, id, show, userShow,
    setUserShow, setWatchedEps, setListsContaining,
    refetchWatchedEps,
  });

  const [listModalVisible, setListModalVisible] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [friendRatingsVisible, setFriendRatingsVisible] = useState(false);

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

        {/* Progress bar */}
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
                  onPress={() => userShow ? actions.handleStatusChange(s) : actions.handleAddWithStatus(s)}
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

        {/* Friends watching this show */}
        {friendsWatching.length > 0 && (!userShow || userShow.status !== 'watched') && (
          <View style={styles.friendsSection}>
            <Text style={styles.friendsSectionTitle}>Friends watching</Text>
            {friendsWatching.map(fw => {
              const behind = fw.season > 0 ? getEpisodesBehind(fw.season, fw.episode) : 0;
              return (
                <View key={fw.profile.id} style={styles.friendWatchRow}>
                  {fw.profile.avatar_url ? (
                    <Image source={{ uri: fw.profile.avatar_url }} style={styles.friendAvatarImage} contentFit="cover" />
                  ) : (
                    <View style={styles.friendAvatar}>
                      <Text style={styles.friendAvatarText}>
                        {(fw.profile.display_name[0] || '?').toUpperCase()}
                      </Text>
                    </View>
                  )}
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
              onCatchUp={actions.handleCatchUp}
              isCaughtUp={watchedEps.size >= airedCount}
            />
            <EpisodePicker
              seasons={show.seasons}
              watchedEps={watchedEps}
              currentSeason={userShow.current_season}
              currentEpisode={userShow.current_episode}
              onEpisodeTap={actions.handleEpisodeTap}
            />
          </>
        )}

        {/* Watched: rating + friends status */}
        {userShow && userShow.status === 'watched' && (
          <>
            <RatingSelector
              rating={userShow.rating ?? null}
              onRate={actions.handleRate}
              onDragStart={() => setScrollEnabled(false)}
              onDragEnd={() => setScrollEnabled(true)}
            />
            {friendsWatching.filter(fw => fw.status !== 'want_to_watch').length > 0 && (
              <View style={styles.friendsStatusSection}>
                <Text style={styles.friendsSectionTitle}>Friends</Text>
                {friendsWatching
                  .filter(fw => fw.status !== 'want_to_watch')
                  .sort((a, b) => {
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

      <FriendRatingsModal
        visible={friendRatingsVisible}
        onClose={() => setFriendRatingsVisible(false)}
        friends={friendsWatching}
      />

      <ListPickerModal
        visible={listModalVisible}
        onClose={() => setListModalVisible(false)}
        lists={userLists}
        listsContaining={listsContaining}
        onAdd={actions.handleAddToList}
        onRemove={actions.handleRemoveFromList}
      />
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
    backgroundColor: theme.successBg,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.success,
  },
  liveText: {
    fontSize: 10,
    fontFamily: 'DMSans_700Bold',
    color: theme.success,
    letterSpacing: 0.5,
  },

  // Watchlist controls
  section: {
    paddingHorizontal: 20,
    marginTop: 24,
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
    color: theme.textBright,
  },

  // Friends
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
  friendAvatarImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
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
    color: theme.successDim,
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
});
