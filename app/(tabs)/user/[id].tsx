import { useMemo, useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/src/lib/queryKeys';
import {
  View,
  Text,
  SectionList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  LayoutAnimation,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { Image } from 'expo-image';
import { getUserShows } from '@/src/lib/watchlist';
import { getFriendshipStatus, sendFriendRequest, removeFriend } from '@/src/lib/friends';
import { getLists, getDisplayList } from '@/src/lib/lists';
import { supabase } from '@/src/lib/supabase';
import { blockUser } from '@/src/lib/moderation';
import WatchlistCard from '@/src/components/WatchlistCard';
import ReportModal from '@/src/components/ReportModal';
import type { UserShow, UserProfile, WatchStatus, ListWithItems, ListItem } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';

const SECTION_ORDER: { key: WatchStatus; title: string }[] = [
  { key: 'currently_watching', title: 'Currently Watching' },
  { key: 'want_to_watch', title: 'Watchlist' },
  { key: 'watched', title: 'Watched' },
];

const EMPTY_USER_SHOWS: UserShow[] = [];
const EMPTY_LISTS: ListWithItems[] = [];

export default function UserProfileScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'watchlist' | 'lists'>('watchlist');
  const [expandedList, setExpandedList] = useState<string | null>(null);
  const [reportVisible, setReportVisible] = useState(false);

  // Friend's profile is read-only — fetch their data scoped by THEIR id, not
  // the viewer's. Sharing the userShows cache key (qk.userShows.all(id))
  // means if you happened to view your own profile via this route the data
  // would dedupe with your My Shows cache.
  const profileQ = useQuery({
    queryKey: qk.profile(id),
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('*').eq('id', id!).single();
      return data as UserProfile | null;
    },
    enabled: !!id,
  });
  const showsQ = useQuery({
    queryKey: qk.userShows.all(id),
    queryFn: () => getUserShows(id!),
    enabled: !!id,
  });
  const listsQ = useQuery({
    queryKey: qk.lists(id),
    queryFn: () => getLists(id!),
    enabled: !!id,
  });
  const displayListQ = useQuery({
    queryKey: qk.displayList(id),
    queryFn: () => getDisplayList(id!),
    enabled: !!id,
  });
  const friendStatusEnabled = !!userId && !!id && id !== userId;
  const friendStatusQ = useQuery({
    queryKey: ['friendStatus', userId, id] as const,
    queryFn: () => getFriendshipStatus(userId!, id!),
    enabled: friendStatusEnabled,
  });

  const profile = profileQ.data ?? null;
  const shows = showsQ.data ?? EMPTY_USER_SHOWS;
  const friendLists = listsQ.data ?? EMPTY_LISTS;
  const displayList = displayListQ.data ?? null;
  const friendStatus = friendStatusQ.data ?? null;
  const loading = showsQ.isLoading;

  // friendStatus is the only piece of state where local optimistic writes
  // (sendFriendRequest, removeFriend) need to override the cached value.
  // Use queryClient.setQueryData for this.
  const setFriendStatus = useCallback((next: { friendship_id: string; status: string; is_incoming: boolean } | null) => {
    queryClient.setQueryData(['friendStatus', userId, id], next);
  }, [queryClient, userId, id]);

  // Reset local UI state when navigating to a new user.
  useEffect(() => {
    setActiveTab('watchlist');
    setExpandedList(null);
  }, [id]);

  // Default to lists tab if they only have lists and no shows
  useEffect(() => {
    if (!loading && shows.length === 0 && friendLists.filter(l => l.items.length > 0).length > 0) {
      setActiveTab('lists');
    }
  }, [loading, shows.length, friendLists.filter(l => l.items.length > 0).length]);

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

  const handleModerationMenu = useCallback(() => {
    if (!userId || !id || !profile) return;
    Alert.alert(
      profile.display_name,
      undefined,
      [
        { text: 'Report', onPress: () => setReportVisible(true) },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              `Block ${profile.display_name}?`,
              'They won\'t be able to message you or see your profile. Any existing direct message with them will be deleted.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Block',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await blockUser(userId, id);
                      // Redirect to Friends with a signal so the list can optimistically
                      // remove this user before the background refetch finishes.
                      router.replace(`/(tabs)/friends?blocked=${id}`);
                    } catch (e: any) {
                      Alert.alert('Could not block', e.message || 'Please try again.');
                    }
                  },
                },
              ],
            );
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [userId, id, profile, router]);

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
      <View style={styles.topBar}>
        <Pressable style={styles.backButton} onPress={() => router.push('/(tabs)/friends')}>
          <Text style={styles.backText}>‹ Friends</Text>
        </Pressable>
        {userId && id !== userId && (
          <Pressable
            style={({ pressed }) => [styles.menuButton, pressed && { opacity: 0.5 }]}
            onPress={handleModerationMenu}
            hitSlop={10}
          >
            <FontAwesome name="ellipsis-h" size={18} color={theme.textDim} />
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {/* Header — centered */}
          <View style={styles.profileHeader}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} contentFit="cover" />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(profile?.display_name || profile?.username || '?')[0].toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={styles.displayName}>{profile?.display_name || 'Unknown'}</Text>
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
          </View>

          {/* Tab toggle */}
          {friendLists.filter(l => l.items.length > 0).length > 0 && shows.length > 0 && (
            <View style={[styles.tabToggleWrap, (activeTab !== 'lists' || !displayList || displayList.items.length === 0) && styles.tabToggleWrapBorder]}>
              <View style={styles.tabToggle}>
                <Pressable
                  style={[styles.tabToggleBtn, activeTab === 'watchlist' && styles.tabToggleBtnActive]}
                  onPress={() => setActiveTab('watchlist')}
                >
                  <Text style={[styles.tabToggleText, activeTab === 'watchlist' && styles.tabToggleTextActive]}>Watchlist</Text>
                </Pressable>
                <Pressable
                  style={[styles.tabToggleBtn, (activeTab as string) === 'lists' && styles.tabToggleBtnActive]}
                  onPress={() => setActiveTab('lists')}
                >
                  <Text style={[styles.tabToggleText, (activeTab as string) === 'lists' && styles.tabToggleTextActive]}>Lists</Text>
                </Pressable>
              </View>
            </View>
          )}

          {shows.length === 0 && friendLists.filter(l => l.items.length > 0).length === 0 ? (
            <View style={styles.emptyProfile}>
              <Text style={styles.emptyProfileText}>Nothing here yet</Text>
            </View>
          ) : activeTab === 'watchlist' ? (
            sections.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.emptyText}>No shows tracked yet</Text>
              </View>
            ) : (
              sections.map(section => (
                <View key={section.title}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                    <Text style={styles.sectionCount}>{section.data.length}</Text>
                  </View>
                  {section.data.map(item => (
                    <WatchlistCard key={item.show_id} show={profile?.hide_ratings ? { ...item, rating: null } : item} onPress={handleShowPress} readOnly />
                  ))}
                </View>
              ))
            )
          ) : (
            <>
              {/* Display list hero */}
              {displayList && displayList.items.length > 0 && (
                <View style={styles.displayListHero}>
                  <View style={styles.featuredPosters}>
                    {displayList.items.slice(0, 4).map(item => (
                      item.item_image ? (
                        <Image key={item.item_id} source={{ uri: item.item_image }} style={styles.featuredPoster} contentFit="cover" />
                      ) : (
                        <View key={item.item_id} style={[styles.featuredPoster, styles.featuredPosterPlaceholder]}>
                          <Text style={{ fontSize: 16 }}>📺</Text>
                        </View>
                      )
                    ))}
                  </View>
                  <Text style={styles.displayListName}>{displayList.name}</Text>
                </View>
              )}

              {/* Remaining lists */}
              {friendLists.filter(l => l.items.length > 0 && l.id !== displayList?.id).map(list => {
                const isExpanded = expandedList === list.id;
                return (
                  <View key={list.id}>
                    <Pressable
                      style={styles.friendListRow}
                      onPress={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setExpandedList(isExpanded ? null : list.id);
                      }}
                    >
                      <View style={styles.friendListInfo}>
                        <Text style={styles.friendListName}>{list.name}</Text>
                        <Text style={styles.friendListType}>
                          {list.items.length} {list.type === 'shows' ? (list.items.length === 1 ? 'Show' : 'Shows') : (list.items.length === 1 ? 'Character' : 'Characters')}
                        </Text>
                      </View>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.friendListThumbnails}>
                        {list.items.map(item => (
                          item.item_image ? (
                            <Image key={item.item_id} source={{ uri: item.item_image }} style={styles.friendListThumb} contentFit="cover" />
                          ) : (
                            <View key={item.item_id} style={[styles.friendListThumb, styles.friendListThumbPlaceholder]}>
                              <Text style={{ fontSize: 12 }}>📺</Text>
                            </View>
                          )
                        ))}
                      </ScrollView>
                    </Pressable>
                    {isExpanded && (
                      <View style={styles.expandedList}>
                        {list.items.map(item => {
                          const isChar = list.type === 'characters';
                          const [charName, showName] = isChar && item.item_title.includes('::')
                            ? item.item_title.split('::')
                            : [item.item_title, null];
                          return (
                            <Pressable
                              key={item.item_id}
                              style={({ pressed }) => [styles.expandedItem, !isChar && pressed && { opacity: 0.7 }]}
                              onPress={() => {
                                if (!isChar) handleShowPress(item.item_id);
                              }}
                              disabled={isChar}
                            >
                              {item.item_image ? (
                                <Image source={{ uri: item.item_image }} style={styles.expandedItemImage} contentFit="cover" />
                              ) : (
                                <View style={[styles.expandedItemImage, styles.friendListThumbPlaceholder]}>
                                  <Text style={{ fontSize: 14 }}>📺</Text>
                                </View>
                              )}
                              <View style={styles.expandedItemInfo}>
                                <Text style={styles.expandedItemTitle} numberOfLines={1}>{charName}</Text>
                                {showName && <Text style={styles.expandedItemSub} numberOfLines={1}>{showName}</Text>}
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      )}

      {userId && id && profile && (
        <ReportModal
          visible={reportVisible}
          reporterId={userId}
          target={{ userId: id, label: profile.display_name }}
          onClose={() => setReportVisible(false)}
        />
      )}
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menuButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
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
    paddingTop: 12,
    paddingBottom: 16,
    paddingHorizontal: 16,
    gap: 6,
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: theme.bgCard,
    borderWidth: 2,
    borderColor: theme.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: theme.accent,
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
    textAlign: 'center',
  },
  username: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  friendButton: {
    backgroundColor: theme.accent,
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  friendButtonPressed: {
    opacity: 0.7,
  },
  friendButtonText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },
  featuredPosters: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  featuredPoster: {
    flex: 1,
    aspectRatio: 0.67,
    borderRadius: 6,
    maxWidth: 100,
  },
  featuredPosterPlaceholder: {
    backgroundColor: theme.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  displayListHero: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 10,
  },
  displayListName: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
    textAlign: 'center',
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
  emptyProfile: {
    padding: 60,
    alignItems: 'center',
  },
  emptyProfileText: {
    fontSize: 15,
    fontFamily: 'DMSans_500Medium',
    color: theme.textFaint,
  },

  // Toggle
  tabToggleWrap: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  tabToggleWrapBorder: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  tabToggle: {
    flexDirection: 'row',
    backgroundColor: theme.bgCard,
    borderRadius: 8,
    padding: 3,
  },
  tabToggleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  tabToggleBtnActive: {
    backgroundColor: theme.accent,
  },
  tabToggleText: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
  },
  tabToggleTextActive: {
    color: '#fff',
  },

  // Friend lists
  listsContent: {
    paddingTop: 8,
  },
  friendListRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 10,
  },
  friendListInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  friendListName: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  friendListType: {
    fontSize: 11,
    fontFamily: 'DMSans_500Medium',
    color: theme.textFaint,
  },
  friendListThumbnails: {
    flexDirection: 'row',
    gap: 8,
  },
  friendListThumb: {
    width: 50,
    height: 70,
    borderRadius: 4,
  },
  friendListThumbPlaceholder: {
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Expanded list
  expandedList: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  expandedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 12,
  },
  expandedItemImage: {
    width: 44,
    height: 62,
    borderRadius: 4,
  },
  expandedItemInfo: {
    flex: 1,
    gap: 2,
  },
  expandedItemTitle: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  expandedItemSub: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
});
