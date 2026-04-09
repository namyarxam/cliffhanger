import { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { theme } from '@/src/lib/theme';
import type { UserProfile } from '@/src/lib/types';

export type FriendAction = 'add' | 'pending' | 'accept' | 'friends' | 'none';

interface Props {
  user: UserProfile;
  action: FriendAction;
  onPress?: (userId: string) => void;
  onAction?: (userId: string) => void;
  onDecline?: (userId: string) => void;
}

function getInitial(name: string): string {
  return (name[0] || '?').toUpperCase();
}

export default memo(function FriendRow({
  user,
  action,
  onPress,
  onAction,
  onDecline,
}: Props) {
  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && onPress && styles.pressed]}
      onPress={() => onPress?.(user.id)}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{getInitial(user.display_name || user.username)}</Text>
      </View>

      <View style={styles.info}>
        <Text style={styles.displayName} numberOfLines={1}>
          {user.display_name || user.username}
        </Text>
        <Text style={styles.username}>@{user.username}</Text>
      </View>

      {action === 'add' && (
        <Pressable
          style={({ pressed }) => [styles.actionButton, pressed && styles.actionPressed]}
          onPress={() => onAction?.(user.id)}
        >
          <Text style={styles.actionText}>Add</Text>
        </Pressable>
      )}

      {action === 'pending' && (
        <View style={styles.pendingBadge}>
          <Text style={styles.pendingText}>Pending</Text>
        </View>
      )}

      {action === 'accept' && (
        <View style={styles.requestActions}>
          <Pressable
            style={({ pressed }) => [styles.acceptButton, pressed && styles.actionPressed]}
            onPress={() => onAction?.(user.id)}
          >
            <Text style={styles.acceptText}>Accept</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.declineButton, pressed && styles.actionPressed]}
            onPress={() => onDecline?.(user.id)}
          >
            <Text style={styles.declineText}>Decline</Text>
          </Pressable>
        </View>
      )}

      {action === 'friends' && (
        <View style={styles.friendsBadge}>
          <Text style={styles.friendsText}>Friends</Text>
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
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  displayName: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  username: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  actionButton: {
    backgroundColor: theme.accent,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionPressed: {
    opacity: 0.7,
  },
  actionText: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },
  pendingBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
  },
  pendingText: {
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 8,
  },
  acceptButton: {
    backgroundColor: theme.accent,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  acceptText: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },
  declineButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
  },
  declineText: {
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
  },
  friendsBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(74,222,128,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.2)',
  },
  friendsText: {
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
    color: 'rgba(74,222,128,0.7)',
  },
});
