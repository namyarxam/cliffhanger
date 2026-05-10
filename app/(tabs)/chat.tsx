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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';

import { useAuth } from '@/src/providers/AuthProvider';
import { getMyConversations } from '@/src/lib/conversations';
import ConversationCard from '@/src/components/ConversationCard';
import type { ConversationPreview } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';
import { qk } from '@/src/lib/queryKeys';

const EMPTY_CONVERSATIONS: ConversationPreview[] = [];

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

  const conversations = conversationsQuery.data ?? EMPTY_CONVERSATIONS;
  const loading = conversationsQuery.isLoading;

  useEffect(() => {
    if (conversationsQuery.error) silentCatch('chat:getMyConversations')(conversationsQuery.error);
  }, [conversationsQuery.error]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      queryClient.invalidateQueries({ queryKey: qk.conversations(userId) });
    }, [userId, queryClient])
  );

  const handlePress = useCallback((id: string) => {
    router.push(`/chat/${id}`);
  }, [router]);

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

      {conversations.length === 0 ? (
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
});
