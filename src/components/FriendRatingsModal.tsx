import { memo } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Modal } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '@/src/lib/theme';
import { getUserRatingColor } from '@/src/components/RatingSelector';
import type { FriendWatching } from '@/src/hooks/useShowData';

interface Props {
  visible: boolean;
  onClose: () => void;
  friends: FriendWatching[];
}

export default memo(function FriendRatingsModal({ visible, onClose, friends }: Props) {
  const rated = friends.filter(f => f.rating != null).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Friend Ratings</Text>
          <Pressable onPress={onClose}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <FlatList
          data={rated}
          keyExtractor={item => item.profile.id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              {item.profile.avatar_url ? (
                <Image source={{ uri: item.profile.avatar_url }} style={styles.avatarImage} contentFit="cover" />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {(item.profile.display_name[0] || '?').toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={styles.name} numberOfLines={1}>{item.profile.display_name}</Text>
              <View style={[styles.badge, { backgroundColor: `${getUserRatingColor(item.rating!)}20` }]}>
                <Text style={[styles.badgeValue, { color: getUserRatingColor(item.rating!) }]}>
                  {item.rating!.toFixed(1)}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No friends have rated this show yet</Text>
            </View>
          }
        />
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  title: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  done: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.accent,
  },
  empty: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarText: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
  },
  name: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  badge: {
    minWidth: 42,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  badgeValue: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
  },
});
