import { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { getUserRatingColor } from '@/src/components/RatingSelector';
import { daysBetween, getLocalToday } from '@/src/lib/utils';
import type { UserShow } from '@/src/lib/types';

function daysUntil(airdate: string): number {
  // Compare local-midnight to local-midnight so an episode airing
  // tomorrow always reads "tomorrow," even when the user is checking at
  // 9pm and tomorrow's midnight is technically <24 hours away. The old
  // ms-difference math rounded that to 0 days and rendered "today."
  return daysBetween(getLocalToday(), airdate);
}

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// "9:00 PM" → "9PM", "9:30 PM" → "9:30PM". Uses formatToParts so we don't
// depend on the locale's literal separator (some locales drop the space).
function formatTime(d: Date): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const parts = fmt.formatToParts(d);
  const hour = parts.find(p => p.type === 'hour')?.value ?? '';
  const minute = parts.find(p => p.type === 'minute')?.value ?? '';
  const dp = (parts.find(p => p.type === 'dayPeriod')?.value ?? '').toUpperCase().replace(/\s/g, '');
  return minute === '00' ? `${hour}${dp}` : `${hour}:${minute}${dp}`;
}

function formatNextEpisodeIn(airdate: string, airstamp: string | null, airtime: string | null): string {
  // No airstamp → row hasn't been refreshed since the airstamp column landed.
  // No airtime → TVMaze didn't pin a real drop time (common for streamers like
  // Prime, Apple TV+, MGM+) — its `airstamp` defaults to noon UTC in that
  // case, which would render confidently-wrong "today at 12PM" copy. In both
  // cases fall through to date-only.
  if (!airstamp || !airtime) {
    const days = daysUntil(airdate);
    if (days <= 0) return 'Next episode today';
    if (days === 1) return 'Next episode tomorrow';
    return `Next episode in ${days}d`;
  }

  // airstamp is "2026-05-10T16:00:00+00:00" — fully qualified, JS parses it
  // straight to the absolute instant. Day + time render in device tz.
  const instant = new Date(airstamp);
  if (isNaN(instant.getTime())) {
    const days = daysUntil(airdate);
    if (days <= 0) return 'Next episode today';
    if (days === 1) return 'Next episode tomorrow';
    return `Next episode in ${days}d`;
  }

  // Recompute days against the user-local date — converting from network tz
  // can shift the day across midnight (a Sunday 9pm ET show is Monday 2am
  // for a UK viewer).
  const userDate = localDateString(instant);
  const days = daysBetween(getLocalToday(), userDate);

  // Outside the 3-day window → fall back to date-only "in Xd" copy
  if (days < 0 || days > 3) {
    if (days <= 0) return 'Next episode today';
    if (days === 1) return 'Next episode tomorrow';
    return `Next episode in ${days}d`;
  }

  const time = formatTime(instant);

  if (days === 0) {
    // Past 6pm device-local + airing today reads as "tonight" — feels more
    // imminent than the generic "today" cue. Pre-6pm shows (3am late-night
    // drops, daytime soaps) keep "today".
    const nowHour = new Date().getHours();
    if (nowHour >= 18) return `Next episode tonight at ${time}`;
    return `Next episode today at ${time}`;
  }
  if (days === 1) return `Next episode tomorrow at ${time}`;
  const weekday = instant.toLocaleDateString(undefined, { weekday: 'long' });
  return `Next episode ${weekday} at ${time}`;
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
  // Friend-profile / list-display reads. Strips the row to title + poster +
  // rating only — no catch-up subtext, no progress bar, no TODAY pill. The
  // interactive affordances (Done? pill, swipe, long-press) are already
  // separately gated on their callbacks, but the visual flair has its own
  // gate here so a passive viewer doesn't see "behind" / "Next ep in 3d"
  // copy that only makes sense on your own list.
  readOnly?: boolean;
  // Ref attached to the outermost row View. Used by the tutorial system to
  // anchor a coachmark to a specific row. Doesn't affect rendering otherwise.
  outerRef?: React.Ref<View>;
}

const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isAiredRecently(airdate: string | null): boolean {
  if (!airdate) return false;
  const aired = new Date(airdate + 'T00:00:00').getTime();
  const diff = Date.now() - aired;
  return diff >= 0 && diff <= NEW_WINDOW_MS;
}

// Mirror of isBehindFromCache in app/(tabs)/index.tsx — must include the
// same null/future last_aired_airdate guard. Stale cached rows (from before
// f34b02f) can have last_aired_episode pointing at a null-airdate
// placeholder; those should NOT count as behind, otherwise the row renders
// "S{N} E{N}" catch-up copy for an episode that hasn't aired yet.
function isCachedBehind(s: { last_aired_season: number | null; last_aired_episode: number | null; last_aired_airdate: string | null; current_season: number; current_episode: number }): boolean {
  if (s.last_aired_season == null || s.last_aired_episode == null) return false;
  if (!s.last_aired_airdate) return false;
  const today = getLocalToday();
  if (s.last_aired_airdate > today) return false;
  if (s.last_aired_season > s.current_season) return true;
  if (s.last_aired_season === s.current_season && s.last_aired_episode > s.current_episode) return true;
  return false;
}

