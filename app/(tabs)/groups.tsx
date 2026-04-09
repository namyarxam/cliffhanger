import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getMyGroups, joinGroup } from '@/src/lib/groups';
import GroupCard from '@/src/components/GroupCard';
import type { Group } from '@/src/lib/types';

export default function GroupsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);

  const fetchGroups = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await getMyGroups(userId);
      setGroups(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      fetchGroups();
    }, [fetchGroups])
  );

  const handlePress = useCallback((id: string) => {
    router.push(`/group/${id}`);
  }, [router]);

  const handleJoin = useCallback(async () => {
    if (!userId || !inviteCode.trim()) return;
    setJoining(true);
    try {
      const group = await joinGroup(userId, inviteCode);
      setJoinModalVisible(false);
      setInviteCode('');
      fetchGroups();
      router.push(`/group/${group.id}`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to join group');
    } finally {
      setJoining(false);
    }
  }, [userId, inviteCode, fetchGroups, router]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Action buttons */}
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.actionButton, styles.createButton, pressed && styles.actionPressed]}
          onPress={() => router.push('/group/create')}
        >
          <Text style={styles.createButtonText}>Create Group</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.actionButton, styles.joinButton, pressed && styles.actionPressed]}
          onPress={() => setJoinModalVisible(true)}
        >
          <Text style={styles.joinButtonText}>Join Group</Text>
        </Pressable>
      </View>

      {groups.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No groups yet</Text>
          <Text style={styles.emptyText}>
            Create a group for a show you're watching, or join one with an invite code
          </Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <GroupCard group={item} onPress={handlePress} />
          )}
          contentContainerStyle={styles.list}
        />
      )}

      {/* Join Modal */}
      <Modal
        visible={joinModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setJoinModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setJoinModalVisible(false)}>
          <Pressable style={styles.modalContent} onPress={() => {}}>
            <Text style={styles.modalTitle}>Join a Group</Text>
            <Text style={styles.modalSubtitle}>Enter the invite code shared by a friend</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Invite code"
              placeholderTextColor={theme.textFaint}
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={8}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalCancel, pressed && styles.actionPressed]}
                onPress={() => { setJoinModalVisible(false); setInviteCode(''); }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalJoin,
                  (!inviteCode.trim() || joining) && styles.modalJoinDisabled,
                  pressed && styles.actionPressed,
                ]}
                onPress={handleJoin}
                disabled={!inviteCode.trim() || joining}
              >
                {joining ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalJoinText}>Join</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionPressed: {
    opacity: 0.7,
  },
  createButton: {
    backgroundColor: theme.accent,
  },
  createButtonText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },
  joinButton: {
    borderWidth: 1,
    borderColor: theme.border,
  },
  joinButtonText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  list: {
    paddingBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Join modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  modalContent: {
    width: '100%',
    backgroundColor: theme.bgCard,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: theme.border,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: theme.bg,
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  modalCancelText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
  },
  modalJoin: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: theme.accent,
  },
  modalJoinDisabled: {
    opacity: 0.5,
  },
  modalJoinText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },
});
