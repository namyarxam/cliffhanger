import { supabase } from './supabase';
import type { UserProfile } from './types';

export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'other';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'other', label: 'Something else' },
];

// ─── Blocks ──────────────────────────────────────────────────────────────────

/**
 * Block another user. Side-effects:
 *   - insert into blocks
 *   - delete any friendship between the two (in either direction)
 *   - delete any DM conversation between the two (2-member, no show attached)
 */
export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw new Error('Cannot block yourself');

  const { error: insertError } = await supabase
    .from('blocks')
    .insert({ blocker_id: blockerId, blocked_id: blockedId });
  if (insertError) throw insertError;

  // Drop any friendship between the two
  await supabase
    .from('friendships')
    .delete()
    .or(
      `and(user_id.eq.${blockerId},friend_id.eq.${blockedId}),and(user_id.eq.${blockedId},friend_id.eq.${blockerId})`,
    );

  // Delete DM conversations (2-member, no show) between the two
  const { data: myMembers } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', blockerId);

  const convoIds = (myMembers ?? []).map(m => m.conversation_id);
  if (convoIds.length === 0) return;

  const { data: candidates } = await supabase
    .from('conversations')
    .select('id, conversation_members(user_id)')
    .in('id', convoIds)
    .is('show_id', null);

  const dmIds = (candidates ?? [])
    .filter((c: any) => {
      const memberIds: string[] = c.conversation_members.map((m: any) => m.user_id);
      return memberIds.length === 2 && memberIds.includes(blockedId);
    })
    .map((c: any) => c.id);

  if (dmIds.length > 0) {
    await supabase.from('conversations').delete().in('id', dmIds);
  }
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
  if (error) throw error;
}

/** Returns the profiles of users the current user has blocked. */
export async function getBlockedUsers(blockerId: string): Promise<UserProfile[]> {
  const { data: rows, error: blocksError } = await supabase
    .from('blocks')
    .select('blocked_id')
    .eq('blocker_id', blockerId);
  if (blocksError) throw blocksError;
  const ids = (rows ?? []).map(r => r.blocked_id);
  if (ids.length === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('*')
    .in('id', ids);
  if (profilesError) throw profilesError;
  return profiles ?? [];
}

/** Lightweight version: returns just the set of user IDs the current user has blocked. */
export async function getBlockedIds(blockerId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('blocks')
    .select('blocked_id')
    .eq('blocker_id', blockerId);
  if (error) throw error;
  return new Set((data ?? []).map(r => r.blocked_id));
}

export async function isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('blocks')
    .select('blocked_id')
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export async function reportUser(
  reporterId: string,
  targetUserId: string,
  reason: ReportReason,
  details?: string,
): Promise<void> {
  const { error } = await supabase
    .from('reports')
    .insert({
      reporter_id: reporterId,
      target_user_id: targetUserId,
      reason,
      details: details?.trim() || null,
    });
  if (error) throw error;
}

