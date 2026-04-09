import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Image } from 'expo-image';
import { theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getUserShows } from '@/src/lib/watchlist';
import { createGroup } from '@/src/lib/groups';
import type { UserShow } from '@/src/lib/types';

export default function CreateGroupScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [name, setName] = useState('');
  const [shows, setShows] = useState<UserShow[]>([]);
  const [selectedShow, setSelectedShow] = useState<UserShow | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!userId) return;
    getUserShows(userId)
      .then(data => {
        // Only show currently watching or watched shows
        setShows(data.filter(s => s.status === 'currently_watching' || s.status === 'watched'));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  const handleCreate = useCallback(async () => {
    if (!userId || !selectedShow || !name.trim()) return;
    setCreating(true);
    try {
      const group = await createGroup(
        userId,
        name.trim(),
        selectedShow.show_id,
        selectedShow.show_title,
        selectedShow.show_image,
      );
      router.replace(`/group/${group.id}`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to create group');
      setCreating(false);
    }
  }, [userId, selectedShow, name, router]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Create Group' }} />

      <View style={styles.form}>
        <Text style={styles.label}>Group Name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Breaking Bad Gang"
          placeholderTextColor={theme.textFaint}
          value={name}
          onChangeText={setName}
          maxLength={50}
        />

        <Text style={[styles.label, { marginTop: 24 }]}>Select a Show</Text>
        <Text style={styles.hint}>Choose from your currently watching or watched shows</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      ) : shows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Add shows to your watchlist first</Text>
        </View>
      ) : (
        <FlatList
          data={shows}
          keyExtractor={item => item.show_id}
          renderItem={({ item }) => {
            const isSelected = selectedShow?.show_id === item.show_id;
            return (
              <Pressable
                style={[styles.showRow, isSelected && styles.showRowSelected]}
                onPress={() => setSelectedShow(item)}
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

      {/* Create button */}
      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.createButton,
            (!name.trim() || !selectedShow || creating) && styles.createButtonDisabled,
            pressed && { opacity: 0.7 },
          ]}
          onPress={handleCreate}
          disabled={!name.trim() || !selectedShow || creating}
        >
          {creating ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.createButtonText}>Create Group</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  form: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    marginBottom: 12,
  },
  input: {
    backgroundColor: theme.bgCard,
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
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
  },
  list: {
    paddingBottom: 100,
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
  checkMark: {
    fontSize: 16,
    color: theme.accent,
    fontWeight: '700',
  },
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
