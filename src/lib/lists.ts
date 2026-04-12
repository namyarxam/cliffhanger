import { supabase } from './supabase';
import type { List, ListItem, ListWithItems, ListType } from './types';

export async function getLists(userId: string): Promise<ListWithItems[]> {
  const { data, error } = await supabase
    .from('lists')
    .select('*, list_items(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(l => ({
    ...l,
    items: (l.list_items ?? []).sort((a: ListItem, b: ListItem) => a.position - b.position),
  }));
}

export async function getDisplayList(userId: string): Promise<ListWithItems | null> {
  const { data, error } = await supabase
    .from('lists')
    .select('*, list_items(*)')
    .eq('user_id', userId)
    .eq('is_display', true)
    .maybeSingle();

  if (error || !data) return null;
  return {
    ...data,
    items: (data.list_items ?? []).sort((a: ListItem, b: ListItem) => a.position - b.position),
  };
}

export async function createList(
  userId: string,
  name: string,
  type: ListType,
): Promise<List> {
  const { data, error } = await supabase
    .from('lists')
    .insert({ user_id: userId, name, type })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function renameList(listId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('lists')
    .update({ name })
    .eq('id', listId);

  if (error) throw error;
}

export async function deleteList(listId: string): Promise<void> {
  const { error } = await supabase
    .from('lists')
    .delete()
    .eq('id', listId);

  if (error) throw error;
}

export async function setDisplayList(userId: string, listId: string): Promise<void> {
  // Clear any existing display list
  await supabase
    .from('lists')
    .update({ is_display: false })
    .eq('user_id', userId)
    .eq('is_display', true);

  // Set the new one
  const { error } = await supabase
    .from('lists')
    .update({ is_display: true })
    .eq('id', listId);

  if (error) throw error;
}

export async function clearDisplayList(userId: string): Promise<void> {
  const { error } = await supabase
    .from('lists')
    .update({ is_display: false })
    .eq('user_id', userId)
    .eq('is_display', true);

  if (error) throw error;
}

export async function addListItem(
  listId: string,
  itemId: string,
  itemTitle: string,
  itemImage: string | null,
): Promise<ListItem> {
  // Find next available position
  const { data: existing } = await supabase
    .from('list_items')
    .select('position')
    .eq('list_id', listId);

  const used = new Set((existing ?? []).map(e => e.position));
  let position = 0;
  for (let i = 1; i <= 10; i++) {
    if (!used.has(i)) { position = i; break; }
  }
  if (position === 0) throw new Error('List is full (max 10 items)');

  const { data, error } = await supabase
    .from('list_items')
    .insert({
      list_id: listId,
      position,
      item_id: itemId,
      item_title: itemTitle,
      item_image: itemImage,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeListItem(listId: string, itemId: string): Promise<void> {
  const { error } = await supabase
    .from('list_items')
    .delete()
    .eq('list_id', listId)
    .eq('item_id', itemId);

  if (error) throw error;
}

export async function getListsContainingItem(
  userId: string,
  itemId: string,
): Promise<string[]> {
  const { data: userLists } = await supabase
    .from('lists')
    .select('id')
    .eq('user_id', userId);

  if (!userLists || userLists.length === 0) return [];

  const listIds = userLists.map(l => l.id);
  const { data: items } = await supabase
    .from('list_items')
    .select('list_id')
    .eq('item_id', itemId)
    .in('list_id', listIds);

  return (items ?? []).map(i => i.list_id);
}

export async function ensureDefaultList(userId: string): Promise<void> {
  const { count } = await supabase
    .from('lists')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (count === 0) {
    await createList(userId, 'Favorite Shows', 'shows');
  }
}
