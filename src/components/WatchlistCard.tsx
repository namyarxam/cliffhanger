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
  hasNewEpisodes?: boolean;
  leftAccessory?: React.ReactNode;
}

export default memo(function WatchlistCard({ show, onPress, hasNewEpisodes, leftAccessory }: Props) {
  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => onPress(show.show_id)}
    >
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

      <View style={styles.info}>
        <View style={styles.titleRow}>
          {hasNewEpisodes && <View style={styles.newDot} />}
          <Text style={styles.title} numberOfLines={1}>
            {show.show_title}
          </Text>
        </View>
        {hasNewEpisodes && (
          <Text style={styles.newText}>New episodes</Text>
        )}
      </View>

      {leftAccessory}

      {/* Right side: network, episode progress, or rating */}
      {show.status === 'want_to_watch' && show.show_network && (
        <Text style={styles.network}>{show.show_network}</Text>
      )}

      {show.status === 'currently_watching' && show.current_season > 0 && (
        <View style={styles.rightInfo}>
          <Text style={styles.progress}>
            S{show.current_season} E{show.current_episode}
          </Text>
          {show.current_episode_airdate && (
            <Text style={styles.progressDate}>
              {formatAirdate(show.current_episode_airdate)}
            </Text>
          )}
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
    gap: 6,
  },
  newDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.accent,
  },
  title: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
    flexShrink: 1,
  },
  newText: {
    fontSize: 11,
    fontFamily: 'DMSans_500Medium',
    color: theme.accent,
    marginTop: 1,
  },
  rightInfo: {
    alignItems: 'flex-end',
    gap: 2,
  },
  progress: {
    fontSize: 12,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.accent,
  },
  progressDate: {
    fontSize: 11,
    fontFamily: 'DMSans_400Regular',
    color: 'rgba(255,255,255,0.45)',
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
});