function WatchlistCard({ show, onPress, nextEpisode, onMarkWatched, onCatchUp, leftAccessory, hidePosters, airsToday, watchedCount, readOnly, outerRef }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const hasNext = !!nextEpisode && show.status === 'currently_watching';
  const showToday = !readOnly && airsToday && show.status === 'currently_watching';
  const isEnded = show.status === 'currently_watching' && !hasNext && show.show_status === 'Ended';
  const isNewEpisode = hasNext && isAiredRecently(nextEpisode?.airdate ?? null);

  const scheduleBehind = nextEpisode?.behindCount ?? 0;
  // Cache-derived "behind" math is gated on isCachedBehind so stale rows
  // (last_aired_airdate null or in the future) can't render as behind.
  // Without that gate, a row with a null-airdate placeholder cached as
  // last_aired would show "S{N} E{N}" catch-up copy for an unaired episode.
  const cachedBehind = isCachedBehind(show);
  const sameSeasonBehind =
    cachedBehind && show.last_aired_season === show.current_season && show.last_aired_episode != null
      ? Math.max(0, show.last_aired_episode - show.current_episode)
      : 0;
  const isCrossSeasonBehind =
    cachedBehind &&
    show.last_aired_season != null &&
    show.last_aired_season > show.current_season;
  const behindCount = Math.max(scheduleBehind, sameSeasonBehind);
  const isBehind = hasNext || sameSeasonBehind > 0 || isCrossSeasonBehind;
  // Cross-season with count=1 (season finale → season premiere, one ep to
  // watch) falls under isSingleBehind so it renders "S{n} E{n}" like any
  // other 1-behind row, matching the user's mental model that "one episode
  // away" is the same regardless of season boundary. The vague "Catch up"
  // copy is reserved for genuine multi-episode cross-season gaps (S1E4 of
  // a S4-airing show) where the next-episode number alone doesn't convey
  // how far behind the user is.
  const isMultiBehind = isBehind && behindCount >= 2;
  const isSingleBehind = isBehind && !isMultiBehind;

  // Premiere fingerprints — see classifyCW for the same shape. Day-of fires
  // when last_aired is E1 of a new season AND that airdate is today. Upcoming
  // fires when caught up to last_aired and the next future ep is E1 of a new
  // season with an airdate >= today. Multi-season catch-up (user on S1E4 of a
  // S4-airing show) does NOT match — last_aired_episode is > 1.
  // current_season > 0 guard: premiere copy is only meaningful if the user
  // was actually following the show. A fresh add of a long-running show
  // (current=0, last_aired=S2E1+) trivially passes the season comparison
  // and misfires as "PREMIERES TODAY" when really they just haven't
  // engaged with the show yet.
  // Airdate gates: without them a premiere that aired days ago still trips
  // the "PREMIERES TODAY" copy because the E1-of-newer-season fingerprint
  // stays true until the user advances their progress. Same story for
  // isPremiereUpcoming when next_episode_airdate is in the past because
  // the cron missed bumping last_aired.
  const today = getLocalToday();
  const isPremiereDay =
    isBehind &&
    show.current_season > 0 &&
    show.last_aired_season != null &&
    show.last_aired_episode === 1 &&
    show.last_aired_season > show.current_season &&
    show.last_aired_airdate === today;
  const isPremiereUpcoming =
    !isBehind &&
    show.current_season > 0 &&
    !!show.next_episode_airdate &&
    show.show_status !== 'Ended' &&
    show.next_episode_season != null &&
    show.next_episode_episode === 1 &&
    show.next_episode_season > show.current_season &&
    show.next_episode_airdate >= today;

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
    !readOnly &&
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

  // Single-behind / premiere-day rows still have something to catch up to —
  // the long-press modal handles all flavors. The swipe-to-mark-next mechanic
  // (and its accompanying orange left bar) used to live here but was removed
  // in favor of the modal-only flow.
  const isSingleCatchup =
    show.status === 'currently_watching' &&
    (isPremiereDay || (isSingleBehind && !!nextEpisode));
  // Long-press surfaces the catch-up modal whenever there's anything to catch
  // up to. Lets the user pick an exact episode rather than the one-tap default.
  const hasCatchup =
    !!onCatchUp &&
    show.status === 'currently_watching' &&
    (isSingleCatchup || isMultiBehind || isCrossSeasonBehind);

  const handleLongPress = () => {
    if (!hasCatchup) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onCatchUp?.(show);
  };

  // Subtext under the title: state-dependent. Premieres get a prominent
  // accent treatment so the row reads as a moment, not a generic Returning
  // card. Single-behind keeps the "NEW · S5 E5" copy. Everything else is
  // dim metadata.
  //
  // All catch-up-flavored subtexts (Catch up, N behind, NEW · S5 E5, premiere
  // banners, mid-season "Returns in") are gated on currently_watching.
  // The underlying behind-state derivations are pure season/episode math —
  // a Watched or Watchlist show whose last_aired_season is past the user's
  // current_season would otherwise render "Catch up" forever.
  const subtext = (() => {
    if (readOnly) return null;
    if (show.status === 'want_to_watch' && show.show_network) {
      return <Text style={styles.subtext} numberOfLines={1}>{show.show_network}</Text>;
    }
    if (show.status !== 'currently_watching') return null;

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
          {formatNextEpisodeIn(show.next_episode_airdate, show.next_episode_airstamp, show.next_episode_airtime)}
        </Text>
      );
    }
    return null;
  })();

  // Right-side affordance. Catch-up actions (single, multi, cross-season,
  // premiere) used to live here as tap pills — those moved to the swipe-right
  // gesture (single) and long-press (modal). What remains: the "Done?" nudge
  // for ended shows, and the rating circle for watched shows.
  const actionPill = (() => {
    if (onMarkWatched && show.status === 'currently_watching' && !hasNext && isEnded) {
      return (
        <Pressable
          style={({ pressed }) => [styles.endedNudge, pressed && { opacity: 0.6 }]}
          onPress={(e) => {
            e.stopPropagation();
            onMarkWatched(show.show_id);
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
    <View style={styles.outer} ref={outerRef} collapsable={false}>
      <View style={styles.swipeWrap}>
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
      </View>
    </View>
  );
}

// Custom comparator: skip the function-prop identity check (callers pass
// useCallback'd handlers — these may still tick refs even when underlying
// behavior is identical) and instead compare exactly the fields this
// component renders from. Keep this list in sync with what the component
// reads above; missing a field means stale rows.
function areEqual(prev: Props, next: Props): boolean {
  if (prev.show !== next.show) {
    // Object identity differs — cheap escape. Fall through to field-level
    // comparison so we don't re-render when only an irrelevant field changed.
    if (
      prev.show.show_id !== next.show.show_id ||
      prev.show.show_title !== next.show.show_title ||
      prev.show.show_image !== next.show.show_image ||
      prev.show.show_network !== next.show.show_network ||
      prev.show.show_status !== next.show.show_status ||
      prev.show.status !== next.show.status ||
      prev.show.current_season !== next.show.current_season ||
      prev.show.current_episode !== next.show.current_episode ||
      prev.show.last_aired_season !== next.show.last_aired_season ||
      prev.show.last_aired_episode !== next.show.last_aired_episode ||
      prev.show.last_aired_airdate !== next.show.last_aired_airdate ||
      prev.show.next_episode_airdate !== next.show.next_episode_airdate ||
      prev.show.next_episode_season !== next.show.next_episode_season ||
      prev.show.next_episode_episode !== next.show.next_episode_episode ||
      prev.show.next_episode_airstamp !== next.show.next_episode_airstamp ||
      prev.show.next_episode_airtime !== next.show.next_episode_airtime ||
      prev.show.total_aired_episodes !== next.show.total_aired_episodes ||
      prev.show.rating !== next.show.rating ||
      prev.show.caught_up !== next.show.caught_up
    ) {
      return false;
    }
  }
  if (
    prev.nextEpisode?.season !== next.nextEpisode?.season ||
    prev.nextEpisode?.episode !== next.nextEpisode?.episode ||
    prev.nextEpisode?.airdate !== next.nextEpisode?.airdate ||
    prev.nextEpisode?.behindCount !== next.nextEpisode?.behindCount
  ) {
    return false;
  }
  if (prev.airsToday !== next.airsToday) return false;
  if (prev.watchedCount !== next.watchedCount) return false;
  if (prev.hidePosters !== next.hidePosters) return false;
  if (prev.isCaughtUp !== next.isCaughtUp) return false;
  if (prev.leftAccessory !== next.leftAccessory) return false;
  if (prev.readOnly !== next.readOnly) return false;
  // outerRef identity matters — coachmark target moves between rows.
  if (prev.outerRef !== next.outerRef) return false;
  // Function props: assumed stable via useCallback in parent. If a parent
  // ever passes a fresh function each render, that'd silently nerf this
  // memo — flag it during code review.
  return true;
}

export default memo(WatchlistCard, areEqual);

const createStyles = (theme: Theme) => StyleSheet.create({
  outer: {
    position: 'relative',
  },
  swipeWrap: {
    backgroundColor: theme.bg,
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
    // Paper's dark-blue accent washes out against many poster backdrops, and
    // white fails on light posters. Brick red is saturated enough to read on
    // both, and stays editorial-feeling against the cream theme. Scoped to
    // paper only — other themes keep their accent fill.
    backgroundColor: theme.statusBarStyle === 'dark' ? '#B83A2A' : theme.accent,
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
