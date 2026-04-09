import { supabase } from './supabase';
import type { TopShow } from './types';

export async function getTopShows(userId: string): Promise<TopShow[]> {
  const { data, error } = await supabase
    .from('top_shows')
    .select('*')
    .eq('user_id', userId)
    .order('position', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function addTopShow(
  userId: string,
  showId: string,
  showTitle: string,
  showImage: string | null,
): Promise<void> {
  // Find next available position (1-4)
  const existing = await getTopShows(userId);

  if (existing.length >= 4) {
    throw new Error('Top 4 is full — remove a show first');
  }

  // Check if already in top 4
  if (existing.some(s => s.show_id === showId)) {
    throw new Error('Already in your Top 4');
  }

  const usedPositions = new Set(existing.map(s => s.position));
  let nextPosition = 0;
  for (let i = 1; i <= 4; i++) {
    if (!usedPositions.has(i)) {
      nextPosition = i;
      break;
    }
  }

  const { error } = await supabase
    .from('top_shows')
    .insert({
      user_id: userId,
      position: nextPosition,
      show_id: showId,
      show_title: showTitle,
      show_image: showImage,
    });

  if (error) throw error;
}

export async function removeTopShow(userId: string, showId: string): Promise<void> {
  const { error } = await supabase
    .from('top_shows')
    .delete()
    .eq('user_id', userId)
    .eq('show_id', showId);

  if (error) throw error;
}

export async function isInTopShows(userId: string, showId: string): Promise<boolean> {
  const { data } = await supabase
    .from('top_shows')
    .select('position')
    .eq('user_id', userId)
    .eq('show_id', showId)
    .maybeSingle();

  return data != null;
}
