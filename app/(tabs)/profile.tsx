import { useState, useCallback } from 'react';
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
import { useAuth } from '@/src/providers/AuthProvider';

import { theme } from '@/src/lib/theme';
import { supabase } from '@/src/lib/supabase';
import { getFriends, getPendingRequests } from '@/src/lib/friends';
import { getTopShows } from '@/src/lib/topshows';
import { getUserShows } from '@/src/lib/watchlist';
import { fetchCast } from '@/src/lib/data';
import type { CastMember } from '@/src/lib/data';
import TopShowsRow from '@/src/components/TopShowsRow';
import type { TopShow, UserShow } from '@/src/lib/types';

export default function ProfileScreen() {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const router = useRouter();

  const [friendCount, setFriendCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [topShows, setTopShows] = useState<TopShow[]>([]);

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

  const handleOpenAvatarPicker = async () => {
    if (!user?.id) return;
    setAvatarModalVisible(true);
    setAvatarStep('shows');
    setLoadingShows(true);
    try {
      const shows = await getUserShows(user.id);
      setMyShows(shows);
    } catch {} finally {
      setLoadingShows(false);
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
      {/* Profile header */}
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
        <View style={styles.headerInfo}>
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
          <Text style={styles.email}>{user?.email}</Text>
        </View>
      </View>

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
              {loadingShows ? (
                <View style={styles.modalCenter}><ActivityIndicator color={theme.accent} size="large" /></View>
              ) : (
                <FlatList
                  data={myShows}
                  keyExtractor={item => item.show_id}
                  renderItem={({ item }) => (
                    <Pressable
                      style={({ pressed }) => [styles.showRow, pressed && { opacity: 0.7 }]}
                      onPress={() => handlePickShow(item)}
                    >
                      <View style={styles.showPosterWrap}>
                        {item.show_image ? (
                          <Image source={{ uri: item.show_image }} style={styles.showPoster} contentFit="cover" />
                        ) : (
                          <View style={[styles.showPoster, styles.showPosterPlaceholder]}>
                            <Text style={{ fontSize: 14 }}>📺</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.showTitle} numberOfLines={1}>{item.show_title}</Text>
                      <Text style={styles.showChevron}>▸</Text>
                    </Pressable>
                  )}
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
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 24,
  },
  avatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: theme.bgCard,
    borderWidth: 2,
    borderColor: theme.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 70,
    height: 70,
    borderRadius: 35,
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
  headerInfo: {
    gap: 2,
  },
  displayName: {
    fontSize: 20,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  editHint: {
    fontSize: 14,
    color: theme.textFaint,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
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
  email: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
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
    flex: 1,
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
