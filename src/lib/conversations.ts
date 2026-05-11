import { supabase } from './supabase';
import { buildNameMap } from './utils';
import { getFriends } from './friends';
import type {
  Conversation,
  ConversationPreview,
  ConversationMember,
  Message,
  UserProfile,
} from './types';

// ─── Display Name ─────────────────────────────────────────────────────────────

export function getConversationDisplayName(
  conversation: Conversation,
  memberNames: string[],
  currentUserId: string,
): string {
  if (conversation.name) return conversation.name;
  if (memberNames.length === 0) return 'Chat';
  if (memberNames.length <= 3) return memberNames.join(', ');
  return `${memberNames.slice(0, 2).join(', ')} +${memberNames.length - 2}`;
}

// ─── Create ───────────────────────────────────────────────────────────────────

interface CreateOptions {
  name?: string;
  showId?: string;
  showTitle?: string;
  showImage?: string | null;
  memberIds: string[]; // friend IDs to add/invite
}

export async function createConversation(
  userId: string,
  options: CreateOptions,
): Promise<Conversation> {
  const { name, showId, showTitle, showImage, memberIds } = options;

  // For DMs (1 friend), check if existing conversation exists
  if (memberIds.length === 1 && !showId) {
    const existing = await findExistingDM(userId, memberIds[0]);
    if (existing) {
      const detail = await getConversationDetail(existing);
      return detail;
    }
  }

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      name: name || null,
      show_id: showId || null,
      show_title: showTitle || null,
      show_image: showImage ?? null,
      created_by: userId,
    })
    .select()
    .single();

  if (error) throw error;

  // Add creator as first member. Throw on failure so a broken RLS policy
  // surfaces here instead of silently no-op'ing and cascading into a
  // confusing "no existing member" failure on the friend insert below.
  const { error: creatorErr } = await supabase
    .from('conversation_members')
    .insert({ conversation_id: data.id, user_id: userId });
  if (creatorErr) throw creatorErr;

  // Drop every selected friend straight into conversation_members. The
  // "Members can add accepted friends" RLS policy (migration 057) authorizes
  // the creator (who is a member after the insert above) to add anyone they
  // are friends with — both DM (1 friend) and group (N friends) paths use
  // the same insert. No invite/accept step.
  if (memberIds.length > 0) {
    const memberRows = memberIds.map(friendId => ({
      conversation_id: data.id,
      user_id: friendId,
    }));
    const { error: addError } = await supabase
      .from('conversation_members')
      .insert(memberRows);
    if (addError) throw addError;
  }

  return data;
}

// Add an accepted friend to an existing conversation. Authorized by the
// "Members can add accepted friends" RLS policy — caller must be a current
// member and target must be an accepted friend.
export async function addFriendToConversation(
  conversationId: string,
  friendId: string,
): Promise<void> {
  const { error } = await supabase
    .from('conversation_members')
    .insert({ conversation_id: conversationId, user_id: friendId });
  if (error) throw error;
}

// ─── Find Existing DM ────────────────────────────────────────────────────────

export async function findExistingDM(
  userId: string,
  friendId: string,
): Promise<string | null> {
  // Find conversations where both users are members, no show, and exactly 2 members
  const { data: myConvos } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId);

  if (!myConvos || myConvos.length === 0) return null;

  const myConvoIds = myConvos.map(c => c.conversation_id);

  // Find which of my conversations the friend is also in
  const { data: shared } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', friendId)
    .in('conversation_id', myConvoIds);

  if (!shared || shared.length === 0) return null;

  const sharedIds = shared.map(s => s.conversation_id);

  // Check which of these have no show attached
  const { data: convos } = await supabase
    .from('conversations')
    .select('id')
    .in('id', sharedIds)
    .is('show_id', null);

  if (!convos || convos.length === 0) return null;

  // Batch-fetch all members for candidate conversations instead of querying per-conversation
  const candidateIds = convos.map(c => c.id);
  const { data: allMembers } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .in('conversation_id', candidateIds);

  // Count members per conversation
  const countByConvo = new Map<string, number>();
  for (const m of allMembers ?? []) {
    countByConvo.set(m.conversation_id, (countByConvo.get(m.conversation_id) ?? 0) + 1);
  }

  // Return the first conversation with exactly 2 members (a DM)
  for (const c of convos) {
    if (countByConvo.get(c.id) === 2) return c.id;
  }

  return null;
}

