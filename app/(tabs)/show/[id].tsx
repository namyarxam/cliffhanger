import { useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';

import { useShowData } from '@/src/hooks/useShowData';
import { useShowActions } from '@/src/hooks/useShowActions';
import { useCoachmark } from '@/src/tutorial/useCoachmark';
import WatchProgressBar from '@/src/components/WatchProgressBar';
import EpisodePicker from '@/src/components/EpisodePicker';
import RatingSelector, { getUserRatingColor } from '@/src/components/RatingSelector';
import FriendRatingsModal from '@/src/components/FriendRatingsModal';
import ListPickerModal from '@/src/components/ListPickerModal';
import { getLocalToday } from '@/src/lib/utils';
import type { WatchStatus } from '@/src/lib/types';

const STATUS_LABELS: Record<WatchStatus, string> = {
  want_to_watch: 'Watchlist',
  currently_watching: 'Watching',
  watched: 'Finished',
  muted: 'Muted',
};

const STATUSES: WatchStatus[] = ['want_to_watch', 'currently_watching', 'watched'];

function formatAirdate(airdate: string): string {
  const d = new Date(airdate + 'T00:00:00');
  const now = new Date();
  const diffDays = Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Airs today';
  if (diffDays === 1) return 'Airs tomorrow';
  if (diffDays > 0 && diffDays < 7) return `Airs in ${diffDays} days`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const label = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return diffDays < 0 ? `Aired ${label}` : `Airs ${label}`;
}

const STATUS_ICONS: Record<WatchStatus, React.ComponentProps<typeof FontAwesome>['name']> = {
  want_to_watch: 'bookmark-o',
  currently_watching: 'play',
  watched: 'check',
  muted: 'volume-off',
};

export default function ShowDetailScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const router = useRouter();
  const data = useShowData(id);
  const {
    show, loading, error, userId,
    userShow, setUserShow, watchedEps, setWatchedEps,
    userLists, listsContaining, setListsContaining,
    friendsWatching, refetchWatchedEps, refetchUserShow, refetchFriendsWatching, refetch,
  } = data;

  // Refetch user-specific state on screen focus. Without this, swiping to
  // catch up on My Shows updates the DB but the cached show-detail state
  // (userShow.current_*, watchedEps) stays at whatever it was when this
  // screen first mounted — episode list looks stale until a hard reload.
  useFocusEffect(useCallback(() => {
    refetchUserShow();
    refetchWatchedEps();
    refetchFriendsWatching();
  }, [refetchUserShow, refetchWatchedEps, refetchFriendsWatching]));

  const actions = useShowActions({
    userId, id, show, userShow,
    setUserShow, setWatchedEps, setListsContaining,
    refetchWatchedEps,
  });

  const [listModalVisible, setListModalVisible] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [friendRatingsVisible, setFriendRatingsVisible] = useState(false);
  const [friendsExpanded, setFriendsExpanded] = useState(false);

  // ─── First-visit coachmark sequence ────────────────────────────────────
  // Four-step chain on a user's first show detail visit:
  //   Watchlist → Watching → Finished → Mute
  // Each pill / button gets a ref the coachmark hook uses to measure. The
  // sequence is gated on `coachmarksReady` — the screen must be focused AND
  // the show data must be loaded (otherwise the pills aren't on-screen and
  // measureInWindow would bail). All four hooks run unconditionally; the
  // chain via `showAfter` ensures only one is visible at a time.
  const watchlistPillRef = useRef<View>(null);
  const watchingPillRef = useRef<View>(null);
  const finishedPillRef = useRef<View>(null);
  const muteRef = useRef<View>(null);
  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setIsFocused(true);
    return () => setIsFocused(false);
  }, []));
  const coachmarksReady = isFocused && !loading && !error && !!show;
  // Pre-add the status pills are solid accent (orange) so the default
  // accent-colored cutout ring + tap pulse vanish into them — override to
  // white so the indicators read against the button. Mute matches for visual
  // consistency across the four-step sequence.
  const PILL_HIGHLIGHT = '#fff';
  useCoachmark({
    id: 'tap_watchlist',
    when: coachmarksReady,
    ref: watchlistPillRef,
    gesture: 'tap',
    title: 'Watchlist',
    body: 'Save shows here to watch later.',
    highlightColor: PILL_HIGHLIGHT,
  });
  useCoachmark({
    id: 'tap_watching',
    when: coachmarksReady,
    ref: watchingPillRef,
    gesture: 'tap',
    title: 'Watching',
    body: 'Track your progress and get a heads-up when new episodes and premieres drop.',
    showAfter: 'tap_watchlist',
    highlightColor: PILL_HIGHLIGHT,
  });
  useCoachmark({
    id: 'tap_finished',
    when: coachmarksReady,
    ref: finishedPillRef,
    gesture: 'tap',
    title: 'Finished',
    body: 'Mark a show as finished and rate it.',
    showAfter: 'tap_watching',
    highlightColor: PILL_HIGHLIGHT,
  });
  useCoachmark({
    id: 'tap_mute',
    when: coachmarksReady,
    ref: muteRef,
    gesture: 'tap',
    title: 'Mute a show',
    body: 'Hides it from every list. Undo any time from the Profile tab.',
    showAfter: 'tap_finished',
    highlightColor: PILL_HIGHLIGHT,
  });

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
        <Text style={styles.errorText}>Couldn&apos;t load show</Text>
        <Text style={styles.errorHint}>{error || 'Check your connection and try again.'}</Text>
        <Pressable
          style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.7 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            refetch();
          }}
        >
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  // AIRING reflects "actively releasing episodes right now" — not just "not ended".
  // TVMaze marks shows "Running" during long hiatuses between seasons, so we also
  // require a scheduled next episode within the next 30 days.
  const isRunning = (() => {
    if (show.status !== 'Running' || !show.nextEpisode?.airdate) return false;
    const next = new Date(show.nextEpisode.airdate + 'T00:00:00').getTime();
    const daysAway = (next - Date.now()) / (1000 * 60 * 60 * 24);
    return daysAway <= 30;
  })();
  const today = getLocalToday();

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

  // Built once, rendered in state-dependent spots: above the fold while the
  // user is evaluating an untracked/watchlisted show, after the rating and
  // friends sections once it's finished.
  const aboutSection = (
    <View style={styles.aboutSection}>
      {show.summary && (
        <Text style={styles.aboutSummary}>{show.summary}</Text>
      )}

      {show.runtime != null && (
        <Text style={styles.aboutRuntime}>~{show.runtime} min per episode</Text>
      )}

      {show.nextEpisode && show.status === 'Running' && (
        <View style={styles.aboutNextEp}>
          <Text style={styles.aboutNextEpLabel}>Next Episode</Text>
          <Text style={styles.aboutNextEpTitle} numberOfLines={1}>
            S{show.nextEpisode.season} · E{show.nextEpisode.number}
            {show.nextEpisode.name ? ` — ${show.nextEpisode.name}` : ''}
          </Text>
          {show.nextEpisode.airdate && (
            <Text style={styles.aboutNextEpDate}>
              {formatAirdate(show.nextEpisode.airdate)}
            </Text>
          )}
        </View>
      )}

      {show.cast.length > 0 && (
        <View>
          <Text style={styles.aboutSectionTitle}>Cast</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.castRow}
          >
            {show.cast.slice(0, 12).map((c, i) => (
              <View key={`${c.personName}-${i}`} style={styles.castCard}>
                {c.image ? (
                  <Image source={{ uri: c.image }} style={styles.castImage} contentFit="cover" transition={200} />
                ) : (
                  <View style={[styles.castImage, styles.castPlaceholder]}>
                    <Text style={styles.castPlaceholderText}>👤</Text>
                  </View>
                )}
                <Text style={styles.castCharacter} numberOfLines={1}>{c.characterName}</Text>
                <Text style={styles.castPerson} numberOfLines={1}>{c.personName}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} scrollEnabled={scrollEnabled}>
        <View style={styles.topBar}>
          <Pressable style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.5 }]} onPress={() => {
            if (from) router.push(from as any);
            else router.back();
          }}>
            <FontAwesome name="chevron-left" size={16} color={theme.accent} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          {/* Mute toggle. No confirm alert in either direction — single
              tap commits. When muted, the page content below dims so the
              muted state is visible without a banner. The button itself
              stays at full opacity so the user can always tap to unmute. */}
          <Pressable
            ref={muteRef}
            style={({ pressed }) => [
              styles.topBarAction,
              userShow?.status === 'muted' && styles.topBarActionMuted,
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={8}
            onPress={() => {
              const wasMuted = userShow?.status === 'muted';
              Haptics.impactAsync(
                wasMuted
                  ? Haptics.ImpactFeedbackStyle.Light
                  : Haptics.ImpactFeedbackStyle.Medium
              );
              if (wasMuted) {
                // Toggle off: silent untrack — no "Remove from list?" alert.
                actions.handleStatusChange('muted', { confirm: false });
              } else {
                if (userShow) actions.handleStatusChange('muted');
                else actions.handleAddWithStatus('muted');
              }
            }}
          >
            {/* Icon flips between speaker (inactive) and slashed-speaker
                (active = muted). Ionicons because FontAwesome 4 doesn't
                ship a slashed-speaker glyph. */}
            <Ionicons
              name={userShow?.status === 'muted' ? 'volume-mute' : 'volume-medium'}
              size={26}
              color={userShow?.status === 'muted' ? '#fff' : theme.textDim}
            />
          </Pressable>
        </View>

        <View style={userShow?.status === 'muted' ? styles.mutedContent : undefined}>

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
        <WatchProgressBar
          airedCount={airedCount}
          watchedCount={
            !userShow
              ? 0
              : userShow.status === 'watched'
                ? airedCount
                : userShow.status === 'want_to_watch'
                  ? 0
                  : Math.min(watchedEps.size, airedCount)
          }
        />

        {/* Watchlist Controls */}
        <View style={styles.section}>
          <View style={styles.statusRow}>
            {STATUSES.map(s => {
              const isActive = userShow?.status === s;
              // Empty state pills are solid accent, so icon/text needs bright contrast.
              // Paper theme's textBright is dark slate which collapses against the
              // dark-blue accent — force white there specifically.
              const isLightTheme = theme.statusBarStyle === 'dark';
              const onAccent = isLightTheme ? '#fff' : theme.textBright;
              const iconColor = !userShow || isActive ? onAccent : theme.textDim;
              const pillRef = s === 'want_to_watch' ? watchlistPillRef
                : s === 'currently_watching' ? watchingPillRef
                : s === 'watched' ? finishedPillRef
                : undefined;
              return (
                <Pressable
                  key={s}
                  ref={pillRef}
                  style={({ pressed }) => [
                    styles.statusPill,
                    !userShow && styles.statusPillEmpty,
                    userShow && !isActive && styles.statusPillInactive,
                    isActive && styles.statusPillActive,
                    pressed && !isActive && styles.statusPillPressed,
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    const apply = () => {
                      if (userShow) actions.handleStatusChange(s);
                      else actions.handleAddWithStatus(s);
                    };
                    if (s === 'watched' && show.status !== 'Ended' && userShow?.status !== 'watched') {
                      Alert.alert(
                        'Are you sure you are finished?',
                        'This show is still airing. Finished shows are not tracked.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Finished', style: 'destructive', onPress: apply },
                        ],
                      );
                      return;
                    }
                    apply();
                  }}
                >
                  <FontAwesome name={STATUS_ICONS[s]} size={13} color={iconColor} />
                  <Text style={[
                    styles.statusPillText,
                    !userShow && styles.statusPillTextEmpty,
                    isActive && styles.statusPillTextActive,
                    isLightTheme && (!userShow || isActive) && { color: '#fff' },
                  ]}>
                    {STATUS_LABELS[s]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* "Did you mean Watching?" nudge — appears only after the user
              has selected Watched on a still-airing show. Tap to switch.
              Doesn't block the original decision; just gives a soft escape
              hatch in case they meant Currently Watching. Hidden when the
              show is officially Ended (no ambiguity). */}
          {userShow?.status === 'watched' && show.status !== 'Ended' && (
            <Pressable
              style={({ pressed }) => [styles.stillAiringRow, pressed && { opacity: 0.7 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                actions.handleStatusChange('currently_watching');
              }}
            >
              <FontAwesome name="info-circle" size={12} color={theme.accent} />
              <Text style={styles.stillAiringText}>
                Still airing — switch to Watching?
              </Text>
            </Pressable>
          )}

          {/* Catch up / caught up — inline under pills */}
          {userShow && userShow.status === 'currently_watching' && (
            watchedEps.size >= airedCount ? (
              <View style={styles.caughtUpRow}>
                <FontAwesome name="check" size={12} color={theme.successDim} />
                <Text style={styles.caughtUpText}>All caught up</Text>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.catchUpRow, pressed && { opacity: 0.7 }]}
                onPress={actions.handleCatchUp}
              >
                <FontAwesome name="forward" size={11} color={theme.accent} />
                <Text style={styles.catchUpText}>Catch up to latest</Text>
              </Pressable>
            )
          )}

          {/* Friend activity — collapsible card on Watching only */}
          {friendsWatching.length > 0 && userShow?.status === 'currently_watching' && (
            <Pressable
              style={({ pressed }) => [styles.friendsCard, pressed && { opacity: 0.8 }]}
              onPress={() => setFriendsExpanded(e => !e)}
            >
              <View style={styles.friendsCardHeader}>
                <View style={styles.avatarStack}>
                  {friendsWatching.slice(0, 3).map((fw, i) => (
                    fw.profile.avatar_url ? (
                      <Image key={fw.profile.id} source={{ uri: fw.profile.avatar_url }} style={[styles.stackAvatar, i > 0 && styles.stackAvatarOverlap]} contentFit="cover" />
                    ) : (
                      <View key={fw.profile.id} style={[styles.stackAvatarFallback, i > 0 && styles.stackAvatarOverlap]}>
                        <Text style={styles.stackAvatarText}>{(fw.profile.display_name[0] || '?').toUpperCase()}</Text>
                      </View>
                    )
                  ))}
                </View>
                <View style={styles.friendsCardMeta}>
                  <Text style={styles.friendsCardTitle}>Friend activity</Text>
                  <Text style={styles.friendsCardCount}>
                    {friendsWatching.length} friend{friendsWatching.length !== 1 ? 's' : ''}
                  </Text>
                </View>
                <FontAwesome name={friendsExpanded ? 'chevron-up' : 'chevron-down'} size={11} color={theme.textDim} />
              </View>
              {friendsExpanded && (
                <View style={styles.friendsList}>
                  {friendsWatching.map(fw => {
                    const behind = fw.season > 0 ? getEpisodesBehind(fw.season, fw.episode) : 0;
                    const statusLabel = fw.status === 'want_to_watch' ? 'Wants to watch'
                      : fw.status === 'watched' ? 'Finished'
                      : fw.status === 'muted' ? 'Muted'
                      : fw.season === 0 ? 'Not started'
                      : behind === 0 ? 'Caught up'
                      : `${behind} ep${behind !== 1 ? 's' : ''} behind`;
                    const isPositive = fw.status === 'watched' || (fw.status === 'currently_watching' && behind === 0);
                    const isMuted = fw.status === 'muted';
                    return (
                      <View key={fw.profile.id} style={styles.friendRow}>
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
                        <Text style={[styles.friendStatus, isPositive && styles.friendStatusPositive, isMuted && styles.friendStatusMuted]}>{statusLabel}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </Pressable>
          )}
        </View>

        {/* Friend activity — flat list for Watchlist, Dropped, and no-status.
            For the "no show added yet" case this is the top priority so social
            signal is the first thing a user sees when evaluating a show. */}
        {friendsWatching.length > 0 && (!userShow || userShow.status === 'want_to_watch' || userShow.status === 'muted') && (
          <View style={styles.friendsFlatSection}>
            <Text style={styles.friendsFlatTitle}>Friend activity</Text>
            {friendsWatching.map(fw => {
              const behind = fw.season > 0 ? getEpisodesBehind(fw.season, fw.episode) : 0;
              const statusLabel = fw.status === 'want_to_watch' ? 'Wants to watch'
                : fw.status === 'watched' ? 'Finished'
                : fw.status === 'muted' ? 'Muted'
                : fw.season === 0 ? 'Not started'
                : behind === 0 ? 'Caught up'
                : `${behind} ep${behind !== 1 ? 's' : ''} behind`;
              const isPositive = fw.status === 'watched' || (fw.status === 'currently_watching' && behind === 0);
              const isMuted = fw.status === 'muted';
              return (
                <View key={fw.profile.id} style={styles.friendFlatRow}>
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
                  <Text style={[styles.friendStatus, isPositive && styles.friendStatusPositive, isMuted && styles.friendStatusMuted]}>{statusLabel}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* About — surface details before the user commits to the show, and
            keep them for the two settled states (Watchlist, Finished), where
            the page has room to be informative again. Only Watching drops it:
            there the episode picker dominates, and mid-show is also where a
            synopsis is closest to a spoiler. Above the pills' sections when
            evaluating, below them once added — action mode leads. */}
        {(!userShow || userShow.status === 'want_to_watch') && aboutSection}

        {/* Currently Watching: episode picker */}
        {userShow && userShow.status === 'currently_watching' && (
          <>
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
            {friendsWatching.length > 0 && (
              <View style={styles.friendsFlatSection}>
                <Text style={styles.friendsFlatTitle}>Friends</Text>
                {friendsWatching
                  .sort((a, b) => {
                    if (a.status === 'watched' && b.status !== 'watched') return -1;
                    if (a.status !== 'watched' && b.status === 'watched') return 1;
                    return 0;
                  })
                  .map(fw => {
                    const behind = fw.season > 0 ? getEpisodesBehind(fw.season, fw.episode) : 0;
                    const hasRating = fw.status === 'watched' && fw.rating != null;
                    const statusLabel = fw.status === 'want_to_watch' ? 'Wants to watch'
                      : fw.status === 'watched' ? 'Finished'
                      : fw.status === 'muted' ? 'Muted'
                      : fw.season === 0 ? 'Not started'
                      : behind === 0 ? 'Caught up'
                      : `${behind} ep${behind !== 1 ? 's' : ''} behind`;
                    const isPositive = fw.status === 'watched' || (fw.status === 'currently_watching' && behind === 0);
                    const isMuted = fw.status === 'muted';
                    return (
                      <View key={fw.profile.id} style={styles.friendFlatRow}>
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
                        {hasRating ? (
                          <View style={[styles.friendRating, { backgroundColor: `${getUserRatingColor(fw.rating!)}20` }]}>
                            <Text style={[styles.friendRatingText, { color: getUserRatingColor(fw.rating!) }]}>
                              {fw.rating!.toFixed(1)}
                            </Text>
                          </View>
                        ) : (
                          <Text style={[styles.friendStatus, isPositive && styles.friendStatusPositive, isMuted && styles.friendStatusMuted]}>{statusLabel}</Text>
                        )}
                      </View>
                    );
                  })}
              </View>
            )}
            {aboutSection}
          </>
        )}
        </View>
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

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  content: {
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topBarAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginHorizontal: 12,
    marginVertical: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  topBarActionMuted: {
    backgroundColor: theme.accent,
  },
  backText: {
    fontSize: 15,
    fontFamily: 'DMSans_500Medium',
    color: theme.accent,
  },
  // Wraps the entire show body when status === 'muted'. Dimming the page
  // signals "this is muted" without a banner — top-bar mute toggle stays
  // outside this wrapper so it remains tappable to unmute.
  mutedContent: {
    opacity: 0.4,
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
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 20,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
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
    gap: 10,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 6,
  },
  statusPill: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: theme.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  statusPillEmpty: {
    // Pre-selection all three are primary CTAs — solid accent fill makes them
    // obviously tappable without the old border-plus-fill double treatment.
    backgroundColor: theme.accent,
  },
  statusPillInactive: {
    // Post-selection, the un-picked pills recede so the active one dominates,
    // but stay readable so the user can switch.
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  statusPillPressed: {
    backgroundColor: 'rgba(255,107,53,0.5)',
  },
  statusPillActive: {
    backgroundColor: theme.accent,
  },
  stillAiringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 6,
  },
  stillAiringText: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.accent,
  },
  catchUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  catchUpText: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.accent,
  },
  caughtUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  caughtUpText: {
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
    color: theme.successDim,
  },
  statusPillText: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
  },
  statusPillTextEmpty: {
    color: theme.textBright,
  },
  statusPillTextActive: {
    color: theme.textBright,
  },


  // About section (empty-state only: pre-commit details)
  aboutSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 18,
  },
  aboutSummary: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
    lineHeight: 20,
  },
  aboutRuntime: {
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
  },
  aboutNextEp: {
    backgroundColor: theme.bgCard,
    padding: 14,
    borderRadius: 10,
    gap: 4,
  },
  aboutNextEpLabel: {
    fontSize: 10,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  aboutNextEpTitle: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  aboutNextEpDate: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  aboutSectionTitle: {
    fontSize: 12,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  castRow: {
    gap: 12,
    paddingRight: 8,
  },
  castCard: {
    width: 90,
  },
  castImage: {
    width: 90,
    height: 120,
    borderRadius: 6,
  },
  castPlaceholder: {
    backgroundColor: theme.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  castPlaceholderText: {
    fontSize: 28,
  },
  castCharacter: {
    fontSize: 12,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
    marginTop: 6,
  },
  castPerson: {
    fontSize: 11,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    marginTop: 1,
  },

  // Friends
  friendsCard: {
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    overflow: 'hidden',
  },
  friendsCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  friendsCardMeta: {
    flex: 1,
    gap: 1,
  },
  friendsCardTitle: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  friendsCardCount: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: theme.bgCard,
  },
  stackAvatarOverlap: {
    marginLeft: -10,
  },
  stackAvatarFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.bg,
    borderWidth: 2,
    borderColor: theme.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackAvatarText: {
    fontSize: 10,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
  },
  friendsList: {
    paddingHorizontal: 14,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  friendsFlatSection: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  friendsFlatTitle: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
    marginBottom: 10,
  },
  friendFlatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    gap: 10,
  },
  friendAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendAvatarImage: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  friendAvatarText: {
    fontSize: 11,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
  },
  friendName: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
    color: theme.text,
  },
  friendStatus: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },
  friendStatusPositive: {
    fontFamily: 'DMSans_600SemiBold',
    color: theme.successDim,
  },
  friendStatusMuted: {
    fontFamily: 'DMSans_600SemiBold',
    color: 'rgba(239,68,68,0.7)',
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
