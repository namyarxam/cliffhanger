import { useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/src/providers/AuthProvider';
import { theme } from '@/src/lib/theme';
import { getFriends, getPendingRequests } from '@/src/lib/friends';

export default function ProfileScreen() {
  const { profile, user, signOut } = useAuth();
  const router = useRouter();
  const [friendCount, setFriendCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      getFriends(user.id).then(f => setFriendCount(f.length)).catch(() => {});
      getPendingRequests(user.id).then(p => setPendingCount(p.length)).catch(() => {});
    }, [user?.id])
  );

  return (
    <View style={styles.container}>
      {/* Avatar placeholder */}
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {(profile?.display_name || profile?.username || '?')[0].toUpperCase()}
        </Text>
      </View>

      <Text style={styles.displayName}>
        {profile?.display_name || 'Anonymous'}
      </Text>
      <Text style={styles.username}>
        @{profile?.username || 'unknown'}
      </Text>
      <Text style={styles.email}>{user?.email}</Text>

      {/* Friends button */}
      <Pressable
        style={({ pressed }) => [styles.friendsButton, pressed && styles.friendsButtonPressed]}
        onPress={() => router.push('/(tabs)/friends')}
      >
        <View style={styles.friendsButtonContent}>
          <Text style={styles.friendsButtonText}>Friends</Text>
          <Text style={styles.friendsCount}>{friendCount}</Text>
        </View>
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>{pendingCount}</Text>
          </View>
        )}
        <Text style={styles.friendsChevron}>▸</Text>
      </Pressable>

      <Pressable style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 32,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.bgCard,
    borderWidth: 2,
    borderColor: theme.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 32,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
  },
  displayName: {
    fontSize: 22,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 4,
  },
  username: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
    marginBottom: 4,
  },
  email: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    marginBottom: 32,
  },
  friendsButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.bgCard,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  friendsButtonPressed: {
    opacity: 0.7,
  },
  friendsButtonContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  friendsButtonText: {
    fontSize: 16,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  friendsCount: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  pendingBadge: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginRight: 8,
  },
  pendingBadgeText: {
    fontSize: 11,
    fontFamily: 'DMSans_700Bold',
    color: '#fff',
  },
  friendsChevron: {
    fontSize: 16,
    color: theme.textDim,
  },
  signOutButton: {
    marginTop: 'auto',
    marginBottom: 40,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.3)',
  },
  signOutText: {
    color: '#f87171',
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
  },
});
