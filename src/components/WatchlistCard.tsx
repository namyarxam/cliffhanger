import { memo, useMemo, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, PanResponder } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { getUserRatingColor } from '@/src/components/RatingSelector';
import type { UserShow } from '@/src/lib/types';

// Single-catchup swipe tuning. Threshold = commit point. Cap = max travel
// (resistance past commit gives a rubbery "armed" feel). Both empirically
// chosen to feel deliberate but not slow.
const SWIPE_COMMIT_THRESHOLD = 70;
const SWIPE_MAX_TRAVEL = 110;

function daysUntil(airdate: string): number {
  const next = new Date(airdate + 'T00:00:00');
  return Math.round((next.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
function formatNextEpisodeIn(airdate: string): string {
  const days = daysUntil(airdate);
  if (days <= 0) return 'Next episode today';
  if (days === 1) return 'Next episode tomorrow';
  return `Next episode in ${days}d`;
}
function formatPremiereIn(airdate: string): string {
  const days = daysUntil(airdate);
  if (days <= 0) return 'Premieres today';
  if (days === 1) return 'Premieres tomorrow';
  if (days < 7) return `Premieres in ${days}d`;
  const date = new Date(airdate + 'T00:00:00');
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return `Premieres ${date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })}`;
}

interface Props {
  show: UserShow;
  onPress: (id: string) => void;
  nextEpisode?: { season: number; episode: number; airdate: string | null; behindCount: number };
  onMarkNext?: (showId: string, season: number, episode: number) => void;
  onMarkWatched?: (showId: string) => void;
  onCatchUp?: (show: UserShow) => void;
  isCaughtUp?: boolean;
  leftAccessory?: React.ReactNode;
  hidePosters?: boolean;
  airsToday?: boolean;
  watchedCount?: number;
}

const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isAiredRecently(airdate: string | null): boolean {
  if (!airdate) return false;
  const aired = new Date(airdate + 'T00:00:00').getTime();
  const diff = Date.now() - aired;
  return diff >= 0 && diff <= NEW_WINDOW_MS;
}

function WatchlistCard({ show, onPress, nextEpisode, onMarkNext, onMarkWatched, onCatchUp, leftAccessory, hidePosters, airsToday, watchedCount }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const dragX = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  const hasNext = !!nextEpisode && show.status === 'currently_watching';
  const showToday = airsToday && show.status === 'currently_watching';
  const isEnded = show.status === 'currently_watching' && !hasNext && show.show_status === 'Ended';
  const isNewEpisode = hasNext && isAiredRecently(nextEpisode?.airdate ?? null);

  const scheduleBehind = nextEpisode?.behindCount ?? 0;
  const sameSeasonBehind = (() => {
    if (show.last_aired_season == null || show.last_aired_episode == null) return 0;
    if (show.last_aired_season !== show.current_season) return 0;
    return Math.max(0, show.last_aired_episode - show.current_episode);
  })();
  const isCrossSeasonBehind =
    show.last_aired_season != null &&
    show.last_aired_episode != null &&
    show.last_aired_season > show.current_season;
  const behindCount = Math.max(scheduleBehind, sameSeasonBehind);
  const isBehind = hasNext || sameSeasonBehind > 0 || isCrossSeasonBehind;
  const isMultiBehind = isBehind && (behindCount >= 2 || isCrossSeasonBehind);
  const isSingleBehind = isBehind && !isMultiBehind;

  // Premiere fingerprints — see classifyCW for the same shape. Day-of fires
  // when last_aired is E1 of a new season (cron just bumped). Upcoming fires
  // when caught up to last_aired and the next future ep is E1 of a new
  // season. Multi-season catch-up (user on S1E4 of a S4-airing show) does
  // NOT match — last_aired_episode is > 1.
  const isPremiereDay =
    isBehind &&
    show.last_aired_season != null &&
    show.last_aired_episode === 1 &&
    show.last_aired_season > show.current_season;
  const isPremiereUpcoming =
    !isBehind &&
    !!show.next_episode_airdate &&
    show.show_status !== 'Ended' &&
    show.next_episode_season != null &&
    show.next_episode_episode === 1 &&
    show.next_episode_season > show.current_season;

  // Caught up + airdate + not an upcoming-premiere = mid-season Watching.
  // (Upcoming-premiere drops to Returning instead.)
  const isCaughtUpActive =
    show.status === 'currently_watching' &&
    !isBehind &&
    !isEnded &&
    !!show.next_episode_airdate &&
    !isPremiereUpcoming;

  // Poster progress strip: only renders inside the Watching sub-group —
  // engaged shows that are either behind or caught-up-active. Returning,
  // Hiatus, Ended, Watchlist, Watched skip the strip. Premieres (in
  // Returning) also skip — their progress through the upcoming season is
  // 0 until they engage.
  const showProgress =
    show.status === 'currently_watching' &&
    !isPremiereDay &&
    !isPremiereUpcoming &&
    (isBehind || isCaughtUpActive);
  // Real progress: count of episodes the user has marked watched divided by
  // count of episodes that have aired. Both are exact — no AVG_PER_SEASON
  // heuristic, no over/under-estimation on long network shows or miniseries.
  // Falls back to the position heuristic for legacy rows where
  // total_aired_episodes hasn't been populated yet (cron self-heals within
  // hours, and any show-detail visit fills it in immediately).
  const AVG_PER_SEASON = 10;
  const positionOf = (season: number, episode: number) =>
    Math.max(0, season - 1) * AVG_PER_SEASON + Math.max(0, episode);
  const progressPct = (() => {
    if (show.total_aired_episodes != null && show.total_aired_episodes > 0 && watchedCount != null) {
      return Math.min(1, watchedCount / show.total_aired_episodes);
    }
    const watchedPos = positionOf(show.current_season, show.current_episode);
    const airedPos =
      show.last_aired_season != null && show.last_aired_episode != null
        ? positionOf(show.last_aired_season, show.last_aired_episode)
        : watchedPos + behindCount;
    return airedPos > 0 ? Math.min(1, watchedPos / airedPos) : 0;
  })();

  // Single-tap catch-up applies in two states:
  //   - Watching, single-behind → mark next aired episode.
  //   - Returning, premiere-day → mark E1 of the new season (flips engagement,
  //     show jumps to Watching on next render).
  // Both fire onMarkNext under the hood; the swipe gesture below dispatches.
  const isSingleCatchup =
    show.status === 'currently_watching' && (isPremiereDay || (isSingleBehind && !!nextEpisode));
  // Long-press surfaces the catch-up modal whenever there's anything to catch
  // up to. Lets the user pick an exact episode rather than the one-tap default.
  const hasCatchup =
    show.status === 'currently_watching' && (isSingleCatchup || isMultiBehind || isCrossSeasonBehind);

  const fireSingleCatchup = () => {
    if (isPremiereDay && show.next_episode_season != null && show.next_episode_episode != null) {
      onMarkNext?.(show.show_id, show.next_episode_season, show.next_episode_episode);
    } else if (isSingleBehind && nextEpisode) {
      onMarkNext?.(show.show_id, nextEpisode.season, nextEpisode.episode);
    }
  };

  // PanResponder claims the gesture only when the user moves clearly to the
  // right — vertical scrolls and taps fall through to the SectionList /
  // Pressable as before. Past commit threshold the row resists further travel
  // (rubbery feel) and a haptic fires once at the threshold cross to signal
  // the swipe is armed.
  const panResponder = useMemo(
    () =>
      isSingleCatchup
        ? PanResponder.create({
            onMoveShouldSetPanResponder: (_, g) => g.dx > 8 && Math.abs(g.dy) < Math.abs(g.dx),
            onPanResponderGrant: () => {
              armed.current = false;
            },
            onPanResponderMove: (_, g) => {
              if (g.dx <= 0) {
                dragX.setValue(0);
                return;
              }
              const past = Math.max(0, g.dx - SWIPE_COMMIT_THRESHOLD);
              const resisted = SWIPE_COMMIT_THRESHOLD + past * 0.35;
              const next = Math.min(g.dx < SWIPE_COMMIT_THRESHOLD ? g.dx : resisted, SWIPE_MAX_TRAVEL);
              dragX.setValue(next);
              if (!armed.current && g.dx >= SWIPE_COMMIT_THRESHOLD) {
                armed.current = true;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              } else if (armed.current && g.dx < SWIPE_COMMIT_THRESHOLD) {
                armed.current = false;
              }
            },
            onPanResponderRelease: (_, g) => {
              const committed = g.dx >= SWIPE_COMMIT_THRESHOLD;
              if (committed) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                fireSingleCatchup();
              }
              Animated.spring(dragX, {
                toValue: 0,
                useNativeDriver: true,
                tension: 80,
                friction: 12,
              }).start();
              armed.current = false;
            },
            onPanResponderTerminate: () => {
              Animated.spring(dragX, {
                toValue: 0,
                useNativeDriver: true,
                tension: 80,
                friction: 12,
              }).start();
              armed.current = false;
            },
          })
        : null,
    // fireSingleCatchup closes over current props; rebuild when any of those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSingleCatchup, isPremiereDay, isSingleBehind, nextEpisode?.season, nextEpisode?.episode, show.next_episode_season, show.next_episode_episode],
  );

  const handleLongPress = () => {
    if (!hasCatchup) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onCatchUp?.(show);
  };

  // Subtext under the title: state-dependent. Premieres get a prominent
  // accent treatment so the row reads as a moment, not a generic Returning
  // card. Single-behind keeps the "NEW · S5 E5" copy. Everything else is
  // dim metadata.
  const subtext = (() => {
    if (isPremiereDay) {
      return (
        <Text style={styles.subtext} numberOfLines={1}>
          <Text style={styles.subtextAccent}>🎬 PREMIERES TODAY</Text>
        </Text>
      );
    }
    if (isPremiereUpcoming && show.next_episode_airdate) {
      return (
        <Text style={styles.subtext} numberOfLines={1}>
          {formatPremiereIn(show.next_episode_airdate)}
        </Text>
      );
    }
    if (isSingleBehind && nextEpisode) {
      return (
        <Text style={styles.subtext} numberOfLines={1}>
          {isNewEpisode && <Text style={styles.subtextAccent}>NEW · </Text>}
          S{nextEpisode.season} E{nextEpisode.episode}
        </Text>
      );
    }
    if (isMultiBehind && !isCrossSeasonBehind) {
      return (
        <Text style={styles.subtext} numberOfLines={1}>
          {behindCount} episodes behind
        </Text>
      );
    }
    if (isCrossSeasonBehind) {
      return <Text style={styles.subtext} numberOfLines={1}>Catch up</Text>;
    }
    if (isCaughtUpActive && show.next_episode_airdate) {
      return (
        <Text style={styles.subtext} numberOfLines={1}>
          {formatNextEpisodeIn(show.next_episode_airdate)}
        </Text>
      );
    }
    if (show.status === 'want_to_watch' && show.show_network) {
      return <Text style={styles.subtext} numberOfLines={1}>{show.show_network}</Text>;
    }
    return null;
  })();

  // Right-side affordance. Catch-up actions (single, multi, cross-season,
  // premiere) used to live here as tap pills — those moved to the swipe-right
  // gesture (single) and long-press (modal). What remains: the "Done?" nudge
  // for ended shows, and the rating circle for watched shows.
  const actionPill = (() => {
    if (show.status === 'currently_watching' && !hasNext && isEnded) {
      return (
        <Pressable
          style={({ pressed }) => [styles.endedNudge, pressed && { opacity: 0.6 }]}
          onPress={(e) => {
            e.stopPropagation();
            onMarkWatched?.(show.show_id);
          }}
          hitSlop={6}
        >
          <Text style={styles.endedNudgeText}>Done?</Text>
          <Text style={styles.endedNudgeCheck}>✓</Text>
        </Pressable>
      );
    }
    if (show.status === 'watched' && show.rating != null) {
      return (
        <View style={[styles.ratingCircle, { backgroundColor: `${getUserRatingColor(show.rating)}20` }]}>
          <Text style={[styles.ratingText, { color: getUserRatingColor(show.rating) }]}>
            {show.rating.toFixed(1)}
          </Text>
        </View>
      );
    }
    // Returning / hiatus / want-to-watch: nothing on the right. Row is still
    // tappable to navigate; the right-side stays clean.
    return null;
  })();

  return (
    <View style={styles.outer}>
      {/* Persistent orange bar at the screen's left edge — visual hint that
          the row is swipe-actionable. Stays put while the row content
          translates right under the user's finger. */}
      {isSingleCatchup && <View style={styles.catchupBar} pointerEvents="none" />}
      <Animated.View
        style={[styles.swipeWrap, { transform: [{ translateX: dragX }] }]}
        {...(panResponder?.panHandlers ?? {})}
      >
        <Pressable
          style={({ pressed }) => [
            styles.row,
            pressed && styles.pressed,
            showToday && styles.rowGlow,
          ]}
          onPress={() => onPress(show.show_id)}
          onLongPress={hasCatchup ? handleLongPress : undefined}
          delayLongPress={400}
        >
          {!hidePosters && (
            <View style={styles.posterWrap}>
              {show.show_image ? (
                <Image
                  source={{ uri: show.show_image }}
                  style={styles.poster}
                  contentFit="cover"
                  transition={200}
                />
              ) : (
                <View style={[styles.poster, styles.posterPlaceholder]}>
                  <Text style={styles.posterPlaceholderText}>📺</Text>
                </View>
              )}
              {showProgress && (
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progressPct * 100}%` }]} />
                </View>
              )}
            </View>
          )}

          <View style={styles.info}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>
                {show.show_title}
              </Text>
              {showToday && (
                <View style={styles.todayPill}>
                  <View style={styles.todayDot} />
                  <Text style={styles.todayText}>TODAY</Text>
                </View>
              )}
            </View>
            {subtext}
          </View>

          {leftAccessory}

          {actionPill}
        </Pressable>
      </Animated.View>
    </View>
  );
}

export default memo(WatchlistCard);

const createStyles = (theme: Theme) => StyleSheet.create({
  outer: {
    position: 'relative',
  },
  swipeWrap: {
    backgroundColor: theme.bg,
  },
  catchupBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: theme.accent,
    zIndex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 12,
  },
  rowGlow: {
    backgroundColor: 'rgba(255,107,53,0.06)',
    borderLeftWidth: 3,
    borderLeftColor: theme.accent,
  },
  pressed: {
    backgroundColor: theme.bgCard,
  },
  posterWrap: {
    width: 40,
    height: 56,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: theme.bgCard,
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  posterPlaceholder: {
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterPlaceholderText: {
    fontSize: 18,
  },
  progressTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.accent,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
    flexShrink: 1,
  },
  subtext: {
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
  },
  subtextAccent: {
    color: theme.accent,
    fontFamily: 'DMSans_700Bold',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  todayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,107,53,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  todayDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.accent,
  },
  todayText: {
    fontSize: 9,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
    letterSpacing: 0.8,
  },
  chevron: {
    fontSize: 22,
    color: theme.textDim,
    fontFamily: 'DMSans_400Regular',
  },
  endedNudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
  },
  endedNudgeText: {
    fontSize: 11,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
  },
  endedNudgeCheck: {
    fontSize: 11,
    fontFamily: 'DMSans_700Bold',
    color: theme.successDim,
  },
  ratingCircle: {
    minWidth: 36,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  ratingText: {
    fontSize: 12,
    fontFamily: 'DMSans_700Bold',
  },
});
