import { memo } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '@/src/lib/theme';
import type { ListItem } from '@/src/lib/types';

interface Props {
  items: ListItem[];
  onPress?: (itemId: string) => void;
  size?: 'default' | 'large';
}

export default memo(function TopShowsRow({ items, onPress, size = 'default' }: Props) {
  const { width } = useWindowDimensions();
  const isSmall = width < 380;
  if (items.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {items.map(item => (
          <Pressable
            key={item.item_id}
            style={({ pressed }) => [styles.posterWrap, pressed && onPress && { opacity: 0.7 }]}
            onPress={() => onPress?.(item.item_id)}
          >
            {item.item_image ? (
              <Image
                source={{ uri: item.item_image }}
                style={size === 'large' ? [styles.posterLarge, isSmall && styles.posterLargeSmall] : styles.poster}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={[size === 'large' ? [styles.posterLarge, isSmall && styles.posterLargeSmall] : styles.poster, styles.posterPlaceholder]}>
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
  posterLarge: {
    width: 88,
    height: 125,
    borderRadius: 6,
  },
  posterLargeSmall: {
    width: 78,
    height: 111,
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
