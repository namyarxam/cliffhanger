import { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/src/lib/queryKeys';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Pressable,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { useRefreshBadge } from './_layout';
import {
  searchUsers,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend,
  getFriends,
  getPendingRequests,
  getFriendshipStatus,
} from '@/src/lib/friends';
import { getBlockedIds } from '@/src/lib/moderation';
import FriendRow from '@/src/components/FriendRow';
import type { FriendAction } from '@/src/components/FriendRow';
import type { FriendWithProfile, UserProfile } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';

interface SearchResult {
  user: UserProfile;
  action: FriendAction;
  friendshipId?: string;
}

const EMPTY_FRIENDS: FriendWithProfile[] = [];
const EMPTY_PENDING: FriendWithProfile[] = [];

export default function FriendsScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { blocked: blockedParam } = useLocalSearchParams<{ blocked?: string }>();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const refreshBadge = useRefreshBadge();

  const queryClient = useQueryClient();
  const friendsQuery = useQuery({
    queryKey: qk.friends(userId),
    queryFn: () => getFriends(userId!),
    enabled: !!userId,
  });
  const pendingQuery = useQuery({
    queryKey: qk.pendingRequests(userId),
    queryFn: () => getPendingRequests(userId!),
    enabled: !!userId,
  });
  const friends = friendsQuery.data ?? EMPTY_FRIENDS;
  const pending = pendingQuery.data ?? EMPTY_PENDING;
  const loading = friendsQuery.isLoading || pendingQuery.isLoading;

  const [filterQuery, setFilterQuery] = useState('');

  // Add friend modal state
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<SearchResult[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const addDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      // If we arrived here via a "user just blocked someone" redirect,
      // optimistically remove them from the cache so they don't flash before
      // the refetch returns.
      if (blockedParam) {
        queryClient.setQueryData<FriendWithProfile[]>(
          qk.friends(userId),
          prev => (prev ?? EMPTY_FRIENDS).filter(f => f.user.id !== blockedParam),
        );
        queryClient.setQueryData<FriendWithProfile[]>(
          qk.pendingRequests(userId),
          prev => (prev ?? EMPTY_PENDING).filter(p => p.user.id !== blockedParam),
        );
        router.setParams({ blocked: undefined });
      }
      queryClient.invalidateQueries({ queryKey: qk.friends(userId) });
      queryClient.invalidateQueries({ queryKey: qk.pendingRequests(userId) });
    }, [userId, queryClient, blockedParam, router])
  );

  // ── Filter friends list ─────────────────────────────────────────────────────
  const filteredFriends = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(f =>
      f.user.display_name.toLowerCase().includes(q) ||
      f.user.username.toLowerCase().includes(q)
    );
  }, [friends, filterQuery]);

  // ── Add friend modal search ─────────────────────────────────────────────────
  const handleAddSearch = useCallback((text: string) => {
    setAddQuery(text);
    if (addDebounceRef.current) clearTimeout(addDebounceRef.current);

    if (text.trim().length < 2) {
      setAddResults([]);
      setAddSearching(false);
      return;
    }

    setAddSearching(true);
    addDebounceRef.current = setTimeout(async () => {
      if (!userId) return;
      try {
        const [users, blockedIds] = await Promise.all([
          searchUsers(text, userId),
          getBlockedIds(userId),
        ]);
        const notBlocked = users.filter(u => !blockedIds.has(u.id));
        const results: SearchResult[] = await Promise.all(
          notBlocked.map(async (u) => {
            const fs = await getFriendshipStatus(userId, u.id);
            let action: FriendAction = 'add';
            let friendshipId: string | undefined;
            if (fs) {
              friendshipId = fs.friendship_id;
              if (fs.status === 'accepted') action = 'friends';
              else if (fs.is_incoming) action = 'accept';
              else action = 'pending';
            }
            return { user: u, action, friendshipId };
          })
        );
        setAddResults(results);
      } catch {
        setAddResults([]);
      } finally {
        setAddSearching(false);
      }
    }, 400);
  }, [userId]);

  const handleOpenAddModal = useCallback(() => {
    setAddQuery('');
    setAddResults([]);
    setAddModalVisible(true);
  }, []);

  const invalidateFriends = useCallback(() => {
    if (!userId) return;
    queryClient.invalidateQueries({ queryKey: qk.friends(userId) });
    queryClient.invalidateQueries({ queryKey: qk.pendingRequests(userId) });
    queryClient.invalidateQueries({ queryKey: qk.pendingRequestCount(userId) });
  }, [userId, queryClient]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  // Pattern across all three handlers: flip the row's action label in
  // local state BEFORE the network call so the button feels instant. On
  // failure, revert to the prior label so we don't lie about persisted
  // state. Cache invalidations fire after the await so the friends list
  // refreshes once the server confirms.
  const setRowAction = useCallback((friendId: string, action: FriendAction) => {
    setAddResults(prev =>
      prev.map(r => r.user.id === friendId ? { ...r, action } : r),
    );
  }, []);

  const handleAdd = useCallback(async (friendId: string) => {
    if (!userId) return;
    const prev = addResults.find(r => r.user.id === friendId)?.action;
    setRowAction(friendId, 'pending');
    try {
      await sendFriendRequest(userId, friendId);
      invalidateFriends();
    } catch (e) {
      if (prev) setRowAction(friendId, prev);
      silentCatch('friends:add')(e);
    }
  }, [userId, addResults, setRowAction, invalidateFriends]);

  const handleAccept = useCallback(async (friendId: string) => {
    const req = pending.find(p => p.user.id === friendId);
    const searchReq = addResults.find(r => r.user.id === friendId);
    const fid = req?.friendship_id ?? searchReq?.friendshipId;
    if (!fid) return;

    const prev = searchReq?.action;
    setRowAction(friendId, 'friends');
    try {
      await acceptFriendRequest(fid);
      invalidateFriends();
      refreshBadge();
    } catch (e) {
      if (prev) setRowAction(friendId, prev);
      silentCatch('friends:accept')(e);
    }
  }, [pending, addResults, setRowAction, invalidateFriends, refreshBadge]);

  const handleDecline = useCallback(async (friendId: string) => {
    const req = pending.find(p => p.user.id === friendId);
    if (!req) return;
    try {
      await removeFriend(req.friendship_id);
      invalidateFriends();
      refreshBadge();
    } catch (e) { silentCatch('friends:decline')(e); }
  }, [pending, invalidateFriends, refreshBadge]);

  const handlePressFriend = useCallback((friendUserId: string) => {
    router.push(`/user/${friendUserId}`);
  }, [router]);

  const handleRemoveFriend = useCallback((friendUserId: string) => {
    const friend = friends.find(f => f.user.id === friendUserId);
    if (!friend) return;
    Alert.alert(
      'Remove Friend',
      `Remove ${friend.user.display_name} as a friend?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeFriend(friend.friendship_id);
              invalidateFriends();
              refreshBadge();
            } catch (e) { silentCatch('friends:remove')(e); }
          },
        },
      ],
    );
  }, [friends, invalidateFriends, refreshBadge]);

  // ── Build list data ─────────────────────────────────────────────────────────
  const listData = useMemo(() => {
    const items: ({ type: 'header'; title: string } | { type: 'pending'; data: FriendWithProfile } | { type: 'friend'; data: FriendWithProfile })[] = [];

    if (pending.length > 0 && !filterQuery.trim()) {
      items.push({ type: 'header', title: `Requests (${pending.length})` });
      for (const p of pending) items.push({ type: 'pending', data: p });
    }

    if (filteredFriends.length > 0) {
      items.push({ type: 'header', title: `Friends (${friends.length})` });
      for (const f of filteredFriends) items.push({ type: 'friend', data: f });
    }

    return items;
  }, [pending, filteredFriends, friends.length, filterQuery]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Friends</Text>
        <Pressable
          style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.7 }]}
          onPress={handleOpenAddModal}
        >
          <Text style={styles.addButtonText}>+ Add</Text>
        </Pressable>
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Filter friends..."
          placeholderTextColor={theme.textFaint}
          value={filterQuery}
          onChangeText={setFilterQuery}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item, i) => 'data' in item ? item.data.user.id : `header-${i}`}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{item.title}</Text>
                </View>
              );
            }
            if (item.type === 'pending') {
              return (
                <FriendRow
                  user={item.data.user}
                  action="accept"
                  onAction={handleAccept}
                  onDecline={handleDecline}
                />
              );
            }
            return (
              <FriendRow
                user={item.data.user}
                action="none"
                onPress={handlePressFriend}
                onLongPress={handleRemoveFriend}
              />
            );
          }}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            filterQuery.trim() ? (
              <View style={styles.center}>
                <Text style={styles.emptyText}>No friends match "{filterQuery}"</Text>
              </View>
            ) : (
              <View style={styles.center}>
                <Text style={styles.emptyTitle}>No friends yet</Text>
                <Text style={styles.emptyText}>Tap "+ Add" to find people by username</Text>
              </View>
            )
          }
        />
      )}

      {/* Add Friend Modal */}
      <Modal
        visible={addModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAddModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Friend</Text>
            <Pressable onPress={() => setAddModalVisible(false)}>
              <Text style={styles.modalDone}>Done</Text>
            </Pressable>
          </View>

          <View style={styles.modalSearchBar}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search by username..."
              placeholderTextColor={theme.textFaint}
              value={addQuery}
              onChangeText={handleAddSearch}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              clearButtonMode="while-editing"
              returnKeyType="search"
            />
          </View>

          {addSearching && (
            <View style={styles.center}>
              <ActivityIndicator color={theme.accent} size="small" />
            </View>
          )}

          {!addSearching && addQuery.trim().length >= 2 && addResults.length === 0 && (
            <View style={styles.center}>
              <Text style={styles.emptyText}>No users found</Text>
            </View>
          )}

          {addQuery.trim().length < 2 && (
            <View style={styles.center}>
              <Text style={styles.emptyText}>Search for people by username</Text>
            </View>
          )}

          <FlatList
            data={addResults}
            keyExtractor={item => item.user.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <FriendRow
                user={item.user}
                action={item.action}
                onPress={item.action === 'friends' ? handlePressFriend : undefined}
                onAction={
                  item.action === 'add' ? handleAdd :
                  item.action === 'accept' ? handleAccept :
                  undefined
                }
                onDecline={item.action === 'accept' ? handleDecline : undefined}
              />
            )}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  addButton: {
    backgroundColor: theme.accent,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  addButtonText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },
  searchBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  searchInput: {
    backgroundColor: theme.bgCard,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
    backgroundColor: theme.bg,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  list: {
    paddingBottom: 20,
  },
  center: {
    padding: 32,
    alignItems: 'center',
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
  },

  // Add Friend Modal
  modalContainer: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  modalDone: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.accent,
  },
  modalSearchBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
