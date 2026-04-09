import { supabase } from './supabase';
import type { Group, GroupMember, GroupMessage } from './types';

export async function createGroup(
  userId: string,
  name: string,
  showId: string,
  showTitle: string,
  showImage: string | null,
): Promise<Group> {
  const { data, error } = await supabase
    .from('groups')
    .insert({
      name,
      show_id: showId,
      show_title: showTitle,
      show_image: showImage,
      created_by: userId,
    })
    .select()
    .single();

  if (error) throw error;

  // Add creator as first member
  await supabase
    .from('group_members')
    .insert({ group_id: data.id, user_id: userId });

  return data;
}

export async function joinGroup(
  userId: string,
  inviteCode: string,
): Promise<Group> {
  // Look up group by invite code
  const { data: group, error: lookupError } = await supabase
    .from('groups')
    .select('*')
    .eq('invite_code', inviteCode.trim().toLowerCase())
    .single();

  if (lookupError || !group) throw new Error('Invalid invite code');

  // Check if already a member
  const { data: existing } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('group_id', group.id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabase
      .from('group_members')
      .insert({ group_id: group.id, user_id: userId });

    if (error) throw error;
  }

  return group;
}

export async function getMyGroups(userId: string): Promise<Group[]> {
  const { data, error } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId);

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const groupIds = data.map(d => d.group_id);

  const { data: groups, error: groupsError } = await supabase
    .from('groups')
    .select('*')
    .in('id', groupIds)
    .order('created_at', { ascending: false });

  if (groupsError) throw groupsError;
  return groups ?? [];
}

export async function getGroupDetail(groupId: string): Promise<Group> {
  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();

  if (error) throw error;
  return data;
}

export async function getGroupMembers(
  groupId: string,
  showId: string,
): Promise<GroupMember[]> {
  // Get member user IDs
  const { data: members, error } = await supabase
    .from('group_members')
    .select('user_id, joined_at')
    .eq('group_id', groupId);

  if (error) throw error;
  if (!members || members.length === 0) return [];

  const userIds = members.map(m => m.user_id);

  // Get profiles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', userIds);

  // Get show progress
  const { data: showProgress } = await supabase
    .from('user_shows')
    .select('user_id, current_season, current_episode')
    .eq('show_id', showId)
    .in('user_id', userIds);

  const profileMap = new Map<string, { display_name: string; avatar_url: string | null }>();
  for (const p of profiles ?? []) {
    profileMap.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });
  }

  const progressMap = new Map<string, { season: number; episode: number }>();
  for (const s of showProgress ?? []) {
    progressMap.set(s.user_id, { season: s.current_season, episode: s.current_episode });
  }

  return members.map(m => {
    const profile = profileMap.get(m.user_id);
    const progress = progressMap.get(m.user_id);
    return {
      group_id: groupId,
      user_id: m.user_id,
      joined_at: m.joined_at,
      display_name: profile?.display_name ?? 'Unknown',
      avatar_url: profile?.avatar_url ?? null,
      current_season: progress?.season ?? 0,
      current_episode: progress?.episode ?? 0,
    };
  });
}

export function getFrontRunner(members: GroupMember[]): { season: number; episode: number } {
  let maxSeason = 0;
  let maxEpisode = 0;

  for (const m of members) {
    if (
      m.current_season > maxSeason ||
      (m.current_season === maxSeason && m.current_episode > maxEpisode)
    ) {
      maxSeason = m.current_season;
      maxEpisode = m.current_episode;
    }
  }

  return { season: maxSeason, episode: maxEpisode };
}

export function isCaughtUp(
  userSeason: number,
  userEpisode: number,
  frontSeason: number,
  frontEpisode: number,
): boolean {
  if (frontSeason === 0 && frontEpisode === 0) return true;
  return (
    userSeason > frontSeason ||
    (userSeason === frontSeason && userEpisode >= frontEpisode)
  );
}

export async function getGroupMessages(
  groupId: string,
  limit = 50,
  before?: string,
): Promise<GroupMessage[]> {
  let query = supabase
    .from('group_messages')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data: messages, error } = await query;
  if (error) throw error;
  if (!messages || messages.length === 0) return [];

  // Get sender profiles
  const senderIds = [...new Set(messages.map(m => m.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', senderIds);

  const profileMap = new Map<string, { display_name: string; avatar_url: string | null }>();
  for (const p of profiles ?? []) {
    profileMap.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });
  }

  return messages.map(m => {
    const profile = profileMap.get(m.user_id);
    return {
      id: m.id,
      group_id: m.group_id,
      user_id: m.user_id,
      message: m.message,
      created_at: m.created_at,
      sender_name: profile?.display_name ?? 'Unknown',
      sender_avatar: profile?.avatar_url ?? null,
    };
  });
}

export async function sendMessage(
  groupId: string,
  userId: string,
  message: string,
): Promise<void> {
  const { error } = await supabase
    .from('group_messages')
    .insert({
      group_id: groupId,
      user_id: userId,
      message: message.trim(),
    });

  if (error) throw error;
}

export async function leaveGroup(
  userId: string,
  groupId: string,
): Promise<void> {
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);

  if (error) throw error;
}

export async function toggleSpoilerLock(groupId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('groups')
    .update({ spoiler_lock: enabled })
    .eq('id', groupId);

  if (error) throw error;
}

export async function getMemberCount(groupId: string): Promise<number> {
  const { count, error } = await supabase
    .from('group_members')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', groupId);

  if (error) return 0;
  return count ?? 0;
}