// ─── Friends not in conversation ──────────────────────────────────────────────

export async function getFriendsNotInConversation(
  userId: string,
  conversationId: string,
): Promise<UserProfile[]> {
  const friends = await getFriends(userId);

  const { data: members } = await supabase
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId);

  const memberIds = new Set((members ?? []).map(m => m.user_id));

  return friends
    .filter(f => !memberIds.has(f.user.id))
    .map(f => f.user);
}

// ─── Conversation CRUD ────────────────────────────────────────────────────────

export async function getMyConversations(userId: string): Promise<ConversationPreview[]> {
  const { data: memberships, error } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId);

  if (error) throw error;
  if (!memberships || memberships.length === 0) return [];

  const convIds = memberships.map(m => m.conversation_id);

  const { data: convos, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .in('id', convIds)
    .order('last_message_at', { ascending: false });

  if (convError) throw convError;
  if (!convos || convos.length === 0) return [];

  // Get all members for these conversations
  const { data: allMembers } = await supabase
    .from('conversation_members')
    .select('conversation_id, user_id')
    .in('conversation_id', convIds);

  const memberUserIds = [...new Set((allMembers ?? []).map(m => m.user_id))];

  // last_message sender may be a former member who has since left, so include
  // those user ids in the profile lookup as well.
  const senderUserIds = convos
    .map(c => c.last_message_user_id)
    .filter((uid): uid is string => !!uid);
  const profileIds = [...new Set([...memberUserIds, ...senderUserIds])];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', profileIds);

  const nameMap = buildNameMap(profiles);

  // Build member info per conversation
  const membersByConvo = new Map<string, { names: string[]; count: number }>();
  for (const m of allMembers ?? []) {
    const entry = membersByConvo.get(m.conversation_id) ?? { names: [], count: 0 };
    entry.count++;
    if (m.user_id !== userId) {
      const name = nameMap.get(m.user_id);
      if (name) entry.names.push(name);
    }
    membersByConvo.set(m.conversation_id, entry);
  }

  return convos.map(c => {
    const members = membersByConvo.get(c.id) ?? { names: [], count: 0 };
    return {
      ...c,
      member_names: members.names,
      member_count: members.count,
      last_message: c.last_message_text ?? null,
      last_message_sender: c.last_message_user_id
        ? (nameMap.get(c.last_message_user_id) ?? null)
        : null,
    };
  });
}

export async function getConversationDetail(conversationId: string): Promise<Conversation> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  if (error) throw error;
  return data;
}

export async function getConversationMembers(
  conversationId: string,
  showId?: string | null,
): Promise<ConversationMember[]> {
  const { data: members, error } = await supabase
    .from('conversation_members')
    .select('user_id, joined_at, muted, last_active_at')
    .eq('conversation_id', conversationId);

  if (error) throw error;
  if (!members || members.length === 0) return [];

  const userIds = members.map(m => m.user_id);

  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', userIds);

  const profileMap = new Map<string, { display_name: string; username: string; avatar_url: string | null }>();
  for (const p of profiles ?? []) profileMap.set(p.id, { display_name: p.display_name, username: p.username, avatar_url: p.avatar_url });

  // Only fetch show progress if a show is attached
  const progressMap = new Map<string, { season: number; episode: number; status: string | null }>();
  if (showId) {
    const { data: showProgress } = await supabase
      .from('user_shows')
      .select('user_id, current_season, current_episode, status')
      .eq('show_id', showId)
      .in('user_id', userIds);

    for (const s of showProgress ?? []) {
      progressMap.set(s.user_id, { season: s.current_season, episode: s.current_episode, status: s.status });
    }
  }

  return members.map(m => {
    const profile = profileMap.get(m.user_id);
    const progress = progressMap.get(m.user_id);
    return {
      conversation_id: conversationId,
      user_id: m.user_id,
      joined_at: m.joined_at,
      display_name: profile?.display_name ?? 'Unknown',
      username: profile?.username ?? 'unknown',
      avatar_url: profile?.avatar_url ?? null,
      current_season: progress?.season ?? 0,
      current_episode: progress?.episode ?? 0,
      show_status: (progress?.status as import('./types').WatchStatus) ?? null,
      muted: m.muted ?? false,
      last_active_at: m.last_active_at ?? null,
    };
  });
}

