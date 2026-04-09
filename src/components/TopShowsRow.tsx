import { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '@/src/lib/theme';
import type { TopShow } from '@/src/lib/types';

interface Props {
  shows: TopShow[];
  onPress?: (showId: string) => void;
}

export default memo(function TopShowsRow({ shows, onPress }: Props) {
  if (shows.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {shows.map(show => (
          <Pressable
            key={show.show_id}
            style={({ pressed }) => [styles.posterWrap, pressed && onPress && { opacity: 0.7 }]}
            onPress={() => onPress?.(show.show_id)}
          >
            {show.show_image ? (
              <Image
                source={{ uri: show.show_image }}
                style={styles.poster}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={[styles.poster, styles.posterPlaceholder]}>
                <Text style={styles.placeholderText}>📺</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  label: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  posterWrap: {
    borderRadius: 6,
    overflow: 'hidden',
  },
  poster: {
    width: 70,
    height: 100,
    borderRadius: 6,
  },
  posterPlaceholder: {
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  placeholderText: {
    fontSize: 24,
  },
});
