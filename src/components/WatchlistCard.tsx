import { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '@/src/lib/theme';
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

interface Props {
  show: UserShow;
  onPress: (id: string) => void;
  nextEpisode?: { season: number; episode: number };
  onMarkNext?: (showId: string, season: number, episode: number) => void;
  isCaughtUp?: boolean;
  leftAccessory?: React.ReactNode;
  hidePosters?: boolean;
}

export default memo(function WatchlistCard({ show, onPress, nextEpisode, onMarkNext, isCaughtUp: caughtUp, leftAccessory, hidePosters }: Props) {
  const hasNext = !!nextEpisode && show.status === 'currently_watching';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        pressed && styles.pressed,
        hasNext && styles.containerGlow,
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
        <Text style={styles.title} numberOfLines={1}>
          {show.show_title}
        </Text>
      </View>

      {leftAccessory}

      {/* Right side: network, episode progress, catch-up CTA, or rating */}
      {show.status === 'want_to_watch' && show.show_network && (
        <Text style={styles.network}>{show.show_network}</Text>
      )}

      {show.status === 'currently_watching' && hasNext && (
        <View style={styles.catchUpRow}>
          <View style={styles.catchUpInfo}>
            <Text style={styles.catchUpNew}>NEW</Text>
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
      )}

      {show.status === 'currently_watching' && !hasNext && (
        <View style={styles.rightInfo}>
          {show.current_season > 0 ? (
            <Text style={styles.progress}>
              S{show.current_season} E{show.current_episode}
            </Text>
          ) : (
            <Text style={styles.progress}>Not started</Text>
          )}
          {caughtUp && <Text style={styles.caughtUpCheck}>✓</Text>}
        </View>
      )}

      {show.status === 'watched' && show.rating != null && (
        <View style={[styles.ratingCircle, { backgroundColor: `${getUserRatingColor(show.rating)}20` }]}>
          <Text style={[styles.ratingText, { color: getUserRatingColor(show.rating) }]}>
            {show.rating.toFixed(1)}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
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
  title: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
    flexShrink: 1,
  },
  rightInfo: {
    alignItems: 'center',
    gap: 2,
  },
  progress: {
    fontSize: 12,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
  },
  caughtUpCheck: {
    fontSize: 12,
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
    color: theme.textBright,
  },
});
