import { memo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '@/src/lib/theme';
import type { PopularShow } from '@/src/lib/watchlist';

interface Props {
  items: PopularShow[];
  onPress: (showId: string) => void;
}

export default memo(function PopularWithFriendsRow({ items, onPress }: Props) {
  if (items.length === 0) return null;

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {items.map(item => (
          <Pressable
            key={item.show_id}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
            onPress={() => onPress(item.show_id)}
          >
            {item.show_image ? (
              <Image source={{ uri: item.show_image }} style={styles.poster} contentFit="cover" transition={200} />
            ) : (
              <View style={[styles.poster, styles.posterPlaceholder]}>
                <Text style={styles.placeholderText}>📺</Text>
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(19,21,32,0)', theme.bg]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.edgeFade}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 12,
  },
  card: {
    width: 92,
  },
  poster: {
    width: 92,
    height: 131,
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
    fontSize: 28,
  },
  edgeFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 48,
  },
});
