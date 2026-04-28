import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getLists, createList } from '@/src/lib/lists';
import type { ListWithItems, ListType } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';

export default function ListsScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [lists, setLists] = useState<ListWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ListType>('shows');
  const [showCreate, setShowCreate] = useState(false);

  const fetchLists = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await getLists(userId);
      setLists(data);
    } catch (e) { silentCatch('lists:fetch')(e); } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchLists();
  }, [fetchLists]));

  const handleCreate = useCallback(async () => {
    if (!userId || !newName.trim() || creating) return;
    setCreating(true);
    try {
      const list = await createList(userId, newName.trim(), newType);
      setNewName('');
      setShowCreate(false);
      Keyboard.dismiss();
      router.push(`/lists/${list.id}`);
    } catch (e) { silentCatch('lists:create')(e); } finally {
      setCreating(false);
    }
  }, [userId, newName, newType, creating, router]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.push('/(tabs)/profile')}>
          <Text style={styles.backText}>← Profile</Text>
        </Pressable>
        <Text style={styles.headerTitle}>My Lists</Text>
        <View style={{ width: 60 }} />
      </View>

      <FlatList
        data={lists}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.listRow, pressed && { opacity: 0.7 }]}
            onPress={() => router.push(`/lists/${item.id}`)}
          >
            <View style={styles.listInfo}>
              <View style={styles.listTitleRow}>
                <Text style={styles.listName} numberOfLines={1}>{item.name}</Text>
                {item.is_display && <Text style={styles.pinStar}>★</Text>}
              </View>
              <Text style={styles.listMeta}>
                {item.items.length} {item.type === 'shows' ? (item.items.length === 1 ? 'Show' : 'Shows') : (item.items.length === 1 ? 'Character' : 'Characters')}
              </Text>
            </View>
            <View style={styles.listThumbnails}>
              {item.items.slice(0, 4).map(li => (
                li.item_image ? (
                  <Image key={li.item_id} source={{ uri: li.item_image }} style={styles.thumbnail} contentFit="cover" />
                ) : (
                  <View key={li.item_id} style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                    <Text style={{ fontSize: 10 }}>📺</Text>
                  </View>
                )
              ))}
            </View>
            <Text style={styles.listChevron}>▸</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No lists yet</Text>
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {showCreate ? (
              <View style={styles.createForm}>
                <TextInput
                  style={styles.createInput}
                  placeholder="List name"
                  placeholderTextColor={theme.textFaint}
                  value={newName}
                  onChangeText={setNewName}
                  maxLength={40}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleCreate}
                />
                <View style={styles.typeRow}>
                  <Pressable
                    style={[styles.typePill, newType === 'shows' && styles.typePillActive]}
                    onPress={() => setNewType('shows')}
                  >
                    <Text style={[styles.typePillText, newType === 'shows' && styles.typePillTextActive]}>Shows</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.typePill, newType === 'characters' && styles.typePillActive]}
                    onPress={() => setNewType('characters')}
                  >
                    <Text style={[styles.typePillText, newType === 'characters' && styles.typePillTextActive]}>Characters</Text>
                  </Pressable>
                </View>
                <View style={styles.createActions}>
                  <Pressable
                    style={({ pressed }) => [styles.createButton, (!newName.trim() || creating) && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}
                    onPress={handleCreate}
                    disabled={!newName.trim() || creating}
                  >
                    <Text style={styles.createButtonText}>Create</Text>
                  </Pressable>
                  <Pressable onPress={() => { setShowCreate(false); setNewName(''); }}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.newListButton, pressed && { opacity: 0.7 }]}
                onPress={() => setShowCreate(true)}
              >
                <Text style={styles.newListButtonText}>+ New List</Text>
              </Pressable>
            )}
          </View>
        }
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  backText: {
    fontSize: 15,
    fontFamily: 'DMSans_500Medium',
    color: theme.accent,
    width: 60,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  list: {
    paddingBottom: 40,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  listInfo: {
    flex: 1,
    gap: 4,
  },
  listTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listName: {
    fontSize: 17,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
    flexShrink: 1,
  },
  pinStar: {
    fontSize: 14,
    color: '#fbbf24',
  },
  listMeta: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  listThumbnails: {
    flexDirection: 'row',
    gap: 4,
  },
  thumbnail: {
    width: 36,
    height: 52,
    borderRadius: 4,
  },
  thumbnailPlaceholder: {
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listChevron: {
    fontSize: 14,
    color: theme.textDim,
  },
  emptyState: {
    padding: 48,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },

  // Footer / Create
  footer: {
    padding: 16,
  },
  newListButton: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  newListButtonText: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },
  createForm: {
    backgroundColor: theme.bgCard,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 12,
  },
  createInput: {
    backgroundColor: theme.bg,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  typePill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
  },
  typePillActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  typePillText: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
  },
  typePillTextActive: {
    color: '#fff',
  },
  createActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  createButton: {
    backgroundColor: theme.accent,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  createButtonText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },
  cancelText: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
  },
});
