import { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { getUserRatingColor } from '@/src/components/RatingSelector';
import type { UserShow } from '@/src/lib/types';

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
}

const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isAiredRecently(airdate: string | null): boolean {
  if (!airdate) return false;
  const aired = new Date(airdate + 'T00:00:00').getTime();
  const diff = Date.now() - aired;
  return diff >= 0 && diff <= NEW_WINDOW_MS;
}

function WatchlistCard({ show, onPress, nextEpisode, onMarkNext, onMarkWatched, onCatchUp, leftAccessory, hidePosters, airsToday }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
  // Approximate progress using episode position across all seasons. We don't
  // cache per-season totals, so AVG_PER_SEASON is a heuristic — works well
  // for prestige TV (8-12 ep seasons), under/over-estimates on 22-ep network
  // shows or 4-ep miniseries. Good enough for a visual cue; future migration
  // could cache real totals.
  const AVG_PER_SEASON = 10;
  const positionOf = (season: number, episode: number) =>
    Math.max(0, season - 1) * AVG_PER_SEASON + Math.max(0, episode);
  const watchedPos = positionOf(show.current_season, show.current_episode);
  const airedPos =
    show.last_aired_season != null && show.last_aired_episode != null
      ? positionOf(show.last_aired_season, show.last_aired_episode)
      : watchedPos + behindCount;
  const progressPct = airedPos > 0 ? Math.min(1, watchedPos / airedPos) : 0;

  const handleActionPress = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (isPremiereDay && show.next_episode_season != null && show.next_episode_episode != null) {
      // Mark E1 of the upcoming season — flips engagement and the show
      // moves to Watching on the next render.
      onMarkNext?.(show.show_id, show.next_episode_season, show.next_episode_episode);
      return;
    }
    if (isMultiBehind) {
      onCatchUp?.(show);
    } else if (isSingleBehind && nextEpisode) {
      onMarkNext?.(show.show_id, nextEpisode.season, nextEpisode.episode);
    }
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

  // Right-side affordance. Premiere day = ✓ pill that engages with the
  // upcoming season's E1. Single-behind = ✓ (one-tap mark). Multi-behind /
  // cross-season = pill (count or ›) opening the catch-up sheet. All share
  // the accentBg-tinted style.
  const actionPill = (() => {
    if (show.status === 'currently_watching' && (hasNext || isPremiereDay)) {
      return (
        <Pressable
          hitSlop={10}
          style={({ pressed }) => [styles.actionPill, pressed && { opacity: 0.55 }]}
          onPress={handleActionPress}
        >
          <Text style={styles.actionPillText}>
            {isPremiereDay || isSingleBehind ? '✓' : isCrossSeasonBehind ? '›' : behindCount}
          </Text>
        </Pressable>
      );
    }
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
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && styles.pressed,
        showToday && styles.rowGlow,
      ]}
      onPress={() => onPress(show.show_id)}
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
  );
}

export default memo(WatchlistCard);

const createStyles = (theme: Theme) => StyleSheet.create({
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
  actionPill: {
    minWidth: 32,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 10,
    backgroundColor: theme.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPillText: {
    fontSize: 13,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
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
