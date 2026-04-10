import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  SafeAreaView,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getUserShows } from '@/src/lib/watchlist';
import { getFriendshipStatus, sendFriendRequest, removeFriend } from '@/src/lib/friends';
import { getTopShows } from '@/src/lib/topshows';
import { supabase } from '@/src/lib/supabase';
import TopShowsRow from '@/src/components/TopShowsRow';
import WatchlistCard from '@/src/components/WatchlistCard';
import type { UserShow, UserProfile, WatchStatus, TopShow } from '@/src/lib/types';

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
  const [topShows, setTopShows] = useState<TopShow[]>([]);
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
    setTopShows([]);
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

    // Fetch their top shows
    getTopShows(id).then(setTopShows).catch(() => {});

    // Fetch their shows
    getUserShows(id)
      .then(setShows)
      .catch(() => {})
      .finally(() => setLoading(false));

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
    router.push(`/show/${showId}?from=/user/${id}`);
  }, [router, id]);

  const sections = SECTION_ORDER
    .map(({ key, title }) => {
      let data = shows.filter(s => s.status === key);
      if (key === 'watched') {
        data = [...data].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      }
      return { title, data };
    })
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

      {/* Back header */}
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backText}>‹ Back</Text>
      </Pressable>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.show_id}
          renderItem={({ item }) => (
            <WatchlistCard show={item} onPress={handleShowPress} />
          )}
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

              {userId && id !== userId && friendStatus?.status !== 'accepted' && (
                <Pressable
                  style={({ pressed }) => [styles.friendButton, pressed && styles.friendButtonPressed]}
                  onPress={handleFriendAction}
                  disabled={friendStatus?.status === 'pending' && !friendStatus.is_incoming}
                >
                  <Text style={styles.friendButtonText}>{friendButtonText}</Text>
                </Pressable>
              )}

              <TopShowsRow
                shows={topShows}
                onPress={handleShowPress}
              />
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
  backButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backText: {
    fontSize: 17,
    fontFamily: 'DMSans_500Medium',
    color: theme.accent,
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
  friendIndicator: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    marginBottom: 4,
  },
  friendButton: {
    backgroundColor: theme.accent,
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 8,
  },
  friendButtonPressed: {
    opacity: 0.7,
  },
  friendButtonText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
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
});
