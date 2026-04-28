import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Keyboard,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import {
  getLists,
  addListItem,
  removeListItem,
  renameList,
  deleteList,
  setDisplayList,
  clearDisplayList,
  MAX_LIST_ITEMS,
} from '@/src/lib/lists';
import { getUserShows } from '@/src/lib/watchlist';
import { fetchCast, searchShows } from '@/src/lib/data';
import type { CastMember } from '@/src/lib/data';
import type { ShowSummary } from '@/src/lib/types';
import type { ListWithItems, UserShow } from '@/src/lib/types';
import { silentCatch } from '@/src/lib/errorLog';

type ShowPickerItem =
  | { kind: 'userShow'; data: UserShow }
  | { kind: 'searchResult'; data: ShowSummary };

export default function ListDetailScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [list, setList] = useState<ListWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');

  // Item picker state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerStep, setPickerStep] = useState<'shows' | 'cast'>('shows');
  const [myShows, setMyShows] = useState<UserShow[]>([]);
  const [castList, setCastList] = useState<CastMember[]>([]);
  const [selectedShowTitle, setSelectedShowTitle] = useState('');
  const [selectedShowId, setSelectedShowId] = useState('');
  const [loadingPicker, setLoadingPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ShowSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchList = useCallback(async () => {
    if (!userId || !id) return;
    try {
      const all = await getLists(userId);
      const found = all.find(l => l.id === id);
      setList(found ?? null);
    } catch (e) { silentCatch('listDetail:fetch')(e); } finally {
      setLoading(false);
    }
  }, [userId, id]);

  useEffect(() => {
    setList(null);
    setLoading(true);
    fetchList();
  }, [fetchList]);

  const handleRename = useCallback(async () => {
    if (!list || !editName.trim()) return;
    try {
      await renameList(list.id, editName.trim());
      setList({ ...list, name: editName.trim() });
      setEditingName(false);
      Keyboard.dismiss();
    } catch (e) { silentCatch('listDetail:rename')(e); }
  }, [list, editName]);

  const handleDelete = useCallback(() => {
    if (!list) return;
    Alert.alert('Delete List', `Delete "${list.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try { await deleteList(list.id); router.push('/(tabs)/lists'); } catch (e) { silentCatch('listDetail:delete')(e); }
        },
      },
    ]);
  }, [list, router]);

  const handleToggleDisplay = useCallback(async () => {
    if (!userId || !list) return;
    try {
      if (list.is_display) {
        await clearDisplayList(userId);
        setList({ ...list, is_display: false });
      } else {
        await setDisplayList(userId, list.id);
        setList({ ...list, is_display: true });
      }
    } catch (e) { silentCatch('listDetail:toggleDisplay')(e); }
  }, [userId, list]);

  const handleRemoveItem = useCallback(async (itemId: string) => {
    if (!list) return;
    try {
      await removeListItem(list.id, itemId);
      setList({ ...list, items: list.items.filter(i => i.item_id !== itemId) });
    } catch (e) { silentCatch('listDetail:removeItem')(e); }
  }, [list]);

  // Show picker
  const handleOpenPicker = useCallback(async () => {
    if (!userId) return;
    setPickerVisible(true);
    setPickerStep('shows');
    setSearchQuery('');
    setSearchResults([]);
    setLoadingPicker(true);
    try {
      const shows = await getUserShows(userId);
      setMyShows(shows);
    } catch (e) { silentCatch('listDetail:loadShows')(e); } finally {
      setLoadingPicker(false);
    }
  }, [userId]);

  const handleSearchShows = useCallback((text: string) => {
    setSearchQuery(text);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (text.trim().length < 3) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchDebounce.current = setTimeout(async () => {
      try {
        const results = await searchShows(text);
        setSearchResults(results);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 500);
  }, []);

  const handlePickSearchResult = useCallback(async (show: ShowSummary) => {
    if (!list) return;
    if (list.type === 'shows') {
      try {
        const item = await addListItem(list.id, show.id, show.title, show.image);
        setList({ ...list, items: [...list.items, item] });
        setPickerVisible(false);
      } catch (e: any) {
        Alert.alert('Error', e.message || 'Failed to add');
      }
    } else {
      setPickerStep('cast');
      setSelectedShowTitle(show.title);
      setSelectedShowId(show.id);
      setLoadingPicker(true);
      try {
        const cast = await fetchCast(show.id);
        setCastList(cast);
      } catch { setCastList([]); }
      finally { setLoadingPicker(false); }
    }
  }, [list]);

  const handlePickShow = useCallback(async (show: UserShow) => {
    if (!list) return;

    if (list.type === 'shows') {
      // Directly add the show to the list
      try {
        const item = await addListItem(list.id, show.show_id, show.show_title, show.show_image);
        setList({ ...list, items: [...list.items, item] });
        setPickerVisible(false);
      } catch (e: any) {
        Alert.alert('Error', e.message || 'Failed to add');
      }
    } else {
      // Characters list: drill into cast
      setPickerStep('cast');
      setSelectedShowTitle(show.show_title);
      setSelectedShowId(show.show_id);
      setLoadingPicker(true);
      try {
        const cast = await fetchCast(show.show_id);
        setCastList(cast);
      } catch { setCastList([]); }
      finally { setLoadingPicker(false); }
    }
  }, [list]);

  const handlePickCharacter = useCallback(async (character: CastMember) => {
    if (!list) return;
    const itemId = `${selectedShowId}::${character.characterName}`;
    const title = `${character.characterName}::${selectedShowTitle}`;
    try {
      const item = await addListItem(list.id, itemId, title, character.image);
      setList({ ...list, items: [...list.items, item] });
      setPickerVisible(false);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to add');
    }
  }, [list, selectedShowId]);

  if (loading) {
    return <SafeAreaView style={styles.container}><View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View></SafeAreaView>;
  }

  if (!list) {
    return <SafeAreaView style={styles.container}><View style={styles.center}><Text style={styles.errorText}>List not found</Text></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.push('/(tabs)/lists')}>
          <Text style={styles.backText}>← Lists</Text>
        </Pressable>
      </View>

      <FlatList
        data={list.items}
        keyExtractor={item => item.item_id}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {/* Name */}
            {editingName ? (
              <View style={styles.editRow}>
                <TextInput
                  style={styles.editInput}
                  value={editName}
                  onChangeText={setEditName}
                  autoFocus
                  maxLength={40}
                  returnKeyType="done"
                  onSubmitEditing={handleRename}
                />
                <Pressable style={styles.saveBtn} onPress={handleRename}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </Pressable>
                <Pressable onPress={() => setEditingName(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => { setEditName(list.name); setEditingName(true); }}>
                <Text style={styles.listTitle}>{list.name} <Text style={styles.editHint}>✎</Text></Text>
              </Pressable>
            )}

            <Text style={styles.typeBadge}>{list.type === 'shows' ? 'Shows' : 'Characters'}</Text>

            {/* Display toggle */}
            <Pressable style={styles.displayToggle} onPress={handleToggleDisplay}>
              <View style={styles.displayToggleInfo}>
                <Text style={styles.displayToggleText}>Pin as display list</Text>
                <Text style={styles.displayToggleHint}>First 4 items shown on your profile</Text>
              </View>
              <View style={[styles.toggleTrack, list.is_display && styles.toggleTrackOn]}>
                <View style={[styles.toggleThumb, list.is_display && styles.toggleThumbOn]} />
              </View>
            </Pressable>

            <Text style={styles.itemsLabel}>Items ({list.items.length}/10)</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isCharacter = list.type === 'characters';
          const [charName, showName] = isCharacter && item.item_title.includes('::')
            ? item.item_title.split('::')
            : [item.item_title, null];

          return (
            <Pressable
              style={({ pressed }) => [styles.itemRow, !isCharacter && pressed && { opacity: 0.7 }]}
              onPress={() => {
                if (!isCharacter) router.push(`/show/${item.item_id}?from=/lists/${id}`);
              }}
              disabled={isCharacter}
            >
              {item.item_image ? (
                <Image source={{ uri: item.item_image }} style={styles.itemImage} contentFit="cover" />
              ) : (
                <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                  <Text style={{ fontSize: 14 }}>📺</Text>
                </View>
              )}
              <View style={styles.itemInfo}>
                <Text style={styles.itemTitle} numberOfLines={1}>{charName}</Text>
                {showName && <Text style={styles.itemSubtitle} numberOfLines={1}>{showName}</Text>}
              </View>
              <Pressable style={({ pressed }) => pressed && { opacity: 0.5 }} onPress={() => handleRemoveItem(item.item_id)}>
                <Text style={styles.removeText}>✕</Text>
              </Pressable>
            </Pressable>
          );
        }}
        ListFooterComponent={
          <View style={styles.footerSection}>
            {list.items.length < MAX_LIST_ITEMS && (
              <Pressable style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.7 }]} onPress={handleOpenPicker}>
                <Text style={styles.addButtonText}>+ Add {list.type === 'shows' ? 'Show' : 'Character'}</Text>
              </Pressable>
            )}
            <Pressable style={({ pressed }) => [styles.deleteButton, pressed && { opacity: 0.7 }]} onPress={handleDelete}>
              <Text style={styles.deleteButtonText}>Delete List</Text>
            </Pressable>
          </View>
        }
        contentContainerStyle={styles.content}
      />

      {/* Item Picker Modal */}
      <Modal visible={pickerVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPickerVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            {pickerStep === 'cast' ? (
              <Pressable onPress={() => setPickerStep('shows')}>
                <Text style={styles.modalBack}>← Shows</Text>
              </Pressable>
            ) : (
              <Text style={styles.modalTitle}>
                {list.type === 'shows' ? 'Pick a Show' : 'Pick a Show'}
              </Text>
            )}
            {pickerStep === 'cast' && <Text style={styles.modalTitle} numberOfLines={1}>{selectedShowTitle}</Text>}
            <Pressable onPress={() => setPickerVisible(false)}>
              <Text style={styles.modalDone}>Cancel</Text>
            </Pressable>
          </View>

          {loadingPicker ? (
            <View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View>
          ) : pickerStep === 'shows' ? (
            <FlatList<ShowPickerItem>
              key="shows-list"
              data={
                searchQuery.trim().length >= 3
                  ? searchResults.map(s => ({ kind: 'searchResult' as const, data: s }))
                  : myShows.map(s => ({ kind: 'userShow' as const, data: s }))
              }
              keyExtractor={item => item.kind === 'searchResult' ? item.data.id : item.data.show_id}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                <View>
                  <TextInput
                    style={styles.pickerSearch}
                    placeholder="Search any show..."
                    placeholderTextColor={theme.textFaint}
                    value={searchQuery}
                    onChangeText={handleSearchShows}
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {searchQuery.trim().length >= 3 ? (
                    searching ? (
                      <View style={styles.pickerSearching}><ActivityIndicator color={theme.accent} size="small" /></View>
                    ) : searchResults.length === 0 ? (
                      <Text style={styles.pickerNoResults}>No results</Text>
                    ) : null
                  ) : myShows.length > 0 ? (
                    <Text style={styles.pickerSectionLabel}>From your watchlist</Text>
                  ) : null}
                </View>
              }
              renderItem={({ item }) => {
                const showId = item.kind === 'searchResult' ? item.data.id : item.data.show_id;
                const showTitle = item.kind === 'searchResult' ? item.data.title : item.data.show_title;
                const showImage = item.kind === 'searchResult' ? item.data.image : item.data.show_image;
                const alreadyAdded = list.type === 'shows' && list.items.some(i => i.item_id === showId);
                return (
                  <Pressable
                    style={({ pressed }) => [styles.pickerRow, pressed && { opacity: 0.7 }, alreadyAdded && { opacity: 0.4 }]}
                    onPress={() => {
                      if (alreadyAdded) return;
                      if (item.kind === 'searchResult') handlePickSearchResult(item.data);
                      else handlePickShow(item.data);
                    }}
                    disabled={alreadyAdded}
                  >
                    <View style={styles.pickerPoster}>
                      {showImage ? (
                        <Image source={{ uri: showImage }} style={styles.pickerPosterImg} contentFit="cover" />
                      ) : (
                        <View style={[styles.pickerPosterImg, { backgroundColor: theme.bgCard, justifyContent: 'center', alignItems: 'center' }]}>
                          <Text style={{ fontSize: 12 }}>📺</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.pickerTitle} numberOfLines={1}>{showTitle}</Text>
                    {alreadyAdded && <Text style={styles.pickerAdded}>Added</Text>}
                  </Pressable>
                );
              }}
            />
          ) : (
            castList.length === 0 ? (
              <View style={styles.center}><Text style={styles.emptyText}>No character photos available</Text></View>
            ) : (
              <FlatList
                key="cast-grid"
                data={castList}
                keyExtractor={(item, i) => `${item.characterName}-${i}`}
                numColumns={3}
                columnWrapperStyle={styles.castGrid}
                renderItem={({ item }) => {
                  const itemId = `${selectedShowId}::${item.characterName}`;
                  const alreadyAdded = list.items.some(i => i.item_id === itemId);
                  return (
                    <Pressable
                      style={({ pressed }) => [styles.castItem, pressed && { opacity: 0.7 }, alreadyAdded && { opacity: 0.4 }]}
                      onPress={() => !alreadyAdded && handlePickCharacter(item)}
                      disabled={alreadyAdded}
                    >
                      <Image source={{ uri: item.image! }} style={styles.castImage} contentFit="cover" />
                      <Text style={styles.castCharacter} numberOfLines={1}>{item.characterName}</Text>
                      <Text style={styles.castActor} numberOfLines={1}>{item.personName}</Text>
                    </Pressable>
                  );
                }}
                contentContainerStyle={styles.castContent}
              />
            )
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: '#f87171' },
  emptyText: { fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.textDim },

  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  backText: { fontSize: 15, fontFamily: 'DMSans_500Medium', color: theme.accent },

  content: { paddingBottom: 40 },

  // List header
  listHeader: { padding: 20, gap: 12 },
  listTitle: { fontSize: 22, fontFamily: 'DMSans_700Bold', color: theme.text },
  editHint: { fontSize: 16, color: theme.textFaint },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editInput: { fontSize: 18, fontFamily: 'DMSans_700Bold', color: theme.text, backgroundColor: theme.bgCard, borderWidth: 1, borderColor: theme.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, flex: 1 },
  saveBtn: { backgroundColor: theme.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  saveBtnText: { fontSize: 13, fontFamily: 'DMSans_600SemiBold', color: '#fff' },
  cancelText: { fontSize: 13, fontFamily: 'DMSans_500Medium', color: theme.textDim },

  typeBadge: { fontSize: 12, fontFamily: 'DMSans_500Medium', color: theme.textDim },

  displayToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.bgCard, borderRadius: 8, padding: 14, borderWidth: 1, borderColor: theme.border },
  displayToggleInfo: { flex: 1 },
  displayToggleText: { fontSize: 14, fontFamily: 'DMSans_500Medium', color: theme.text },
  displayToggleHint: { fontSize: 11, fontFamily: 'DMSans_400Regular', color: theme.textFaint, marginTop: 2 },
  toggleTrack: { width: 40, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', paddingHorizontal: 2 },
  toggleTrackOn: { backgroundColor: theme.accent },
  toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  toggleThumbOn: { alignSelf: 'flex-end' },

  itemsLabel: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: theme.textDim },

  // Items
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  itemImage: { width: 40, height: 56, borderRadius: 4 },
  itemImagePlaceholder: { backgroundColor: theme.bgCard, justifyContent: 'center', alignItems: 'center' },
  itemInfo: { flex: 1, gap: 2 },
  itemTitle: { fontSize: 15, fontFamily: 'DMSans_500Medium', color: theme.text },
  itemSubtitle: { fontSize: 12, fontFamily: 'DMSans_400Regular', color: theme.textDim },
  removeText: { fontSize: 16, color: theme.textFaint, padding: 4 },

  // Footer
  footerSection: { padding: 20, gap: 16 },
  addButton: { backgroundColor: theme.accent, borderRadius: 10, padding: 14, alignItems: 'center' },
  addButtonText: { fontSize: 15, fontFamily: 'DMSans_600SemiBold', color: '#fff' },
  deleteButton: { backgroundColor: 'rgba(248,113,113,0.1)', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(248,113,113,0.2)' },
  deleteButtonText: { fontSize: 15, fontFamily: 'DMSans_600SemiBold', color: '#f87171' },

  // Modal
  modalContainer: { flex: 1, backgroundColor: theme.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.border },
  modalTitle: { fontSize: 18, fontFamily: 'DMSans_700Bold', color: theme.text, flex: 1 },
  modalBack: { fontSize: 15, fontFamily: 'DMSans_500Medium', color: theme.accent, marginRight: 12 },
  modalDone: { fontSize: 15, fontFamily: 'DMSans_600SemiBold', color: theme.accent },

  pickerSearch: { backgroundColor: theme.bgCard, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.text, borderWidth: 1, borderColor: theme.border, marginHorizontal: 16, marginVertical: 12 },
  pickerSearching: { paddingVertical: 12, alignItems: 'center' },
  pickerNoResults: { fontSize: 13, fontFamily: 'DMSans_400Regular', color: theme.textFaint, textAlign: 'center', paddingVertical: 12 },
  pickerSectionLabel: { fontSize: 12, fontFamily: 'DMSans_600SemiBold', color: theme.textDim, paddingHorizontal: 16, paddingBottom: 8 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  pickerPoster: { width: 32, height: 44, borderRadius: 4, overflow: 'hidden' },
  pickerPosterImg: { width: '100%', height: '100%' },
  pickerTitle: { flex: 1, fontSize: 14, fontFamily: 'DMSans_500Medium', color: theme.text },
  pickerAdded: { fontSize: 12, fontFamily: 'DMSans_500Medium', color: theme.textFaint },

  castContent: { paddingHorizontal: 16, paddingTop: 12 },
  castGrid: { gap: 12, marginBottom: 12 },
  castItem: { width: '31%', alignItems: 'center', gap: 4 },
  castImage: { width: '100%', aspectRatio: 0.7, borderRadius: 8 },
  castCharacter: { fontSize: 11, fontFamily: 'DMSans_600SemiBold', color: theme.text, textAlign: 'center' },
  castActor: { fontSize: 10, fontFamily: 'DMSans_400Regular', color: theme.textFaint, textAlign: 'center' },
});
