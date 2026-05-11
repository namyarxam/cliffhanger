import { useMemo, useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/src/lib/queryKeys';
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
import { useRouter, useFocusEffect } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getFriends } from '@/src/lib/friends';
import { getUserShows } from '@/src/lib/watchlist';
import { createConversation } from '@/src/lib/conversations';
import type { FriendWithProfile, UserShow } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';

type Step = 'friends' | 'options';

export default function NewChatScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('friends');
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [selectedShow, setSelectedShow] = useState<UserShow | null>(null);
  const [creating, setCreating] = useState(false);

  const friendsQ = useQuery({
    queryKey: qk.friends(userId),
    queryFn: () => getFriends(userId!),
    enabled: !!userId,
  });
  const userShowsQ = useQuery({
    queryKey: qk.userShows.all(userId),
    queryFn: () => getUserShows(userId!),
    enabled: !!userId,
  });
  const friends: FriendWithProfile[] = friendsQ.data ?? [];
  const shows = useMemo(
    () => (userShowsQ.data ?? []).filter(s => s.status === 'currently_watching' || s.status === 'watched'),
    [userShowsQ.data],
  );
  const loading = friendsQ.isLoading || userShowsQ.isLoading;

  useEffect(() => {
    if (friendsQ.error) silentCatch('newChat:friends')(friendsQ.error);
    if (userShowsQ.error) silentCatch('newChat:userShows')(userShowsQ.error);
  }, [friendsQ.error, userShowsQ.error]);

  useFocusEffect(
    useCallback(() => {
      // Reset transient state on each visit
      setStep('friends');
      setSelectedFriends(new Set());
      setName('');
      setSelectedShow(null);
      setCreating(false);
      if (!userId) return;
      queryClient.invalidateQueries({ queryKey: qk.friends(userId) });
      queryClient.invalidateQueries({ queryKey: qk.userShows.all(userId) });
    }, [userId, queryClient])
  );

  const toggleFriend = useCallback((friendId: string) => {
    setSelectedFriends(prev => {
      const next = new Set(prev);
      if (next.has(friendId)) next.delete(friendId);
      else next.add(friendId);
      return next;
    });
  }, []);

  const handleBack = useCallback(() => {
    if (step === 'options') setStep('friends');
    else router.back();
  }, [step, router]);

  const handleContinue = useCallback(() => {
    Keyboard.dismiss();
    setStep('options');
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
  const selectedFriendNames = useMemo(() => {
    const names: string[] = [];
    for (const f of friends) {
      if (selectedFriends.has(f.user.id)) names.push(f.user.display_name);
    }
    return names;
  }, [friends, selectedFriends]);

  const headerTitle = step === 'friends' ? 'New Chat' : 'Chat Details';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Custom header — Stack header is hidden for this route so we own back nav. */}
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.headerBack, pressed && { opacity: 0.5 }]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={handleBack}
        >
          <FontAwesome name="chevron-left" size={20} color={theme.textDim} />
        </Pressable>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        {/* Step indicator on the right */}
        <View style={styles.headerStep}>
          <Text style={styles.headerStepText}>{step === 'friends' ? '1 / 2' : '2 / 2'}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      ) : friends.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Add some friends first to start chatting</Text>
        </View>
      ) : step === 'friends' ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Select Friends</Text>
            {selectedFriends.size > 0 && (
              <Text style={styles.sectionCount}>{selectedFriends.size} selected</Text>
            )}
          </View>
          <FlatList
            data={friends}
            keyboardShouldPersistTaps="handled"
            keyExtractor={item => item.user.id}
            renderItem={({ item }) => {
              const isSelected = selectedFriends.has(item.user.id);
              const user = item.user;
              return (
                <Pressable
                  style={[styles.friendRow, isSelected && styles.friendRowSelected]}
                  onPress={() => toggleFriend(user.id)}
                >
                  {user.avatar_url ? (
                    <Image source={{ uri: user.avatar_url }} style={styles.friendAvatarImage} contentFit="cover" />
                  ) : (
                    <View style={styles.friendAvatar}>
                      <Text style={styles.friendAvatarText}>
                        {(user.display_name[0] || '?').toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName} numberOfLines={1}>{user.display_name}</Text>
                    <Text style={styles.friendUsername}>@{user.username}</Text>
                  </View>
                  {isSelected && <Text style={styles.checkMark}>✓</Text>}
                </Pressable>
              );
            }}
            contentContainerStyle={styles.list}
          />
        </>
      ) : (
        <FlatList
          data={shows}
          keyboardShouldPersistTaps="handled"
          keyExtractor={item => item.show_id}
          ListHeaderComponent={
            <>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>{isGroup ? 'Members' : 'Chatting with'}</Text>
                <Text style={styles.summaryNames} numberOfLines={2}>
                  {selectedFriendNames.join(', ')}
                </Text>
                <Pressable onPress={() => setStep('friends')} hitSlop={{ top: 8, bottom: 8 }}>
                  <Text style={styles.summaryEdit}>Edit</Text>
                </Pressable>
              </View>

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>Name (Optional)</Text>
              </View>
              <View style={styles.nameInputWrap}>
                <TextInput
                  style={styles.nameInput}
                  placeholder="Name this chat"
                  placeholderTextColor={theme.textFaint}
                  value={name}
                  onChangeText={setName}
                  maxLength={50}
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
              </View>

              <View style={styles.showHeaderSection}>
                <Text style={styles.showHeaderLabel}>Attach a Show (Optional)</Text>
                <Text style={styles.showHeaderHint}>Connect a show for episode tracking + spoiler lock</Text>
              </View>
            </>
          }
          renderItem={({ item }) => {
            const isSelected = selectedShow?.show_id === item.show_id;
            return (
              <Pressable
                style={[styles.showRow, isSelected && styles.showRowSelected]}
                onPress={() => setSelectedShow(isSelected ? null : item)}
              >
                <View style={styles.posterWrap}>
                  {item.show_image ? (
                    <Image source={{ uri: item.show_image }} style={styles.poster} contentFit="cover" />
                  ) : (
                    <View style={[styles.poster, styles.posterPlaceholder]}>
                      <Text style={{ fontSize: 14 }}>📺</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.showTitle} numberOfLines={1}>{item.show_title}</Text>
                {isSelected && <Text style={styles.checkMark}>✓</Text>}
              </Pressable>
            );
          }}
          contentContainerStyle={styles.list}
        />
      )}

      {/* Footer — Continue (step 1) / Create (step 2) */}
      {!loading && friends.length > 0 && (
        <View style={styles.footer}>
          {step === 'friends' ? (
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                selectedFriends.size === 0 && styles.primaryButtonDisabled,
                pressed && { opacity: 0.7 },
              ]}
              onPress={handleContinue}
              disabled={selectedFriends.size === 0}
            >
              <Text style={styles.primaryButtonText}>
                Continue{selectedFriends.size > 0 ? ` (${selectedFriends.size})` : ''}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                creating && styles.primaryButtonDisabled,
                pressed && { opacity: 0.7 },
              ]}
              onPress={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {isGroup ? 'Create Group Chat' : 'Start Chat'}
                </Text>
              )}
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
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

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 12,
  },
  headerBack: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  headerStep: {
    backgroundColor: theme.bgCard,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  headerStepText: {
    fontSize: 11,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
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
  friendAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
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

  // Step 2 — selected friends summary
  summaryCard: {
    margin: 16,
    padding: 14,
    borderRadius: 10,
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 4,
  },
  summaryLabel: {
    fontSize: 11,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryNames: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: theme.text,
    marginBottom: 4,
  },
  summaryEdit: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.accent,
    alignSelf: 'flex-start',
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
  primaryButton: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'DMSans_600SemiBold',
  },
});
