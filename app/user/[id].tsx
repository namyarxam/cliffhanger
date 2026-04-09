import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getUserShows } from '@/src/lib/watchlist';
import { getFriendshipStatus, sendFriendRequest, removeFriend } from '@/src/lib/friends';
import { createGroup } from '@/src/lib/groups';
import { supabase } from '@/src/lib/supabase';
import WatchlistCard from '@/src/components/WatchlistCard';
import type { UserShow, UserProfile, WatchStatus } from '@/src/lib/types';

const SECTION_ORDER: { key: WatchStatus; title: string }[] = [
  { key: 'currently_watching', title: 'Currently Watching' },
  { key: 'want_to_watch', title: 'Want to Watch' },
  { key: 'watched', title: 'Watched' },
];

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [shows, setShows] = useState<UserShow[]>([]);
  const [myShowIds, setMyShowIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [friendStatus, setFriendStatus] = useState<{
    friendship_id: string;
    status: string;
    is_incoming: boolean;
  } | null>(null);

  useEffect(() => {
    if (!id) return;

    setProfile(null);
    setShows([]);
    setMyShowIds(new Set());
    setLoading(true);

    // Fetch profile
    supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        if (data) setProfile(data);
      });

    // Fetch their shows
    getUserShows(id)
      .then(setShows)
      .catch(() => {})
      .finally(() => setLoading(false));

    // Fetch my shows to find overlap
    if (userId) {
      getUserShows(userId)
        .then(mine => setMyShowIds(new Set(mine.map(s => s.show_id))))
        .catch(() => {});
    }

    // Fetch friendship status
    if (userId && id !== userId) {
      getFriendshipStatus(userId, id).then(setFriendStatus).catch(() => {});
    }
  }, [id, userId]);

  const handleFriendAction = useCallback(async () => {
    if (!userId || !id) return;

    if (!friendStatus) {
      await sendFriendRequest(userId, id);
      setFriendStatus({ friendship_id: '', status: 'pending', is_incoming: false });
    } else if (friendStatus.status === 'accepted') {
      await removeFriend(friendStatus.friendship_id);
      setFriendStatus(null);
    }
  }, [userId, id, friendStatus]);

  const handleShowPress = useCallback((showId: string) => {
    router.push(`/show/${showId}`);
  }, [router]);

  const handleCreateGroup = useCallback(async (show: UserShow) => {
    if (!userId || !id || !profile) return;

    Alert.alert(
      'Create Group',
      `Start a group for "${show.show_title}" with ${profile.display_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          onPress: async () => {
            try {
              const group = await createGroup(
                userId,
                `${show.show_title}`,
                show.show_id,
                show.show_title,
                show.show_image,
              );
              // Add the other person to the group
              await supabase
                .from('group_members')
                .insert({ group_id: group.id, user_id: id });

              router.push(`/group/${group.id}`);
            } catch {
              Alert.alert('Error', 'Failed to create group');
            }
          },
        },
      ],
    );
  }, [userId, id, profile, router]);

  const sections = SECTION_ORDER
    .map(({ key, title }) => ({
      title,
      data: shows.filter(s => s.status === key),
    }))
    .filter(s => s.data.length > 0);

  const friendButtonText = !friendStatus
    ? 'Add Friend'
    : friendStatus.status === 'pending'
      ? friendStatus.is_incoming ? 'Accept' : 'Pending'
      : 'Friends';

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{
        title: profile?.display_name || '',
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerTitleStyle: { fontFamily: 'DMSans_700Bold', fontSize: 17 },
        headerShadowVisible: false,
      }} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.show_id}
          renderItem={({ item }) => {
            const isShared = myShowIds.has(item.show_id);
            return (
              <View style={styles.showRow}>
                <View style={styles.showRowCard}>
                  <WatchlistCard show={item} onPress={handleShowPress} />
                </View>
                {isShared && (
                  <Pressable
                    style={({ pressed }) => [styles.groupButton, pressed && { opacity: 0.6 }]}
                    onPress={() => handleCreateGroup(item)}
                  >
                    <FontAwesome name="users" size={12} color="#fff" />
                    <Text style={styles.groupButtonPlus}>+</Text>
                  </Pressable>
                )}
              </View>
            );
          }}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.length}</Text>
            </View>
          )}
          ListHeaderComponent={
            <View style={styles.profileHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(profile?.display_name || profile?.username || '?')[0].toUpperCase()}
                </Text>
              </View>
              <Text style={styles.displayName}>
                {profile?.display_name || 'Unknown'}
              </Text>
              <Text style={styles.username}>@{profile?.username || 'unknown'}</Text>

              {userId && id !== userId && (
                <Pressable
                  style={({ pressed }) => [
                    styles.friendButton,
                    friendStatus?.status === 'accepted' && styles.friendButtonActive,
                    pressed && styles.friendButtonPressed,
                  ]}
                  onPress={handleFriendAction}
                  disabled={friendStatus?.status === 'pending' && !friendStatus.is_incoming}
                >
                  <Text style={[
                    styles.friendButtonText,
                    friendStatus?.status === 'accepted' && styles.friendButtonTextActive,
                  ]}>
                    {friendButtonText}
                  </Text>
                </Pressable>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No shows tracked yet</Text>
            </View>
          }
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
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
  center: {
    padding: 32,
    alignItems: 'center',
  },
  list: {
    paddingBottom: 20,
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 32,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.bgCard,
    borderWidth: 2,
    borderColor: theme.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 24,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
  },
  displayName: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 2,
  },
  username: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    marginBottom: 16,
  },
  friendButton: {
    backgroundColor: theme.accent,
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 8,
  },
  friendButtonActive: {
    backgroundColor: 'rgba(74,222,128,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.2)',
  },
  friendButtonPressed: {
    opacity: 0.7,
  },
  friendButtonText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },
  friendButtonTextActive: {
    color: 'rgba(74,222,128,0.7)',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
    backgroundColor: theme.bg,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  sectionCount: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  showRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  showRowCard: {
    flex: 1,
  },
  groupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(96,165,250,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.3)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 16,
    gap: 2,
  },
  groupButtonPlus: {
    fontSize: 12,
    fontFamily: 'DMSans_700Bold',
    color: '#fff',
  },
});
