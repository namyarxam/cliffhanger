import { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { getConversationDisplayName } from '@/src/lib/conversations';
import type { ConversationPreview } from '@/src/lib/types';

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

interface Props {
  conversation: ConversationPreview;
  currentUserId: string;
  onPress: (id: string) => void;
}

function ConversationCard({ conversation, currentUserId, onPress }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const displayName = getConversationDisplayName(conversation, conversation.member_names, currentUserId);
  const isDM = conversation.member_count === 2 && !conversation.show_id;

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => onPress(conversation.id)}
    >
      {/* Left: poster or avatar */}
      {conversation.show_image ? (
        <View style={styles.posterWrap}>
          <Image
            source={{ uri: conversation.show_image }}
            style={styles.poster}
            contentFit="cover"
            transition={200}
          />
        </View>
      ) : (
        <View style={styles.avatarWrap}>
          <Text style={styles.avatarText}>
            {(displayName[0] || '?').toUpperCase()}
          </Text>
        </View>
      )}

      {/* Middle: name + last message */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
        {conversation.show_title && !isDM && (
          <Text style={styles.showTitle} numberOfLines={1}>{conversation.show_title}</Text>
        )}
        {conversation.last_message && (
          <Text style={styles.lastMessage} numberOfLines={1}>
            {conversation.member_count > 2 && conversation.last_message_sender
              ? `${conversation.last_message_sender}: ${conversation.last_message}`
              : conversation.last_message}
          </Text>
        )}
      </View>

      {/* Right: timestamp */}
      <Text style={styles.time}>
        {formatRelativeTime(conversation.last_message_at)}
      </Text>
    </Pressable>
  );
}

export default memo(ConversationCard);

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 12,
  },
  pressed: {
    backgroundColor: theme.bgCard,
  },
  posterWrap: {
    width: 40,
    height: 56,
    borderRadius: 4,
    overflow: 'hidden',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  avatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  showTitle: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  lastMessage: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },
  time: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },
});