// ─── Spoiler Lock ─────────────────────────────────────────────────────────────

export function getFrontRunner(members: ConversationMember[]): { season: number; episode: number } {
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

export async function toggleSpoilerLock(conversationId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ spoiler_lock: enabled })
    .eq('id', conversationId);

  if (error) throw error;
}

// Per-chat mute. Stored on conversation_members so each member's preference
// is independent. notify-message Edge Function reads this column.
export async function setConversationMuted(
  conversationId: string,
  userId: string,
  muted: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('conversation_members')
    .update({ muted })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);

  if (error) throw error;
}

// Bump last_active_at — chat detail screen calls this on focus and on send.
// notify-message uses the timestamp to suppress pushes for members currently
// in the chat (within ~30s).
export async function bumpLastActive(
  conversationId: string,
  userId: string,
): Promise<void> {
  await supabase
    .from('conversation_members')
    .update({ last_active_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
}

// ─── Show Management ──────────────────────────────────────────────────────────

export async function attachShow(
  conversationId: string,
  showId: string,
  showTitle: string,
  showImage: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ show_id: showId, show_title: showTitle, show_image: showImage })
    .eq('id', conversationId);

  if (error) throw error;
}

export async function detachShow(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ show_id: null, show_title: null, show_image: null, spoiler_lock: false })
    .eq('id', conversationId);

  if (error) throw error;
}

export async function renameConversation(conversationId: string, name: string | null): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ name })
    .eq('id', conversationId);

  if (error) throw error;
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function getMessages(
  conversationId: string,
  limit = 50,
  before?: string,
): Promise<Message[]> {
  let query = supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data: messages, error } = await query;
  if (error) throw error;
  if (!messages || messages.length === 0) return [];

  const senderIds = [...new Set(messages.map(m => m.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', senderIds);

  const profileMap = new Map<string, { display_name: string; avatar_url: string | null }>();
  for (const p of profiles ?? []) profileMap.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });

  return messages.map(m => {
    const profile = profileMap.get(m.user_id);
    return {
      id: m.id,
      conversation_id: m.conversation_id,
      user_id: m.user_id,
      message: m.message,
      gif_url: m.gif_url ?? null,
      created_at: m.created_at,
      sender_name: profile?.display_name ?? 'Unknown',
      sender_avatar: profile?.avatar_url ?? null,
    };
  });
}

export async function sendMessage(
  conversationId: string,
  userId: string,
  message?: string,
  gifUrl?: string,
): Promise<Message> {
  const trimmed = message?.trim() || null;

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      message: trimmed,
      gif_url: gifUrl ?? null,
    })
    .select()
    .single();

  if (error) throw error;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', userId)
    .single();

  const msg: Message = {
    id: data.id,
    conversation_id: data.conversation_id,
    user_id: data.user_id,
    message: data.message,
    gif_url: data.gif_url ?? null,
    created_at: data.created_at,
    sender_name: profile?.display_name ?? 'Unknown',
    sender_avatar: profile?.avatar_url ?? null,
  };

  supabase
    .channel(`chat-${conversationId}`)
    .send({
      type: 'broadcast',
      event: 'new_message',
      payload: msg,
    });

  // Fire-and-forget push notification fanout. The Edge Function filters by
  // master toggle / per-chat mute / last_active_at server-side, so this is
  // unconditional from the sender's perspective. Errors are swallowed —
  // missing one notification is preferable to blocking the send path.
  supabase.functions.invoke('notify-message', { body: { message_id: msg.id } })
    .catch(() => {});

  return msg;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function leaveConversation(
  userId: string,
  conversationId: string,
): Promise<void> {
  const { error } = await supabase
    .from('conversation_members')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);

  if (error) throw error;
}

export async function getMemberCount(conversationId: string): Promise<number> {
  const { count, error } = await supabase
    .from('conversation_members')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);

  if (error) throw error;
  return count ?? 0;
}
