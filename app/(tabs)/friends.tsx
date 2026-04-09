import { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { theme } from '@/src/lib/theme';
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
import FriendRow from '@/src/components/FriendRow';
import type { FriendAction } from '@/src/components/FriendRow';
import type { FriendWithProfile, UserProfile } from '@/src/lib/types';

interface SearchResult {
  user: UserProfile;
  action: FriendAction;
  friendshipId?: string;
}

export default function FriendsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const refreshBadge = useRefreshBadge();

  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [pending, setPending] = useState<FriendWithProfile[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    try {
      const [f, p] = await Promise.all([
        getFriends(userId),
        getPendingRequests(userId),
      ]);
      setFriends(f);
      setPending(p);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (text.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      if (!userId) return;
      try {
        const users = await searchUsers(text, userId);
        // Get friendship status for each result
        const results: SearchResult[] = await Promise.all(
          users.map(async (u) => {
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
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, [userId]);

  const handleAdd = useCallback(async (friendId: string) => {
    if (!userId) return;
    try {
      await sendFriendRequest(userId, friendId);
      // Update search results optimistically
      setSearchResults(prev =>
        prev.map(r =>
          r.user.id === friendId ? { ...r, action: 'pending' as FriendAction } : r
        )
      );
      fetchData();
    } catch {}
  }, [userId, fetchData]);

  const handleAccept = useCallback(async (friendId: string) => {
    // Find the friendship ID
    const req = pending.find(p => p.user.id === friendId);
    const searchReq = searchResults.find(r => r.user.id === friendId);
    const fid = req?.friendship_id ?? searchReq?.friendshipId;
    if (!fid) return;

    try {
      await acceptFriendRequest(fid);
      fetchData();
      refreshBadge();
      // Update search results
      setSearchResults(prev =>
        prev.map(r =>
          r.user.id === friendId ? { ...r, action: 'friends' as FriendAction } : r
        )
      );
    } catch {}
  }, [pending, searchResults, fetchData]);

  const handleDecline = useCallback(async (friendId: string) => {
    const req = pending.find(p => p.user.id === friendId);
    if (!req) return;
    try {
      await removeFriend(req.friendship_id);
      fetchData();
      refreshBadge();
    } catch {}
  }, [pending, fetchData]);

  const handlePressFriend = useCallback((friendUserId: string) => {
    router.push(`/user/${friendUserId}`);
  }, [router]);

  const isSearching = query.trim().length >= 2;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Friends</Text>
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by username..."
          placeholderTextColor={theme.textFaint}
          value={query}
          onChangeText={handleSearch}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      {loading && !isSearching && (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      )}

      {/* Search results mode */}
      {isSearching && (
        <View style={styles.section}>
          {searching && (
            <View style={styles.center}>
              <ActivityIndicator color={theme.accent} size="small" />
            </View>
          )}
          {!searching && searchResults.length === 0 && (
            <View style={styles.center}>
              <Text style={styles.emptyText}>No users found</Text>
            </View>
          )}
          <FlatList
            data={searchResults}
            keyExtractor={item => item.user.id}
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
      )}

      {/* Normal mode: pending + friends */}
      {!isSearching && !loading && (
        <FlatList
          data={[
            ...(pending.length > 0 ? [{ type: 'header' as const, title: `Requests (${pending.length})` }] : []),
            ...pending.map(p => ({ type: 'pending' as const, data: p })),
            ...(friends.length > 0 ? [{ type: 'header' as const, title: `Friends (${friends.length})` }] : []),
            ...friends.map(f => ({ type: 'friend' as const, data: f })),
          ]}
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
              />
            );
          }}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No friends yet</Text>
              <Text style={styles.emptyText}>Search for people by username to add them</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
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
  section: {
    flex: 1,
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
});
