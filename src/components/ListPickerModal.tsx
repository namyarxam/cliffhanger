import { memo, useMemo } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Modal } from 'react-native';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { MAX_LIST_ITEMS } from '@/src/lib/lists';
import type { ListWithItems } from '@/src/lib/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  lists: ListWithItems[];
  listsContaining: Set<string>;
  onAdd: (listId: string) => void;
  onRemove: (listId: string) => void;
}

function ListPickerModal({ visible, onClose, lists, listsContaining, onAdd, onRemove }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Add to a List</Text>
          <Pressable onPress={onClose}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <FlatList
          data={lists}
          keyExtractor={item => item.id}
          renderItem={({ item: list }) => {
            const isInList = listsContaining.has(list.id);
            const isFull = list.items.length >= MAX_LIST_ITEMS && !isInList;
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }, isFull && { opacity: 0.4 }]}
                onPress={() => {
                  if (isFull) return;
                  if (isInList) onRemove(list.id);
                  else onAdd(list.id);
                }}
                disabled={isFull}
              >
                <View style={styles.info}>
                  <Text style={styles.name}>{list.name}</Text>
                  <Text style={styles.meta}>{list.items.length}/{MAX_LIST_ITEMS}</Text>
                </View>
                {isInList && <Text style={styles.check}>✓</Text>}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

export default memo(ListPickerModal);

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
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  title: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  done: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.accent,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  meta: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  check: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
  },
});
