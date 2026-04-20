import { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAuth } from '@/src/providers/AuthProvider';

import { theme } from '@/src/lib/theme';
import { supabase } from '@/src/lib/supabase';
import { getFriends, getPendingRequests } from '@/src/lib/friends';
import { getLists, ensureDefaultList, getDisplayList } from '@/src/lib/lists';
import { getUserShows } from '@/src/lib/watchlist';
import { fetchCast, searchShows } from '@/src/lib/data';
import type { CastMember } from '@/src/lib/data';
import type { UserShow, ShowSummary, ListItem, ListWithItems } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';

type AvatarPickerItem =
  | { kind: 'userShow'; data: UserShow }
  | { kind: 'searchResult'; data: ShowSummary };

export default function ProfileScreen() {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const router = useRouter();

  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [listCount, setListCount] = useState<number | null>(null);
  const [displayList, setDisplayList] = useState<ListWithItems | null>(null);

  const [droppedCount, setDroppedCount] = useState(0);
  const [watchedCount, setWatchedCount] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');

  // Avatar picker state
  const [avatarModalVisible, setAvatarModalVisible] = useState(false);
  const [avatarStep, setAvatarStep] = useState<'shows' | 'cast'>('shows');
  const [myShows, setMyShows] = useState<UserShow[]>([]);
  const [castList, setCastList] = useState<CastMember[]>([]);
  const [selectedShowTitle, setSelectedShowTitle] = useState('');
  const [loadingCast, setLoadingCast] = useState(false);
  const [loadingShows, setLoadingShows] = useState(false);
  const [avatarSearch, setAvatarSearch] = useState('');
  const [avatarSearchResults, setAvatarSearchResults] = useState<ShowSummary[]>([]);
  const [avatarSearching, setAvatarSearching] = useState(false);
  const avatarSearchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      getFriends(user.id).then(f => setFriendCount(f.length)).catch(silentCatch('profile:friends'));
      getPendingRequests(user.id).then(p => setPendingCount(p.length)).catch(silentCatch('profile:pending'));
      ensureDefaultList(user.id).then(() => getLists(user.id).then(l => setListCount(l.length))).catch(silentCatch('profile:lists'));
      getDisplayList(user.id).then(d => setDisplayList(d)).catch(silentCatch('profile:display'));
      getUserShows(user.id).then(s => {
        setDroppedCount(s.filter(sh => sh.status === 'dropped').length);
        setWatchedCount(s.filter(sh => sh.status === 'watched').length);
      }).catch(silentCatch('profile:shows'));
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

  const handleOpenAvatarPicker = async () => {
    if (!user?.id) return;
    setAvatarModalVisible(true);
    setAvatarStep('shows');
    setAvatarSearch('');
    setAvatarSearchResults([]);
    setLoadingShows(true);
    try {
      const shows = await getUserShows(user.id);
      setMyShows(shows);
    } catch {} finally {
      setLoadingShows(false);
    }
  };

  const handleAvatarSearch = useCallback((text: string) => {
    setAvatarSearch(text);
    if (avatarSearchDebounce.current) clearTimeout(avatarSearchDebounce.current);
    if (text.trim().length < 3) {
      setAvatarSearchResults([]);
      setAvatarSearching(false);
      return;
    }
    setAvatarSearching(true);
    avatarSearchDebounce.current = setTimeout(async () => {
      try {
        const results = await searchShows(text);
        setAvatarSearchResults(results);
      } catch { setAvatarSearchResults([]); }
      finally { setAvatarSearching(false); }
    }, 500);
  }, []);

  const handlePickSearchShow = async (show: ShowSummary) => {
    setAvatarStep('cast');
    setSelectedShowTitle(show.title);
    setLoadingCast(true);
    try {
      const cast = await fetchCast(show.id);
      setCastList(cast);
    } catch {
      setCastList([]);
    } finally {
      setLoadingCast(false);
    }
  };

  const handlePickShow = async (show: UserShow) => {
    setAvatarStep('cast');
    setSelectedShowTitle(show.show_title);
    setLoadingCast(true);
    try {
      const cast = await fetchCast(show.show_id);
      setCastList(cast);
    } catch {
      setCastList([]);
    } finally {
      setLoadingCast(false);
    }
  };

  const handlePickCharacter = async (imageUrl: string) => {
    if (!user?.id) return;
    try {
      await supabase
        .from('profiles')
        .update({ avatar_url: imageUrl })
        .eq('id', user.id);
      await refreshProfile();
      setAvatarModalVisible(false);
    } catch {}
  };

  const handleRemoveAvatar = async () => {
    if (!user?.id) return;
    try {
      await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', user.id);
      await refreshProfile();
      setAvatarModalVisible(false);
    } catch {}
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      {/* Profile header — centered */}
      <View style={styles.header}>
        <Pressable onPress={handleOpenAvatarPicker}>
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} contentFit="cover" />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(profile?.display_name || profile?.username || '?')[0].toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.avatarEditBadge}>
            <Text style={styles.avatarEditIcon}>✎</Text>
          </View>
        </Pressable>
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
        <Text style={styles.username}>@{profile?.username || 'unknown'}</Text>
      </View>

      {/* Featured posters — prominent display list */}
      {displayList && displayList.items.length > 0 && (
        <View style={styles.featuredSection}>
          <View style={styles.featuredPosters}>
            {displayList.items.slice(0, 4).map(item => (
              displayList.type === 'shows' ? (
                <Pressable
                  key={item.item_id}
                  style={({ pressed }) => [styles.featuredPosterWrap, pressed && { opacity: 0.7 }]}
                  onPress={() => router.push(`/show/${item.item_id}?from=/(tabs)/profile`)}
                >
                  {item.item_image ? (
                    <Image source={{ uri: item.item_image }} style={styles.featuredPoster} contentFit="cover" />
                  ) : (
                    <View style={[styles.featuredPoster, styles.featuredPosterPlaceholder]}>
                      <Text style={{ fontSize: 16 }}>📺</Text>
                    </View>
                  )}
                </Pressable>
              ) : (
                item.item_image ? (
                  <Image key={item.item_id} source={{ uri: item.item_image }} style={styles.featuredPoster} contentFit="cover" />
                ) : (
                  <View key={item.item_id} style={[styles.featuredPoster, styles.featuredPosterPlaceholder]}>
                    <Text style={{ fontSize: 16 }}>📺</Text>
                  </View>
                )
              )
            ))}
          </View>
        </View>
      )}

      {/* Primary nav */}
      <View style={styles.navGroup}>
        <Pressable
          style={({ pressed }) => [styles.navRowPrimary, pressed && { opacity: 0.7 }]}
          onPress={() => router.push('/(tabs)/friends')}
        >
          <View style={[styles.navIconTile, { backgroundColor: 'rgba(96,165,250,0.15)' }]}>
            <FontAwesome name="users" size={13} color="#60a5fa" />
          </View>
          <Text style={styles.navRowTextPrimary}>Friends</Text>
          {pendingCount > 0 && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{pendingCount}</Text>
            </View>
          )}
          <Text style={styles.navRowCount}>{friendCount ?? 0}</Text>
          <Text style={styles.navChevron}>▸</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.navRowPrimary, pressed && { opacity: 0.7 }]}
          onPress={() => router.push('/(tabs)/lists')}
        >
          <View style={[styles.navIconTile, { backgroundColor: 'rgba(192,132,252,0.15)' }]}>
            <FontAwesome name="bookmark" size={13} color="#c084fc" />
          </View>
          <Text style={styles.navRowTextPrimary}>My Lists</Text>
          <Text style={styles.navRowCount}>{listCount ?? 0}</Text>
          <Text style={styles.navChevron}>▸</Text>
        </Pressable>

        {watchedCount > 0 && (
          <Pressable
            style={({ pressed }) => [styles.navRowPrimary, pressed && { opacity: 0.7 }]}
            onPress={() => router.push('/(tabs)/watched')}
          >
            <View style={[styles.navIconTile, { backgroundColor: 'rgba(74,222,128,0.15)' }]}>
              <FontAwesome name="check" size={13} color={theme.success} />
            </View>
            <Text style={styles.navRowTextPrimary}>Watched Shows</Text>
            <Text style={styles.navRowCount}>{watchedCount}</Text>
            <Text style={styles.navChevron}>▸</Text>
          </Pressable>
        )}
      </View>

      {/* Secondary nav */}
      <View style={styles.navGroup}>
        <Pressable
          style={({ pressed }) => [styles.navRow, pressed && { opacity: 0.7 }]}
          onPress={() => router.push('/(tabs)/settings')}
        >
          <Text style={styles.navRowText}>Settings</Text>
          <Text style={styles.navChevron}>▸</Text>
        </Pressable>

        {droppedCount > 0 && (
          <Pressable
            style={({ pressed }) => [styles.navRow, pressed && { opacity: 0.7 }]}
            onPress={() => router.push('/(tabs)/dropped')}
          >
            <Text style={styles.navRowText}>Dropped Shows</Text>
            <Text style={styles.navRowCount}>{droppedCount}</Text>
            <Text style={styles.navChevron}>▸</Text>
          </Pressable>
        )}
      </View>

      <Pressable style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>

      {/* Avatar Picker Modal */}
      <Modal
        visible={avatarModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAvatarModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            {avatarStep === 'cast' ? (
              <Pressable onPress={() => setAvatarStep('shows')}>
                <Text style={styles.modalBack}>← Shows</Text>
              </Pressable>
            ) : (
              <Text style={styles.modalTitle}>Pick a Character</Text>
            )}
            {avatarStep === 'cast' && (
              <Text style={styles.modalTitle} numberOfLines={1}>{selectedShowTitle}</Text>
            )}
            <Pressable onPress={() => setAvatarModalVisible(false)}>
              <Text style={styles.modalDone}>Cancel</Text>
            </Pressable>
          </View>

          {avatarStep === 'shows' && (
            <>
              {profile?.avatar_url && (
                <Pressable style={styles.removeAvatarRow} onPress={handleRemoveAvatar}>
                  <Text style={styles.removeAvatarText}>Remove current photo</Text>
                </Pressable>
              )}
              <TextInput
                style={styles.avatarSearchInput}
                placeholder="Search any show..."
                placeholderTextColor={theme.textFaint}
                value={avatarSearch}
                onChangeText={handleAvatarSearch}
                autoCorrect={false}
                returnKeyType="search"
              />
              {loadingShows ? (
                <View style={styles.modalCenter}><ActivityIndicator color={theme.accent} size="large" /></View>
              ) : (
                <FlatList<AvatarPickerItem>
                  data={
                    avatarSearch.trim().length >= 3
                      ? avatarSearchResults.map(s => ({ kind: 'searchResult' as const, data: s }))
                      : myShows.map(s => ({ kind: 'userShow' as const, data: s }))
                  }
                  keyExtractor={item => item.kind === 'searchResult' ? item.data.id : item.data.show_id}
                  keyboardShouldPersistTaps="handled"
                  ListHeaderComponent={
                    avatarSearch.trim().length >= 3 ? (
                      avatarSearching ? (
                        <View style={{ padding: 12, alignItems: 'center' }}><ActivityIndicator color={theme.accent} size="small" /></View>
                      ) : avatarSearchResults.length === 0 ? (
                        <Text style={styles.avatarNoResults}>No results</Text>
                      ) : null
                    ) : myShows.length > 0 ? (
                      <Text style={styles.avatarSectionLabel}>From your watchlist</Text>
                    ) : null
                  }
                  renderItem={({ item }) => {
                    const title = item.kind === 'searchResult' ? item.data.title : item.data.show_title;
                    const image = item.kind === 'searchResult' ? item.data.image : item.data.show_image;
                    return (
                      <Pressable
                        style={({ pressed }) => [styles.showRow, pressed && { opacity: 0.7 }]}
                        onPress={() => item.kind === 'searchResult' ? handlePickSearchShow(item.data) : handlePickShow(item.data)}
                      >
                        <View style={styles.showPosterWrap}>
                          {image ? (
                            <Image source={{ uri: image }} style={styles.showPoster} contentFit="cover" />
                          ) : (
                            <View style={[styles.showPoster, styles.showPosterPlaceholder]}>
                              <Text style={{ fontSize: 14 }}>📺</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.showTitle} numberOfLines={1}>{title}</Text>
                        <Text style={styles.showChevron}>▸</Text>
                      </Pressable>
                    );
                  }}
                />
              )}
            </>
          )}

          {avatarStep === 'cast' && (
            loadingCast ? (
              <View style={styles.modalCenter}><ActivityIndicator color={theme.accent} size="large" /></View>
            ) : castList.length === 0 ? (
              <View style={styles.modalCenter}>
                <Text style={styles.modalEmptyText}>No character photos available</Text>
              </View>
            ) : (
              <FlatList
                data={castList}
                keyExtractor={(item, i) => `${item.characterName}-${i}`}
                numColumns={3}
                columnWrapperStyle={styles.castGrid}
                renderItem={({ item }) => (
                  <Pressable
                    style={({ pressed }) => [styles.castItem, pressed && { opacity: 0.7 }]}
                    onPress={() => handlePickCharacter(item.image!)}
                  >
                    <Image source={{ uri: item.image! }} style={styles.castImage} contentFit="cover" />
                    <Text style={styles.castCharacter} numberOfLines={1}>{item.characterName}</Text>
                    <Text style={styles.castActor} numberOfLines={1}>{item.personName}</Text>
                  </Pressable>
                )}
                contentContainerStyle={styles.castList}
              />
            )
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  container: {
    flexGrow: 1,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.bgCard,
    borderWidth: 2,
    borderColor: theme.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: theme.accent,
  },
  avatarText: {
    fontSize: 28,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditIcon: {
    fontSize: 11,
    color: '#fff',
  },
  displayName: {
    fontSize: 20,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    textAlign: 'center',
  },
  editHint: {
    fontSize: 14,
    color: theme.textFaint,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editInput: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 120,
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
  },

  // Featured display list
  featuredSection: {
    marginBottom: 24,
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
  featuredPosterWrap: {
    flex: 1,
    maxWidth: 100,
  },
  featuredPosterPlaceholder: {
    backgroundColor: theme.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Navigation
  navGroup: {
    backgroundColor: theme.bgCard,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  navRowPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  navIconTile: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRowText: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'DMSans_500Medium',
    color: theme.text,
  },
  navRowTextPrimary: {
    flex: 1,
    fontSize: 17,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  navRowCount: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    marginRight: 8,
  },
  navChevron: {
    fontSize: 16,
    color: theme.textFaint,
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
  signOutButton: {
    marginTop: 32,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.3)',
    alignSelf: 'center',
  },
  signOutText: {
    color: '#f87171',
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
  },

  // Avatar Picker Modal
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
    flex: 1,
  },
  modalBack: {
    fontSize: 15,
    fontFamily: 'DMSans_500Medium',
    color: theme.accent,
    marginRight: 12,
  },
  modalDone: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.accent,
  },
  modalCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  avatarSearchInput: {
    backgroundColor: theme.bgCard,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
    marginHorizontal: 16,
    marginVertical: 12,
  },
  avatarSectionLabel: {
    fontSize: 12,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  avatarNoResults: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    textAlign: 'center',
    paddingVertical: 12,
  },
  removeAvatarRow: {
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  removeAvatarText: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: '#f87171',
  },

  // Show list
  showRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  showPosterWrap: {
    width: 36,
    height: 50,
    borderRadius: 4,
    overflow: 'hidden',
  },
  showPoster: {
    width: '100%',
    height: '100%',
  },
  showPosterPlaceholder: {
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  showTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'DMSans_500Medium',
    color: theme.text,
  },
  showChevron: {
    fontSize: 14,
    color: theme.textDim,
  },

  // Cast grid
  castList: {
    padding: 12,
  },
  castGrid: {
    gap: 8,
    marginBottom: 8,
  },
  castItem: {
    width: '31%',
    alignItems: 'center',
    gap: 4,
  },
  castImage: {
    width: '100%',
    aspectRatio: 0.7,
    borderRadius: 8,
  },
  castCharacter: {
    fontSize: 11,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
    textAlign: 'center',
  },
  castActor: {
    fontSize: 10,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    textAlign: 'center',
  },
});
