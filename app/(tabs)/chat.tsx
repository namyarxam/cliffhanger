import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { theme } from '@/src/lib/theme';

import { useAuth } from '@/src/providers/AuthProvider';
import {
  getMyConversations,
  getPendingConversationInvites,
  acceptConversationInvite,
  declineConversationInvite,
  getConversationDisplayName,
} from '@/src/lib/conversations';
import ConversationCard from '@/src/components/ConversationCard';
import type { ConversationPreview, ConversationInviteWithDetails } from '@/src/lib/types';

export default function ChatScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [pendingInvites, setPendingInvites] = useState<ConversationInviteWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    try {
      const [data, invites] = await Promise.all([
        getMyConversations(userId),
        getPendingConversationInvites(userId),
      ]);
      setConversations(data);
      setPendingInvites(invites);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const handlePress = useCallback((id: string) => {
    router.push(`/chat/${id}`);
  }, [router]);

  const handleAccept = useCallback(async (inviteId: string) => {
    if (!userId) return;
    try {
      const conversationId = await acceptConversationInvite(inviteId, userId);
      setPendingInvites(prev => prev.filter(i => i.id !== inviteId));
      fetchData();
      router.push(`/chat/${conversationId}`);
    } catch {
      // silently fail
    }
  }, [userId, fetchData, router]);

  const handleDecline = useCallback(async (inviteId: string) => {
    try {
      await declineConversationInvite(inviteId);
      setPendingInvites(prev => prev.filter(i => i.id !== inviteId));
    } catch {
      // silently fail
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.newChatButton, pressed && { opacity: 0.7 }]}
          onPress={() => router.push('/chat/new')}
        >
          <Text style={styles.newChatButtonText}>New Chat</Text>
        </Pressable>
      </View>

      {pendingInvites.length === 0 && conversations.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyText}>
            Start a chat with a friend
          </Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <ConversationCard
              conversation={item}
              currentUserId={userId!}
              onPress={handlePress}
            />
          )}
          ListHeaderComponent={
            pendingInvites.length > 0 ? (
              <View style={styles.invitesSection}>
                <Text style={styles.invitesTitle}>
                  Invites ({pendingInvites.length})
                </Text>
                {pendingInvites.map(invite => {
                  const displayName = invite.conversation_name
                    ?? (invite.member_names.join(', ') || 'Chat');
                  return (
                    <View key={invite.id} style={styles.inviteCard}>
                      {invite.show_image ? (
                        <View style={styles.invitePosterWrap}>
                          <Image
                            source={{ uri: invite.show_image }}
                            style={styles.invitePoster}
                            contentFit="cover"
                          />
                        </View>
                      ) : (
                        <View style={styles.inviteAvatar}>
                          <Text style={styles.inviteAvatarText}>
                            {(displayName[0] || '?').toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.inviteInfo}>
                        <Text style={styles.inviteName} numberOfLines={1}>
                          {displayName}
                        </Text>
                        {invite.show_title && (
                          <Text style={styles.inviteShowTitle} numberOfLines={1}>
                            {invite.show_title}
                          </Text>
                        )}
                        <Text style={styles.inviteFrom} numberOfLines={1}>
                          From {invite.invited_by_name}
                        </Text>
                      </View>
                      <View style={styles.inviteActions}>
                        <Pressable
                          style={({ pressed }) => [styles.acceptButton, pressed && { opacity: 0.7 }]}
                          onPress={() => handleAccept(invite.id)}
                        >
                          <Text style={styles.acceptText}>Accept</Text>
                        </Pressable>
                        <Pressable
                          style={({ pressed }) => [styles.declineButton, pressed && { opacity: 0.7 }]}
                          onPress={() => handleDecline(invite.id)}
                        >
                          <Text style={styles.declineText}>Decline</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null
          }
          contentContainerStyle={styles.list}
        />
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
  actions: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  newChatButton: {
    backgroundColor: theme.accent,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  newChatButtonText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },
  list: {
    paddingBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Pending invites
  invitesSection: {
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  invitesTitle: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  invitePosterWrap: {
    width: 40,
    height: 56,
    borderRadius: 4,
    overflow: 'hidden',
  },
  invitePoster: {
    width: '100%',
    height: '100%',
  },
  inviteAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteAvatarText: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
  },
  inviteInfo: {
    flex: 1,
    gap: 2,
  },
  inviteName: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  inviteShowTitle: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  inviteFrom: {
    fontSize: 11,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 8,
  },
  acceptButton: {
    backgroundColor: theme.accent,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  acceptText: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },
  declineButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
  },
  declineText: {
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
  },
});
