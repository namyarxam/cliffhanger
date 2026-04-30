import { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { getUserRatingColor } from '@/src/components/RatingSelector';
import type { UserShow } from '@/src/lib/types';

function formatAirdate(airdate: string): string {
  const epDate = new Date(airdate + 'T00:00:00');
  const now = new Date();
  const diffMs = now.getTime() - epDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return airdate;
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  const sameYear = epDate.getFullYear() === now.getFullYear();
  return epDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// Future-leaning version: cached `next_episode_airdate` can occasionally fall
// in the past if the schedule cron hasn't caught up — handle both directions.
function formatReturnDate(airdate: string): string {
  const epDate = new Date(airdate + 'T00:00:00');
  const now = new Date();
  const diffDays = Math.round((epDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays > 1 && diffDays < 7) return `in ${diffDays}d`;
  if (diffDays < 0) return formatAirdate(airdate);
  const sameYear = epDate.getFullYear() === now.getFullYear();
  return epDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
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

function WatchlistCard({ show, onPress, nextEpisode, onMarkNext, onMarkWatched, onCatchUp, isCaughtUp: caughtUp, leftAccessory, hidePosters, airsToday }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const hasNext = !!nextEpisode && show.status === 'currently_watching';
  const showToday = airsToday && show.status === 'currently_watching';
  const isEnded = show.status === 'currently_watching' && !hasNext && show.show_status === 'Ended';
  const isReturning = show.status === 'currently_watching' && !hasNext && !isEnded && !!show.next_episode_airdate;
  // "NEW" is reserved for the specific episode the user is being prompted to
  // mark — only fire when its airdate is within the last week. Skips the false
  // positive on old shows where the next-unwatched aired years ago.
  const isNewEpisode = hasNext && isAiredRecently(nextEpisode?.airdate ?? null);

  // Multi-behind count: schedule table is the live source (updates when the
  // cron runs), but only contains episodes that aired since polling started.
  // For shows with backlog that aired before the cron's coverage window
  // (e.g., user added a show with several already-aired episodes), schedule
  // undercounts. Cache's last_aired_* gives us same-season exact diff; for
  // cross-season we don't know season totals so we can't compute a number —
  // render a chevron sentinel and let the catch-up sheet show the detail.
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
  const isMultiBehind = hasNext && (behindCount >= 2 || isCrossSeasonBehind);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        pressed && styles.pressed,
        showToday && styles.containerGlow,
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
      </View>

      {leftAccessory}

      {/* Right side: network, episode progress, catch-up CTA, or rating */}
      {show.status === 'want_to_watch' && show.show_network && (
        <Text style={styles.network}>{show.show_network}</Text>
      )}

      {show.status === 'currently_watching' && hasNext && (
        isMultiBehind ? (
          <Pressable
            style={({ pressed }) => [styles.catchUpRow, pressed && { opacity: 0.7 }]}
            onPress={(e) => {
              e.stopPropagation();
              onCatchUp?.(show);
            }}
          >
            <View style={styles.catchUpButton}>
              <Text style={styles.catchUpCount}>
                {isCrossSeasonBehind ? '›' : behindCount}
              </Text>
            </View>
          </Pressable>
        ) : (
          <View style={styles.catchUpRow}>
            <View style={styles.catchUpInfo}>
              {isNewEpisode && <Text style={styles.catchUpNew}>NEW</Text>}
              <Text style={styles.catchUpLabel}>
                S{nextEpisode.season} E{nextEpisode.episode}
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.catchUpButton, pressed && { opacity: 0.7 }]}
              onPress={(e) => {
                e.stopPropagation();
                onMarkNext?.(show.show_id, nextEpisode.season, nextEpisode.episode);
              }}
            >
              <Text style={styles.catchUpCheck}>✓</Text>
            </Pressable>
          </View>
        )
      )}

      {show.status === 'currently_watching' && !hasNext && isEnded && (
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
      )}

      {show.status === 'currently_watching' && !hasNext && isReturning && (
        <Text style={styles.returnDate}>{formatReturnDate(show.next_episode_airdate!)}</Text>
      )}

      {/* On hiatus or status unknown: render nothing on the right — the
          sub-section header carries the meaning. */}

      {show.status === 'watched' && show.rating != null && (
        <View style={[styles.ratingCircle, { backgroundColor: `${getUserRatingColor(show.rating)}20` }]}>
          <Text style={[styles.ratingText, { color: getUserRatingColor(show.rating) }]}>
            {show.rating.toFixed(1)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export default memo(WatchlistCard);

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 12,
  },
  containerGlow: {
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
  returnDate: {
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
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
  network: {
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
    color: 'rgba(255,255,255,0.45)',
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

  // Catch-up CTA
  catchUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  catchUpInfo: {
    alignItems: 'flex-end',
    gap: 1,
  },
  catchUpNew: {
    fontSize: 9,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
    letterSpacing: 1,
  },
  catchUpLabel: {
    fontSize: 12,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.accent,
  },
  catchUpButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catchUpCheck: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  catchUpCount: {
    fontSize: 13,
    fontFamily: 'DMSans_700Bold',
    color: '#fff',
    lineHeight: 16,
  },
});
