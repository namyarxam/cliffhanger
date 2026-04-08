import { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '@/src/lib/theme';
import { formatVotes, isLive } from '@/src/lib/utils';
import RatingBadge from './RatingBadge';
import type { ShowSummary, ShowFull } from '@/src/lib/types';

interface Props {
  show: ShowSummary | ShowFull;
  rank?: number;
  onPress: (id: string) => void;
}

export default memo(function ShowCard({ show, rank, onPress }: Props) {
  const live = isLive(show.lastAired);

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => onPress(show.id)}
    >
      {/* Poster */}
      <View style={styles.posterWrap}>
        {'image' in show && show.image ? (
          <Image
            source={{ uri: show.image }}
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

      {/* Info */}
      <View style={styles.info}>
        <View style={styles.titleRow}>
          {rank != null && (
            <Text style={styles.rank}>#{rank}</Text>
          )}
          <Text style={styles.title} numberOfLines={1}>
            {show.title}
          </Text>
          {live && (
            <View style={styles.liveDot} />
          )}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {show.year}{show.endYear ? `–${show.endYear}` : ''} · {show.genre} · {show.seasons}S · {formatVotes(show.totalRatings)} votes
        </Text>
      </View>

      {/* Rating */}
      <RatingBadge rating={show.overallRating} size="sm" />
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
  rank: {
    fontSize: 12,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
    minWidth: 28,
  },
  title: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
    flexShrink: 1,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4ade80',
  },
  meta: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },
});
