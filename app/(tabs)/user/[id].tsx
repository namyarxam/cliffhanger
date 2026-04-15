import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  LayoutAnimation,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { Image } from 'expo-image';
import { getUserShows } from '@/src/lib/watchlist';
import { getFriendshipStatus, sendFriendRequest, removeFriend } from '@/src/lib/friends';
import { getLists, getDisplayList } from '@/src/lib/lists';
import { supabase } from '@/src/lib/supabase';
import WatchlistCard from '@/src/components/WatchlistCard';
import type { UserShow, UserProfile, WatchStatus, ListWithItems, ListItem } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';

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
  const [friendLists, setFriendLists] = useState<ListWithItems[]>([]);
  const [displayList, setDisplayList] = useState<ListWithItems | null>(null);
  const [activeTab, setActiveTab] = useState<'watchlist' | 'lists'>('watchlist');
  const [expandedList, setExpandedList] = useState<string | null>(null);
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
    setFriendLists([]);
    setDisplayList(null);
    setActiveTab('watchlist');
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

    // Fetch their lists
    getLists(id).then(setFriendLists).catch(silentCatch('userProfile:lists'));
    getDisplayList(id).then(d => setDisplayList(d)).catch(silentCatch('userProfile:display'));

    // Fetch their shows
    getUserShows(id)
      .then(setShows)
      .catch(silentCatch('userProfile:shows'))
      .finally(() => setLoading(false));

    // Fetch friendship status
    if (userId && id !== userId) {
      getFriendshipStatus(userId, id).then(setFriendStatus).catch(silentCatch('userProfile:friendship'));
    }
  }, [id, userId]);

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
      <Pressable style={styles.backButton} onPress={() => router.push('/(tabs)/friends')}>
        <Text style={styles.backText}>‹ Friends</Text>
      </Pressable>

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
                    <WatchlistCard key={item.show_id} show={item} onPress={handleShowPress} />
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
