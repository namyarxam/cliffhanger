import { useCallback, useMemo } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getBlockedUsers, unblockUser } from '@/src/lib/moderation';
import type { UserProfile } from '@/src/lib/types';
import { qk } from '@/src/lib/queryKeys';

export default function BlockedUsersScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();

  const blockedQ = useQuery({
    queryKey: qk.blocked(userId),
    queryFn: () => getBlockedUsers(userId!),
    enabled: !!userId,
  });
  const users = blockedQ.data ?? [];
  const loading = blockedQ.isLoading;

  useFocusEffect(useCallback(() => {
    if (!userId) return;
    queryClient.invalidateQueries({ queryKey: qk.blocked(userId) });
  }, [userId, queryClient]));

  const handleUnblock = useCallback((user: UserProfile) => {
    if (!userId) return;
    Alert.alert(
      `Unblock ${user.display_name}?`,
      'They will be able to view your profile and send you a friend request again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            try {
              await unblockUser(userId, user.id);
              queryClient.setQueryData<UserProfile[]>(
                qk.blocked(userId),
                prev => (prev ?? []).filter(u => u.id !== user.id),
              );
            } catch (e: any) {
              Alert.alert('Could not unblock', e.message || 'Please try again.');
            }
          },
        },
      ],
    );
  }, [userId, queryClient]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.5 }]} onPress={() => router.replace('/(tabs)/settings')}>
          <FontAwesome name="chevron-left" size={16} color={theme.accent} />
          <Text style={styles.backText}>Settings</Text>
        </Pressable>
        <Text style={styles.title}>Blocked</Text>
        <View style={styles.backButton} />
      </View>

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : users.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No one blocked</Text>
          <Text style={styles.emptyHint}>Users you block will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={u => u.id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              {item.avatar_url ? (
                <Image source={{ uri: item.avatar_url }} style={styles.avatarImage} contentFit="cover" />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{(item.display_name[0] || '?').toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.info}>
                <Text style={styles.name} numberOfLines={1}>{item.display_name}</Text>
                <Text style={styles.username} numberOfLines={1}>@{item.username}</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.unblockButton, pressed && { opacity: 0.7 }]}
                onPress={() => handleUnblock(item)}
              >
                <Text style={styles.unblockText}>Unblock</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: 90,
  },
  backText: {
    fontSize: 15,
    fontFamily: 'DMSans_500Medium',
    color: theme.accent,
  },
  title: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    padding: 32,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  emptyHint: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarText: {
    fontSize: 15,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
  },
  info: {
    flex: 1,
    gap: 1,
  },
  name: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  username: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  unblockButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  unblockText: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
});
