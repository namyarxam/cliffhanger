import { useCallback, useMemo, useEffect } from 'react';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';

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
import { silentCatch } from '@/src/lib/errorLog';
import { qk } from '@/src/lib/queryKeys';

const EMPTY_CONVERSATIONS: ConversationPreview[] = [];
const EMPTY_INVITES: ConversationInviteWithDetails[] = [];

export default function ChatScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const queryClient = useQueryClient();

  const conversationsQuery = useQuery({
    queryKey: qk.conversations(userId),
    queryFn: () => getMyConversations(userId!),
    enabled: !!userId,
  });
  const invitesQuery = useQuery({
    queryKey: qk.pendingInvites(userId),
    queryFn: () => getPendingConversationInvites(userId!),
    enabled: !!userId,
  });

  const conversations = conversationsQuery.data ?? EMPTY_CONVERSATIONS;
  const pendingInvites = invitesQuery.data ?? EMPTY_INVITES;
  const loading = conversationsQuery.isLoading || invitesQuery.isLoading;

  useEffect(() => {
    if (conversationsQuery.error) silentCatch('chat:getMyConversations')(conversationsQuery.error);
  }, [conversationsQuery.error]);
  useEffect(() => {
    if (invitesQuery.error) silentCatch('chat:getPendingInvites')(invitesQuery.error);
  }, [invitesQuery.error]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      queryClient.invalidateQueries({ queryKey: qk.conversations(userId) });
      queryClient.invalidateQueries({ queryKey: qk.pendingInvites(userId) });
    }, [userId, queryClient])
  );

  const handlePress = useCallback((id: string) => {
    router.push(`/chat/${id}`);
  }, [router]);

  const handleAccept = useCallback(async (inviteId: string) => {
    if (!userId) return;
    try {
      const conversationId = await acceptConversationInvite(inviteId, userId);
      queryClient.setQueryData<ConversationInviteWithDetails[]>(
        qk.pendingInvites(userId),
        prev => (prev ?? EMPTY_INVITES).filter(i => i.id !== inviteId),
      );
      queryClient.invalidateQueries({ queryKey: qk.conversations(userId) });
      queryClient.invalidateQueries({ queryKey: qk.pendingInviteCount(userId) });
      router.push(`/chat/${conversationId}`);
    } catch (e) {
      silentCatch('chat:accept')(e);
    }
  }, [userId, queryClient, router]);

  const handleDecline = useCallback(async (inviteId: string) => {
    if (!userId) return;
    try {
      await declineConversationInvite(inviteId);
      queryClient.setQueryData<ConversationInviteWithDetails[]>(
        qk.pendingInvites(userId),
        prev => (prev ?? EMPTY_INVITES).filter(i => i.id !== inviteId),
      );
      queryClient.invalidateQueries({ queryKey: qk.pendingInviteCount(userId) });
    } catch (e) {
      silentCatch('chat:decline')(e);
    }
  }, [userId, queryClient]);

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
    backgroundColor: theme.bg,
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
