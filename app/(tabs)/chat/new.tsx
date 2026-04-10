import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Keyboard,
} from 'react-native';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getFriends } from '@/src/lib/friends';
import { getUserShows } from '@/src/lib/watchlist';
import { createConversation } from '@/src/lib/conversations';
import type { FriendWithProfile, UserShow } from '@/src/lib/types';

export default function NewChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [shows, setShows] = useState<UserShow[]>([]);
  const [selectedShow, setSelectedShow] = useState<UserShow | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // Reset state on each visit
      setSelectedFriends(new Set());
      setName('');
      setSelectedShow(null);
      setCreating(false);
      setLoading(true);

      if (!userId) return;
      Promise.all([
        getFriends(userId),
        getUserShows(userId).then(data =>
          data.filter(s => s.status === 'currently_watching' || s.status === 'watched')
        ),
      ])
        .then(([friendData, showData]) => {
          setFriends(friendData);
          setShows(showData);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [userId])
  );

  const toggleFriend = useCallback((friendId: string) => {
    setSelectedFriends(prev => {
      const next = new Set(prev);
      if (next.has(friendId)) next.delete(friendId);
      else next.add(friendId);
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!userId || selectedFriends.size === 0) return;
    setCreating(true);
    try {
      const conversation = await createConversation(userId, {
        name: name.trim() || undefined,
        showId: selectedShow?.show_id,
        showTitle: selectedShow?.show_title,
        showImage: selectedShow?.show_image,
        memberIds: [...selectedFriends],
      });
      router.replace(`/chat/${conversation.id}`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to create chat');
      setCreating(false);
    }
  }, [userId, selectedFriends, name, selectedShow, router]);

  const isGroup = selectedFriends.size > 1;

  const listData = [
    { type: 'friendsHeader' as const },
    ...friends.map(f => ({ type: 'friend' as const, friend: f })),
    ...(selectedFriends.size > 0
      ? [
          { type: 'optionsHeader' as const },
          { type: 'nameInput' as const },
          { type: 'showHeader' as const },
          ...shows.map(s => ({ type: 'show' as const, show: s })),
        ]
      : []),
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'New Chat' }} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      ) : friends.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Add some friends first to start chatting</Text>
        </View>
      ) : (
        <FlatList
          data={listData}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item, index) => {
            if (item.type === 'friend') return `friend-${item.friend.user.id}`;
            if (item.type === 'show') return `show-${item.show.show_id}`;
            return item.type;
          }}
          renderItem={({ item }) => {
            if (item.type === 'friendsHeader') {
              return (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionLabel}>Select Friends</Text>
                  {selectedFriends.size > 0 && (
                    <Text style={styles.sectionCount}>{selectedFriends.size} selected</Text>
                  )}
                </View>
              );
            }

            if (item.type === 'friend') {
              const isSelected = selectedFriends.has(item.friend.user.id);
              const user = item.friend.user;
              return (
                <Pressable
                  style={[styles.friendRow, isSelected && styles.friendRowSelected]}
                  onPress={() => toggleFriend(user.id)}
                >
                  <View style={styles.friendAvatar}>
                    <Text style={styles.friendAvatarText}>
                      {(user.display_name[0] || '?').toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName} numberOfLines={1}>{user.display_name}</Text>
                    <Text style={styles.friendUsername}>@{user.username}</Text>
                  </View>
                  {isSelected && <Text style={styles.checkMark}>✓</Text>}
                </Pressable>
              );
            }

            if (item.type === 'optionsHeader') {
              return (
                <View style={[styles.sectionHeader, { marginTop: 16 }]}>
                  <Text style={styles.sectionLabel}>Options</Text>
                </View>
              );
            }

            if (item.type === 'nameInput') {
              return (
                <View style={styles.nameInputWrap}>
                  <TextInput
                    style={styles.nameInput}
                    placeholder="Name this chat (optional)"
                    placeholderTextColor={theme.textFaint}
                    value={name}
                    onChangeText={setName}
                    maxLength={50}
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                  />
                </View>
              );
            }

            if (item.type === 'showHeader') {
              return (
                <View style={styles.showHeaderSection}>
                  <Text style={styles.showHeaderLabel}>Attach a Show</Text>
                  <Text style={styles.showHeaderHint}>Optional — connect a show for episode tracking</Text>
                </View>
              );
            }

            if (item.type === 'show') {
              const isSelected = selectedShow?.show_id === item.show.show_id;
              return (
                <Pressable
                  style={[styles.showRow, isSelected && styles.showRowSelected]}
                  onPress={() => setSelectedShow(isSelected ? null : item.show)}
                >
                  <View style={styles.posterWrap}>
                    {item.show.show_image ? (
                      <Image source={{ uri: item.show.show_image }} style={styles.poster} contentFit="cover" />
                    ) : (
                      <View style={[styles.poster, styles.posterPlaceholder]}>
                        <Text style={{ fontSize: 14 }}>📺</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.showTitle} numberOfLines={1}>{item.show.show_title}</Text>
                  {isSelected && <Text style={styles.checkMark}>✓</Text>}
                </Pressable>
              );
            }

            return null;
          }}
          contentContainerStyle={styles.list}
        />
      )}

      {selectedFriends.size > 0 && (
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.createButton,
              creating && styles.createButtonDisabled,
              pressed && { opacity: 0.7 },
            ]}
            onPress={handleCreate}
            disabled={creating}
          >
            {creating ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.createButtonText}>
                {isGroup ? 'Create Group Chat' : 'Start Chat'}
              </Text>
            )}
          </Pressable>
        </View>
      )}
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
  emptyText: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    textAlign: 'center',
  },
  list: {
    paddingBottom: 100,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionLabel: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  sectionCount: {
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
    color: theme.accent,
  },

  // Friends
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  friendRowSelected: {
    backgroundColor: 'rgba(255,107,53,0.08)',
  },
  friendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendAvatarText: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
  },
  friendInfo: {
    flex: 1,
    gap: 2,
  },
  friendName: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  friendUsername: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  checkMark: {
    fontSize: 16,
    color: theme.accent,
    fontWeight: '700',
  },

  // Name input
  nameInputWrap: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  nameInput: {
    backgroundColor: theme.bgCard,
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
  },

  // Show picker
  showHeaderSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  showHeaderLabel: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 4,
  },
  showHeaderHint: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },
  showRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  showRowSelected: {
    backgroundColor: 'rgba(255,107,53,0.08)',
  },
  posterWrap: {
    width: 32,
    height: 44,
    borderRadius: 4,
    overflow: 'hidden',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  posterPlaceholder: {
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  showTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: theme.text,
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 36,
    backgroundColor: theme.bg,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  createButton: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'DMSans_600SemiBold',
  },
});
