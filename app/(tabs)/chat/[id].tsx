import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Keyboard,
  Modal,
  Animated,
  PanResponder,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';

import { useAuth } from '@/src/providers/AuthProvider';
import { supabase } from '@/src/lib/supabase';
import {
  getConversationDetail,
  getConversationMembers,
  getMessages,
  sendMessage,
  getFrontRunner,
  isCaughtUp,
  leaveConversation,
  toggleSpoilerLock,
  getFriendsNotInConversation,
  sendConversationInvite,
  getConversationDisplayName,
  renameConversation,
  attachShow,
  detachShow,
} from '@/src/lib/conversations';
import { getUserShows } from '@/src/lib/watchlist';
import FriendRow from '@/src/components/FriendRow';
import GifPicker from '@/src/components/GifPicker';
import type { Conversation, ConversationMember, Message, UserProfile, UserShow } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';

function formatChatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString();
  const msgDay = d.toDateString();
  if (msgDay === today) return 'Today';
  if (msgDay === yesterday) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ChatDetailScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [members, setMembers] = useState<ConversationMember[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const memberProfileMap = useRef(new Map<string, { name: string; avatar: string | null }>());

  // Modal state
  const [gifPickerVisible, setGifPickerVisible] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [showPickerVisible, setShowPickerVisible] = useState(false);
  const [invitableFriends, setInvitableFriends] = useState<{ user: UserProfile; alreadyInvited: boolean }[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [editName, setEditName] = useState('');
  const [userShows, setUserShows] = useState<UserShow[]>([]);
  const [loadingShows, setLoadingShows] = useState(false);

  // iMessage-style swipe: whole list shifts left, timestamps revealed on right
  const dragX = useRef(new Animated.Value(0)).current;
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dx < -5 && Math.abs(g.dy) < Math.abs(g.dx),
    onPanResponderMove: (_, g) => {
      if (g.dx < 0) dragX.setValue(Math.max(g.dx * 0.15, -23));
    },
    onPanResponderRelease: () => {
      Animated.spring(dragX, { toValue: 0, useNativeDriver: false, tension: 80, friction: 12 }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(dragX, { toValue: 0, useNativeDriver: false, tension: 80, friction: 12 }).start();
    },
  }), [dragX]);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const c = await getConversationDetail(id);
      setConversation(c);

      const [m, msgs] = await Promise.all([
        getConversationMembers(id, c.show_id),
        getMessages(id).catch(() => [] as Message[]),
      ]);
      setMembers(m);
      setMessages(msgs);

      for (const member of m) {
        memberProfileMap.current.set(member.user_id, {
          name: member.display_name,
          avatar: member.avatar_url,
        });
      }
    } catch (e) {
      console.error('Chat fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setConversation(null);
    setMembers([]);
    setMessages([]);
    setLoading(true);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardWillShow', () => setShowMembers(false));
    return () => sub.remove();
  }, []);

  // Realtime via Broadcast
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`chat-${id}`)
      .on('broadcast', { event: 'new_message' }, (payload) => {
        const msg = payload.payload as Message;
        if (msg.user_id === userId) return;
        setMessages(prev => [msg, ...prev]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, userId]);

  const handleSend = useCallback(async () => {
    if (!userId || !id || !messageText.trim() || sending) return;
    const text = messageText.trim();
    setMessageText('');
    setSending(true);

    const profile = memberProfileMap.current.get(userId);
    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: id,
      user_id: userId,
      message: text,
      gif_url: null,
      created_at: new Date().toISOString(),
      sender_name: profile?.name ?? 'You',
      sender_avatar: profile?.avatar ?? null,
    };
    setMessages(prev => [optimistic, ...prev]);

    try {
      const saved = await sendMessage(id, userId, text);
      setMessages(prev => prev.map(m => m.id === optimistic.id ? saved : m));
    } catch (e) {
      silentCatch('chatDetail:sendMessage')(e);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }, [userId, id, messageText, sending]);

  const handleSendGif = useCallback(async (gifUrl: string) => {
    if (!userId || !id) return;
    setGifPickerVisible(false);

    const profile = memberProfileMap.current.get(userId);
    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: id,
      user_id: userId,
      message: null,
      gif_url: gifUrl,
      created_at: new Date().toISOString(),
      sender_name: profile?.name ?? 'You',
      sender_avatar: profile?.avatar ?? null,
    };
    setMessages(prev => [optimistic, ...prev]);

    try {
      const saved = await sendMessage(id, userId, undefined, gifUrl);
      setMessages(prev => prev.map(m => m.id === optimistic.id ? saved : m));
    } catch (e) {
      silentCatch('chatDetail:sendGif')(e);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
    }
  }, [userId, id]);

  const handleLeave = useCallback(() => {
    if (!userId || !id) return;
    Alert.alert('Leave Chat', "Leave this conversation? You'll lose access unless invited again.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive',
        onPress: async () => {
          try { await leaveConversation(userId, id); router.replace('/(tabs)/chat'); } catch (e) { silentCatch('chatDetail:leave')(e); }
        },
      },
    ]);
  }, [userId, id, router]);

  const handleToggleSpoilerLock = useCallback(async () => {
    if (!conversation) return;
    try {
      const newValue = !conversation.spoiler_lock;
      await toggleSpoilerLock(conversation.id, newValue);
      setConversation({ ...conversation, spoiler_lock: newValue });
    } catch (e) { silentCatch('chatDetail:spoilerLock')(e); }
  }, [conversation]);

  const handleOpenInviteModal = useCallback(async () => {
    if (!userId || !id) return;
    setInviteModalVisible(true);
    setLoadingFriends(true);
    try {
      const friends = await getFriendsNotInConversation(userId, id);
      setInvitableFriends(friends);
      setInvitedIds(new Set(friends.filter(f => f.alreadyInvited).map(f => f.user.id)));
    } catch (e) { silentCatch('chatDetail:loadInvitable')(e); } finally { setLoadingFriends(false); }
  }, [userId, id]);

  const handleInviteFriend = useCallback(async (friendId: string) => {
    if (!userId || !id) return;
    try {
      await sendConversationInvite(id, userId, friendId);
      setInvitedIds(prev => new Set(prev).add(friendId));
    } catch (e) { silentCatch('chatDetail:invite')(e); }
  }, [userId, id]);

  const handleRename = useCallback(async () => {
    if (!conversation) return;
    try {
      const newName = editName.trim() || null;
      await renameConversation(conversation.id, newName);
      setConversation({ ...conversation, name: newName });
      setSettingsModalVisible(false);
    } catch (e) { silentCatch('chatDetail:rename')(e); }
  }, [conversation, editName]);

  const handleOpenShowPicker = useCallback(async () => {
    if (!userId) return;
    setShowPickerVisible(true);
    setLoadingShows(true);
    try {
      const shows = await getUserShows(userId);
      setUserShows(shows.filter(s => s.status === 'currently_watching' || s.status === 'watched'));
    } catch (e) { silentCatch('chatDetail:loadShows')(e); } finally { setLoadingShows(false); }
  }, [userId]);

  const handleAttachShow = useCallback(async (show: UserShow) => {
    if (!conversation) return;
    try {
      await attachShow(conversation.id, show.show_id, show.show_title, show.show_image);
      setConversation({ ...conversation, show_id: show.show_id, show_title: show.show_title, show_image: show.show_image });
      setShowPickerVisible(false);
      fetchData(); // refresh members with show progress
    } catch (e) { silentCatch('chatDetail:attachShow')(e); }
  }, [conversation, fetchData]);

  const handleDetachShow = useCallback(async () => {
    if (!conversation) return;
    try {
      await detachShow(conversation.id);
      setConversation({ ...conversation, show_id: null, show_title: null, show_image: null, spoiler_lock: false });
      fetchData();
    } catch (e) { silentCatch('chatDetail:detachShow')(e); }
  }, [conversation, fetchData]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View>;
  if (!conversation) return <View style={styles.center}><Text style={styles.errorText}>Failed to load chat</Text></View>;

  const frontRunner = getFrontRunner(members);
  const myMember = members.find(m => m.user_id === userId);
  const isOwner = conversation.created_by === userId;
  const isDM = members.length === 2 && !conversation.show_id;
  const hasShow = !!conversation.show_id;
  const chatUnlocked = !conversation.spoiler_lock || !hasShow || (myMember
    ? isCaughtUp(myMember.current_season, myMember.current_episode, frontRunner.season, frontRunner.episode)
    : false);

  const otherMembers = members.filter(m => m.user_id !== userId);
  const displayName = getConversationDisplayName(
    conversation,
    otherMembers.map(m => m.display_name),
    userId!,
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Pressable style={({ pressed }) => [styles.headerBackArea, pressed && { opacity: 0.5 }]} onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8 }}>
              <FontAwesome name="chevron-left" size={20} color={theme.textDim} />
              {hasShow && conversation.show_image ? (
                <View style={styles.headerPosterWrap}>
                  <Image source={{ uri: conversation.show_image }} style={styles.headerPoster} contentFit="cover" />
                </View>
              ) : isDM && otherMembers.length > 0 ? (
                otherMembers[0].avatar_url ? (
                  <Image source={{ uri: otherMembers[0].avatar_url }} style={styles.headerAvatarImage} contentFit="cover" />
                ) : (
                  <View style={styles.headerAvatar}>
                    <Text style={styles.headerAvatarText}>{(otherMembers[0].display_name[0] || '?').toUpperCase()}</Text>
                  </View>
                )
              ) : null}
              <View style={styles.headerInfo}>
                <Text style={styles.headerName} numberOfLines={1}>{displayName}</Text>
                {hasShow && conversation.show_title && (
                  <Text style={styles.headerShowTitle}>{conversation.show_title}</Text>
                )}
              </View>
            </Pressable>
            {!isDM && (
              <Pressable style={({ pressed }) => [styles.inviteButton, pressed && { opacity: 0.7 }]} onPress={handleOpenInviteModal}>
                <Text style={styles.inviteButtonText}>Invite</Text>
              </Pressable>
            )}
            <Pressable style={({ pressed }) => pressed && { opacity: 0.5 }} onPress={() => { setEditName(conversation.name ?? ''); setSettingsModalVisible(true); }}>
              <FontAwesome name="gear" size={20} color={theme.textDim} />
            </Pressable>
          </View>

          {/* Show progress — always visible when show attached */}
          {hasShow && members.length > 0 && (
            <View style={styles.progressRow}>
              {members.map(m => {
                const isFront = m.current_season === frontRunner.season && m.current_episode === frontRunner.episode && frontRunner.season > 0;
                const status = m.show_status === 'watched' ? 'Watched' : m.current_season > 0 ? `S${m.current_season} E${m.current_episode}` : m.show_status === 'want_to_watch' ? 'Watchlist' : 'Not started';
                return (
                  <View key={m.user_id} style={[styles.progressChip, isFront && styles.progressChipFront]}>
                    <Text style={styles.progressName} numberOfLines={1}>{m.username}</Text>
                    <Text style={[styles.progressStatus, isFront && styles.progressStatusFront]}>{status}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Members toggle (groups without show) */}
          {!hasShow && members.length > 2 && (
            <>
              <Pressable style={styles.membersToggle} onPress={() => setShowMembers(!showMembers)}>
                <Text style={styles.membersToggleText}>Members ({members.length})</Text>
                <Text style={styles.chevron}>{showMembers ? '▾' : '▸'}</Text>
              </Pressable>
              {showMembers && members.map(m => (
                <View key={m.user_id} style={styles.memberRow}>
                  {m.avatar_url ? (
                    <Image source={{ uri: m.avatar_url }} style={styles.memberAvatarImage} contentFit="cover" />
                  ) : (
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>{(m.display_name[0] || '?').toUpperCase()}</Text>
                    </View>
                  )}
                  <Text style={styles.memberName} numberOfLines={1}>{m.display_name}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        {/* Chat */}
        <View style={styles.chatArea} {...panResponder.panHandlers}>
          {chatUnlocked ? (
            <>
              <FlatList
                data={messages}
                keyExtractor={item => item.id}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
                renderItem={({ item, index }) => {
                  const isMe = item.user_id === userId;
                  const msgDate = new Date(item.created_at).toDateString();
                  const nextMsg = messages[index + 1];
                  const nextDate = nextMsg ? new Date(nextMsg.created_at).toDateString() : null;
                  const showDateSep = !nextMsg || msgDate !== nextDate;
                  const timeStr = new Date(item.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                  return (
                    <>
                      <View style={styles.messageOuter}>
                        <Animated.View style={[
                          styles.messageRow,
                          isMe ? styles.messageRowSelf : styles.messageRowOther,
                          { marginRight: dragX.interpolate({ inputRange: [-23, 0], outputRange: [23, 0], extrapolate: 'clamp' }) },
                        ]}>
                          {item.gif_url ? (
                            <View style={[styles.gifBubble, isMe ? styles.gifSelf : styles.gifOther]}>
                              {!isMe && members.length > 2 && <Text style={styles.messageSender}>{item.sender_name}</Text>}
                              <Image source={{ uri: item.gif_url }} style={styles.gifImage} contentFit="cover" autoplay />
                            </View>
                          ) : (
                            <View style={[styles.messageBubble, isMe ? styles.messageSelf : styles.messageOther]}>
                              {!isMe && members.length > 2 && <Text style={styles.messageSender}>{item.sender_name}</Text>}
                              <Text style={[styles.messageText, isMe && styles.messageTextSelf]}>{item.message}</Text>
                            </View>
                          )}
                        </Animated.View>
                        <Animated.View style={[styles.timeReveal, {
                          width: dragX.interpolate({ inputRange: [-23, 0], outputRange: [23, 0], extrapolate: 'clamp' }),
                          opacity: dragX.interpolate({ inputRange: [-23, -5, 0], outputRange: [1, 0.3, 0], extrapolate: 'clamp' }),
                        }]}>
                          <Text style={styles.messageTime}>{timeStr}</Text>
                        </Animated.View>
                      </View>
                      {showDateSep && (
                        <View style={styles.dateSeparator}>
                          <Text style={styles.dateSeparatorText}>{formatChatDate(item.created_at)}</Text>
                        </View>
                      )}
                    </>
                  );
                }}
                inverted
                contentContainerStyle={styles.messageList}
                ListEmptyComponent={<View style={styles.chatEmpty}><Text style={styles.chatEmptyText}>No messages yet. Start the conversation!</Text></View>}
              />
              <View style={[styles.inputBar, { paddingBottom: insets.bottom > 0 ? insets.bottom - 20 : 13 }]}>
                <Pressable style={({ pressed }) => pressed && { opacity: 0.5 }} onPress={() => setGifPickerVisible(true)}>
                  <Text style={styles.gifButton}>GIF</Text>
                </Pressable>
                <TextInput style={styles.messageInput} placeholder="Message..." placeholderTextColor={theme.textFaint} value={messageText} onChangeText={setMessageText} multiline maxLength={2000} />
                <Pressable
                  style={({ pressed }) => [styles.sendButton, (!messageText.trim() || sending) && styles.sendButtonDisabled, pressed && { opacity: 0.7 }]}
                  onPress={handleSend} disabled={!messageText.trim() || sending}
                >
                  <Text style={styles.sendButtonText}>Send</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.lockedChat}>
              <Text style={styles.lockedIcon}>🔒</Text>
              <Text style={styles.lockedTitle}>Chat Locked</Text>
              <Text style={styles.lockedMessage}>Catch up to S{frontRunner.season} E{frontRunner.episode} to unlock</Text>
              <Text style={styles.lockedHint}>This prevents spoilers — once you're caught up, the chat opens instantly</Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Invite Modal */}
      <Modal visible={inviteModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setInviteModalVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Invite Friends</Text>
            <Pressable onPress={() => setInviteModalVisible(false)}><Text style={styles.modalDone}>Done</Text></Pressable>
          </View>
          {loadingFriends ? (
            <View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View>
          ) : invitableFriends.length === 0 ? (
            <View style={styles.center}><Text style={styles.modalEmptyText}>No friends to invite</Text></View>
          ) : (
            <FlatList data={invitableFriends} keyExtractor={item => item.user.id} renderItem={({ item }) => (
              <FriendRow user={item.user} action={invitedIds.has(item.user.id) ? 'invited' : 'invite'} onAction={handleInviteFriend} />
            )} />
          )}
        </View>
      </Modal>

      {/* Settings Modal */}
      <Modal visible={settingsModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSettingsModalVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Settings</Text>
            <Pressable onPress={() => setSettingsModalVisible(false)}><Text style={styles.modalDone}>Done</Text></Pressable>
          </View>
          <View style={styles.settingsContent}>
            {/* Rename (creator only) */}
            {isOwner && (
              <View style={styles.settingsSection}>
                <Text style={styles.settingsLabel}>Chat Name</Text>
                <View style={styles.renameRow}>
                  <TextInput
                    style={styles.renameInput}
                    placeholder="Auto-generated from members"
                    placeholderTextColor={theme.textFaint}
                    value={editName}
                    onChangeText={setEditName}
                    maxLength={50}
                    returnKeyType="done"
                    onSubmitEditing={() => { handleRename(); Keyboard.dismiss(); }}
                  />
                  <Pressable style={({ pressed }) => [styles.renameSave, pressed && { opacity: 0.7 }]} onPress={handleRename}>
                    <Text style={styles.renameSaveText}>Save</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Show attachment (creator only) */}
            {isOwner && (
              <View style={styles.settingsSection}>
                <Text style={styles.settingsLabel}>Show</Text>
                {hasShow ? (
                  <View style={styles.showAttached}>
                    <Text style={styles.showAttachedName}>{conversation.show_title}</Text>
                    <Pressable style={({ pressed }) => pressed && { opacity: 0.7 }} onPress={handleDetachShow}>
                      <Text style={styles.removeShowText}>Remove</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable style={({ pressed }) => [styles.attachShowButton, pressed && { opacity: 0.7 }]} onPress={handleOpenShowPicker}>
                    <Text style={styles.attachShowText}>Attach a Show</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Spoiler Lock (creator only, show required) */}
            {hasShow && (
              <View style={styles.settingsSection}>
                <Pressable style={styles.settingsRow} onPress={isOwner ? handleToggleSpoilerLock : undefined}>
                  <View style={styles.settingsRowInfo}>
                    <Text style={styles.settingsLabel}>Spoiler Lock</Text>
                    <Text style={styles.settingsHint}>
                      When enabled, members behind on episodes can't see chat until they catch up.
                    </Text>
                  </View>
                  <View style={[styles.toggleTrack, conversation.spoiler_lock && styles.toggleTrackOn]}>
                    <View style={[styles.toggleThumb, conversation.spoiler_lock && styles.toggleThumbOn]} />
                  </View>
                </Pressable>
                {!isOwner && <Text style={styles.settingsNote}>Only the creator can change this</Text>}
              </View>
            )}

            {/* Leave */}
            <View style={styles.settingsSection}>
              <Pressable
                style={({ pressed }) => [styles.dangerButton, pressed && { opacity: 0.7 }]}
                onPress={() => { setSettingsModalVisible(false); setTimeout(() => handleLeave(), 300); }}
              >
                <Text style={styles.dangerButtonText}>Leave Chat</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* GIF Picker Modal */}
      <Modal visible={gifPickerVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setGifPickerVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Send a GIF</Text>
            <Pressable onPress={() => setGifPickerVisible(false)}><Text style={styles.modalDone}>Cancel</Text></Pressable>
          </View>
          <GifPicker onSelect={handleSendGif} />
        </View>
      </Modal>

      {/* Show Picker Modal */}
      <Modal visible={showPickerVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPickerVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Attach a Show</Text>
            <Pressable onPress={() => setShowPickerVisible(false)}><Text style={styles.modalDone}>Cancel</Text></Pressable>
          </View>
          {loadingShows ? (
            <View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View>
          ) : (
            <FlatList
              data={userShows}
              keyExtractor={item => item.show_id}
              renderItem={({ item }) => (
                <Pressable style={({ pressed }) => [styles.showPickerRow, pressed && { opacity: 0.7 }]} onPress={() => handleAttachShow(item)}>
                  <View style={styles.showPickerPoster}>
                    {item.show_image ? (
                      <Image source={{ uri: item.show_image }} style={styles.showPickerPosterImg} contentFit="cover" />
                    ) : (
                      <View style={[styles.showPickerPosterImg, { backgroundColor: theme.bgCard, justifyContent: 'center', alignItems: 'center' }]}>
                        <Text style={{ fontSize: 14 }}>📺</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.showPickerTitle} numberOfLines={1}>{item.show_title}</Text>
                </Pressable>
              )}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  center: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: '#f87171' },

  // Header
  header: { borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  headerBackArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  headerPosterWrap: { width: 40, height: 56, borderRadius: 4, overflow: 'hidden' },
  headerPoster: { width: '100%', height: '100%' },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.bgCard, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  headerAvatarImage: { width: 40, height: 40, borderRadius: 20 },
  headerAvatarText: { fontSize: 16, fontFamily: 'DMSans_700Bold', color: theme.textDim },
  headerInfo: { flex: 1, gap: 2 },
  headerName: { fontSize: 15, fontFamily: 'DMSans_700Bold', color: theme.text },
  headerShowTitle: { fontSize: 12, fontFamily: 'DMSans_400Regular', color: theme.textDim },
  inviteButton: { backgroundColor: theme.accent, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 },
  inviteButtonText: { fontSize: 13, fontFamily: 'DMSans_600SemiBold', color: '#fff' },

  // Progress pills (show-attached chats)
  progressRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 10, gap: 6 },
  progressChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bgCard, borderRadius: 10, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  progressChipFront: { borderColor: 'rgba(255,107,53,0.4)' },
  progressName: { fontSize: 11, fontFamily: 'DMSans_600SemiBold', color: theme.text, paddingHorizontal: 8, paddingVertical: 5 },
  progressStatus: { fontSize: 11, fontFamily: 'DMSans_500Medium', color: theme.textDim, backgroundColor: theme.bg, paddingHorizontal: 8, paddingVertical: 5 },
  progressStatusFront: { color: theme.accent, fontFamily: 'DMSans_600SemiBold' },

  // Members
  membersToggle: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 6 },
  membersToggleText: { fontSize: 13, fontFamily: 'DMSans_600SemiBold', color: theme.textDim },
  chevron: { fontSize: 12, color: theme.textDim },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6, gap: 10 },
  memberAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.bgCard, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  memberAvatarImage: { width: 28, height: 28, borderRadius: 14 },
  memberAvatarText: { fontSize: 12, fontFamily: 'DMSans_700Bold', color: theme.textDim },
  memberName: { flex: 1, fontSize: 13, fontFamily: 'DMSans_500Medium', color: theme.text },
  memberProgress: { fontSize: 12, fontFamily: 'DMSans_400Regular', color: theme.textFaint },
  memberProgressFront: { color: theme.accent, fontFamily: 'DMSans_600SemiBold' },

  // Chat
  chatArea: { flex: 1 },
  messageList: { paddingVertical: 16, gap: 4 },
  messageOuter: { flexDirection: 'row', alignItems: 'center' },
  messageRow: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  messageRowSelf: { justifyContent: 'flex-end' },
  messageRowOther: { justifyContent: 'flex-start' },
  messageBubble: { maxWidth: '80%', padding: 10, borderRadius: 12, flexShrink: 1 },
  messageSelf: { backgroundColor: theme.accent, borderBottomRightRadius: 4 },
  messageOther: { backgroundColor: theme.bgCard, borderBottomLeftRadius: 4 },
  gifBubble: { maxWidth: '65%', marginBottom: 4 },
  gifSelf: { alignSelf: 'flex-end' },
  gifOther: { alignSelf: 'flex-start' },
  gifImage: { width: '100%', aspectRatio: 1.5, borderRadius: 12 },
  messageSender: { fontSize: 11, fontFamily: 'DMSans_600SemiBold', color: theme.textDim, marginBottom: 2 },
  messageText: { fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.text },
  messageTextSelf: { color: '#fff' },
  timeReveal: { justifyContent: 'center' },
  messageTime: { fontSize: 10, fontFamily: 'DMSans_400Regular', color: 'rgba(255,255,255,0.4)', position: 'absolute', right: 0, width: 50, textAlign: 'right', paddingRight: 7 },
  dateSeparator: { alignItems: 'center', paddingVertical: 12 },
  dateSeparatorText: { fontSize: 11, fontFamily: 'DMSans_500Medium', color: theme.textFaint, backgroundColor: theme.bgCard, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  chatEmpty: { padding: 32, alignItems: 'center' },
  chatEmptyText: { fontSize: 13, fontFamily: 'DMSans_400Regular', color: theme.textFaint, textAlign: 'center' },

  // Input
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4, borderTopWidth: 1, borderTopColor: theme.border, gap: 8 },
  messageInput: { flex: 1, backgroundColor: theme.bgCard, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.text, maxHeight: 100, borderWidth: 1, borderColor: theme.border },
  sendButton: { backgroundColor: theme.accent, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  sendButtonDisabled: { opacity: 0.4 },
  gifButton: { fontSize: 12, fontFamily: 'DMSans_700Bold', color: theme.accent, borderWidth: 1, borderColor: theme.accent, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 10, overflow: 'hidden' },
  sendButtonText: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: '#fff' },

  // Locked
  lockedChat: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: 'rgba(19,21,32,0.95)' },
  lockedIcon: { fontSize: 48, marginBottom: 16 },
  lockedTitle: { fontSize: 20, fontFamily: 'DMSans_700Bold', color: theme.text, marginBottom: 8 },
  lockedMessage: { fontSize: 15, fontFamily: 'DMSans_600SemiBold', color: theme.accent, textAlign: 'center', marginBottom: 12 },
  lockedHint: { fontSize: 13, fontFamily: 'DMSans_400Regular', color: theme.textFaint, textAlign: 'center', lineHeight: 20 },

  // Modals
  modalContainer: { flex: 1, backgroundColor: theme.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.border },
  modalTitle: { fontSize: 18, fontFamily: 'DMSans_700Bold', color: theme.text },
  modalDone: { fontSize: 15, fontFamily: 'DMSans_600SemiBold', color: theme.accent },
  modalEmptyText: { fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.textDim, textAlign: 'center', padding: 32 },

  // Settings
  settingsContent: { padding: 16 },
  settingsSection: { marginBottom: 24 },
  settingsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bgCard, borderRadius: 10, padding: 16, borderWidth: 1, borderColor: theme.border },
  settingsRowInfo: { flex: 1, marginRight: 12 },
  settingsLabel: { fontSize: 15, fontFamily: 'DMSans_600SemiBold', color: theme.text, marginBottom: 8 },
  settingsHint: { fontSize: 12, fontFamily: 'DMSans_400Regular', color: theme.textFaint, marginTop: 2, lineHeight: 18 },
  settingsNote: { fontSize: 11, fontFamily: 'DMSans_400Regular', color: theme.textFaint, marginTop: 8, paddingHorizontal: 4 },
  toggleTrack: { width: 40, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', paddingHorizontal: 2 },
  toggleTrackOn: { backgroundColor: theme.accent },
  toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  toggleThumbOn: { alignSelf: 'flex-end' },
  dangerButton: { backgroundColor: 'rgba(248,113,113,0.1)', borderRadius: 10, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(248,113,113,0.2)' },
  dangerButtonText: { fontSize: 15, fontFamily: 'DMSans_600SemiBold', color: '#f87171' },

  // Rename
  renameRow: { flexDirection: 'row', gap: 8 },
  renameInput: { flex: 1, backgroundColor: theme.bgCard, borderRadius: 8, padding: 12, fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.text, borderWidth: 1, borderColor: theme.border },
  renameSave: { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  renameSaveText: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: '#fff' },

  // Show attachment
  showAttached: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.bgCard, borderRadius: 10, padding: 16, borderWidth: 1, borderColor: theme.border },
  showAttachedName: { fontSize: 14, fontFamily: 'DMSans_500Medium', color: theme.text },
  removeShowText: { fontSize: 13, fontFamily: 'DMSans_500Medium', color: '#f87171' },
  attachShowButton: { backgroundColor: theme.bgCard, borderRadius: 10, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: theme.border },
  attachShowText: { fontSize: 14, fontFamily: 'DMSans_500Medium', color: theme.accent },

  // Show picker
  showPickerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  showPickerPoster: { width: 32, height: 44, borderRadius: 4, overflow: 'hidden' },
  showPickerPosterImg: { width: '100%', height: '100%' },
  showPickerTitle: { flex: 1, fontSize: 14, fontFamily: 'DMSans_500Medium', color: theme.text },
});
