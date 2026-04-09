import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { supabase } from '@/src/lib/supabase';
import {
  getGroupDetail,
  getGroupMembers,
  getGroupMessages,
  sendMessage,
  getFrontRunner,
  isCaughtUp,
  leaveGroup,
  toggleSpoilerLock,
} from '@/src/lib/groups';
import type { Group, GroupMember, GroupMessage } from '@/src/lib/types';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const memberProfileMap = useRef(new Map<string, { name: string; avatar: string | null }>());

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const g = await getGroupDetail(id);
      setGroup(g);

      const [m, msgs] = await Promise.all([
        getGroupMembers(id, g.show_id),
        getGroupMessages(id).catch(() => [] as GroupMessage[]),
      ]);
      setMembers(m);
      setMessages(msgs);

      // Build profile map for realtime messages
      for (const member of m) {
        memberProfileMap.current.set(member.user_id, {
          name: member.display_name,
          avatar: member.avatar_url,
        });
      }
    } catch (e) {
      console.error('Group fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Realtime subscription for new messages
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`group-${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'group_messages',
        filter: `group_id=eq.${id}`,
      }, (payload) => {
        const newMsg = payload.new as any;
        const profile = memberProfileMap.current.get(newMsg.user_id);
        const msg: GroupMessage = {
          id: newMsg.id,
          group_id: newMsg.group_id,
          user_id: newMsg.user_id,
          message: newMsg.message,
          created_at: newMsg.created_at,
          sender_name: profile?.name ?? 'Unknown',
          sender_avatar: profile?.avatar ?? null,
        };
        setMessages(prev => [msg, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  const handleSend = useCallback(async () => {
    if (!userId || !id || !messageText.trim() || sending) return;
    setSending(true);
    try {
      await sendMessage(id, userId, messageText);
      setMessageText('');
    } catch {
      Alert.alert('Error', 'Failed to send message');
    } finally {
      setSending(false);
    }
  }, [userId, id, messageText, sending]);

  const handleCopyCode = useCallback(async () => {
    if (!group) return;
    await Clipboard.setStringAsync(group.invite_code);
    Alert.alert('Copied!', `Invite code "${group.invite_code}" copied to clipboard`);
  }, [group]);

  const handleLeave = useCallback(() => {
    if (!userId || !id) return;
    Alert.alert('Leave Group', 'Are you sure you want to leave this group?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveGroup(userId, id);
            router.back();
          } catch {
            Alert.alert('Error', 'Failed to leave group');
          }
        },
      },
    ]);
  }, [userId, id, router]);

  const handleToggleSpoilerLock = useCallback(async () => {
    if (!group) return;
    try {
      const newValue = !group.spoiler_lock;
      await toggleSpoilerLock(group.id, newValue);
      setGroup({ ...group, spoiler_lock: newValue });
    } catch {
      Alert.alert('Error', 'Failed to update spoiler lock');
    }
  }, [group]);

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: '' }} />
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  if (!group) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Error' }} />
        <Text style={styles.errorText}>Failed to load group</Text>
      </View>
    );
  }

  // Spoiler lock logic
  const frontRunner = getFrontRunner(members);
  const myMember = members.find(m => m.user_id === userId);
  const isOwner = group.created_by === userId;
  const chatUnlocked = !group.spoiler_lock || (myMember
    ? isCaughtUp(myMember.current_season, myMember.current_episode, frontRunner.season, frontRunner.episode)
    : false);

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ title: group.name }} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        {/* Group header */}
        <View style={styles.groupHeader}>
          <View style={styles.groupHeaderTop}>
            <View style={styles.groupHeaderInfo}>
              <Text style={styles.showTitle}>{group.show_title}</Text>
              <Pressable onPress={handleCopyCode} style={styles.codeRow}>
                <Text style={styles.codeLabel}>Invite: </Text>
                <Text style={styles.codeValue}>{group.invite_code}</Text>
                <Text style={styles.codeCopy}> Copy</Text>
              </Pressable>
            </View>
            <Pressable onPress={handleLeave}>
              <Text style={styles.leaveText}>Leave</Text>
            </Pressable>
          </View>

          {/* Spoiler lock toggle (owner only) */}
          {isOwner && (
            <Pressable
              style={styles.spoilerToggle}
              onPress={handleToggleSpoilerLock}
            >
              <Text style={styles.spoilerToggleText}>
                Spoiler Lock {group.spoiler_lock ? 'On' : 'Off'}
              </Text>
              <View style={[styles.toggleTrack, group.spoiler_lock && styles.toggleTrackOn]}>
                <View style={[styles.toggleThumb, group.spoiler_lock && styles.toggleThumbOn]} />
              </View>
            </Pressable>
          )}

          {/* Members toggle */}
          <Pressable
            style={styles.membersToggle}
            onPress={() => setShowMembers(!showMembers)}
          >
            <Text style={styles.membersToggleText}>
              Members ({members.length})
            </Text>
            <Text style={styles.chevron}>{showMembers ? '▾' : '▸'}</Text>
          </Pressable>

          {showMembers && members.map(m => {
            const isFront = m.current_season === frontRunner.season && m.current_episode === frontRunner.episode && frontRunner.season > 0;
            return (
              <View key={m.user_id} style={styles.memberRow}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>
                    {(m.display_name[0] || '?').toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.memberName} numberOfLines={1}>{m.display_name}</Text>
                <Text style={[styles.memberProgress, isFront && styles.memberProgressFront]}>
                  {m.current_season > 0
                    ? `S${m.current_season} E${m.current_episode}`
                    : 'Not started'}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Chat area */}
        <View style={styles.chatArea}>
          {chatUnlocked ? (
            <>
              <FlatList
                data={messages}
                keyExtractor={item => item.id}
                renderItem={({ item }) => {
                  const isMe = item.user_id === userId;
                  return (
                    <View style={[styles.messageBubble, isMe ? styles.messageSelf : styles.messageOther]}>
                      {!isMe && (
                        <Text style={styles.messageSender}>{item.sender_name}</Text>
                      )}
                      <Text style={[styles.messageText, isMe && styles.messageTextSelf]}>
                        {item.message}
                      </Text>
                      <Text style={styles.messageTime}>
                        {new Date(item.created_at).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                  );
                }}
                inverted
                contentContainerStyle={styles.messageList}
                ListEmptyComponent={
                  <View style={styles.chatEmpty}>
                    <Text style={styles.chatEmptyText}>No messages yet. Start the conversation!</Text>
                  </View>
                }
              />

              {/* Message input */}
              <View style={styles.inputBar}>
                <TextInput
                  style={styles.messageInput}
                  placeholder="Message..."
                  placeholderTextColor={theme.textFaint}
                  value={messageText}
                  onChangeText={setMessageText}
                  multiline
                  maxLength={2000}
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.sendButton,
                    (!messageText.trim() || sending) && styles.sendButtonDisabled,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={handleSend}
                  disabled={!messageText.trim() || sending}
                >
                  <Text style={styles.sendButtonText}>Send</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.lockedChat}>
              <Text style={styles.lockedIcon}>🔒</Text>
              <Text style={styles.lockedTitle}>Chat Locked</Text>
              <Text style={styles.lockedMessage}>
                Catch up to S{frontRunner.season} E{frontRunner.episode} to unlock the group chat
              </Text>
              <Text style={styles.lockedHint}>
                This prevents spoilers — once you're caught up, the chat opens instantly
              </Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    backgroundColor: theme.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },

  errorText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: '#f87171',
  },

  // Group header
  groupHeader: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingBottom: 12,
  },
  groupHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  groupHeaderInfo: {
    flex: 1,
  },
  showTitle: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  codeLabel: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },
  codeValue: {
    fontSize: 12,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    letterSpacing: 1,
  },
  codeCopy: {
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
    color: theme.accent,
  },
  leaveText: {
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
    color: '#f87171',
  },

  // Spoiler toggle
  spoilerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  spoilerToggleText: {
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
  },
  toggleTrack: {
    width: 40,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleTrackOn: {
    backgroundColor: theme.accent,
  },
  toggleThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
  },

  // Members
  membersToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 6,
  },
  membersToggleText: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
  },
  chevron: {
    fontSize: 12,
    color: theme.textDim,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 10,
  },
  memberAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    fontSize: 12,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
  },
  memberName: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
    color: theme.text,
  },
  memberProgress: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },
  memberProgressFront: {
    color: theme.accent,
    fontFamily: 'DMSans_600SemiBold',
  },

  // Chat
  chatArea: {
    flex: 1,
  },
  messageList: {
    padding: 16,
    gap: 8,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 10,
    borderRadius: 12,
    marginBottom: 4,
  },
  messageSelf: {
    alignSelf: 'flex-end',
    backgroundColor: theme.accent,
    borderBottomRightRadius: 4,
  },
  messageOther: {
    alignSelf: 'flex-start',
    backgroundColor: theme.bgCard,
    borderBottomLeftRadius: 4,
  },
  messageSender: {
    fontSize: 11,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
    marginBottom: 2,
  },
  messageText: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
  },
  messageTextSelf: {
    color: '#fff',
  },
  messageTime: {
    fontSize: 10,
    fontFamily: 'DMSans_400Regular',
    color: 'rgba(255,255,255,0.4)',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  chatEmpty: {
    padding: 32,
    alignItems: 'center',
  },
  chatEmptyText: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    textAlign: 'center',
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    gap: 8,
  },
  messageInput: {
    flex: 1,
    backgroundColor: theme.bgCard,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: theme.border,
  },
  sendButton: {
    backgroundColor: theme.accent,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },

  // Locked chat
  lockedChat: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: 'rgba(19,21,32,0.95)',
  },
  lockedIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  lockedTitle: {
    fontSize: 20,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 8,
  },
  lockedMessage: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.accent,
    textAlign: 'center',
    marginBottom: 12,
  },
  lockedHint: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    textAlign: 'center',
    lineHeight: 20,
  },
});
