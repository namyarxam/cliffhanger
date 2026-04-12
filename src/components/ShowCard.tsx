import { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '@/src/lib/theme';
import type { ShowSummary } from '@/src/lib/types';

interface Props {
  show: ShowSummary;
  onPress: (id: string) => void;
}

export default memo(function ShowCard({ show, onPress }: Props) {
  const isRunning = show.status === 'Running';

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => onPress(show.id)}
    >
      <View style={styles.posterWrap}>
        {show.image ? (
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

      <View style={styles.info}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {show.title}
          </Text>
          {isRunning && <View style={styles.liveDot} />}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {show.year}{show.endYear ? `–${show.endYear}` : ''}
          {show.genre ? ` · ${show.genre}` : ''}
          {show.network ? ` · ${show.network}` : ''}
        </Text>
      </View>
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
    backgroundColor: theme.success,
  },
  meta: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },
});
