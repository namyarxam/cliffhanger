import { useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/src/providers/AuthProvider';

import { theme } from '@/src/lib/theme';
import { supabase } from '@/src/lib/supabase';
import { getFriends, getPendingRequests } from '@/src/lib/friends';
import { getTopShows } from '@/src/lib/topshows';
import TopShowsRow from '@/src/components/TopShowsRow';
import type { TopShow } from '@/src/lib/types';

export default function ProfileScreen() {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const router = useRouter();

  const [friendCount, setFriendCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [topShows, setTopShows] = useState<TopShow[]>([]);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      getFriends(user.id).then(f => setFriendCount(f.length)).catch(() => {});
      getPendingRequests(user.id).then(p => setPendingCount(p.length)).catch(() => {});
      getTopShows(user.id).then(setTopShows).catch(() => {});
    }, [user?.id])
  );

  const handleStartEdit = () => {
    setEditName(profile?.display_name || '');
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!user?.id || !editName.trim()) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: editName.trim() })
        .eq('id', user.id);

      if (error) throw error;
      await refreshProfile();
      setEditing(false);
    } catch {
      // silently fail
    }
  };

  return (
    <View style={styles.container}>
      {/* Avatar */}
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {(profile?.display_name || profile?.username || '?')[0].toUpperCase()}
        </Text>
      </View>

      {/* Display name — tappable to edit */}
      {editing ? (
        <View style={styles.editRow}>
          <TextInput
            style={styles.editInput}
            value={editName}
            onChangeText={setEditName}
            autoFocus
            maxLength={40}
            onSubmitEditing={handleSaveEdit}
            returnKeyType="done"
          />
          <Pressable style={styles.saveButton} onPress={handleSaveEdit}>
            <Text style={styles.saveText}>Save</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} onPress={() => setEditing(false)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={handleStartEdit}>
          <Text style={styles.displayName}>
            {profile?.display_name || 'Anonymous'}
            <Text style={styles.editHint}> ✎</Text>
          </Text>
        </Pressable>
      )}

      <Text style={styles.username}>
        @{profile?.username || 'unknown'}
      </Text>
      <Text style={styles.email}>{user?.email}</Text>

      {/* Top 4 Shows */}
      <TopShowsRow
        shows={topShows}
        onPress={(showId) => router.push(`/show/${showId}?from=/profile`)}
      />

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

      {/* Settings button */}
      <Pressable
        style={({ pressed }) => [styles.settingsButton, pressed && { opacity: 0.7 }]}
        onPress={() => router.push('/(tabs)/settings')}
      >
        <Text style={styles.settingsButtonText}>Settings</Text>
        <Text style={styles.settingsChevron}>▸</Text>
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
  editHint: {
    fontSize: 16,
    color: theme.textFaint,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  editInput: {
    fontSize: 20,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 150,
    textAlign: 'center',
  },
  saveButton: {
    backgroundColor: theme.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  saveText: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },
  cancelButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  cancelText: {
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
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
  settingsButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.bgCard,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
    marginTop: 12,
  },
  settingsButtonText: {
    fontSize: 16,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  settingsChevron: {
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
