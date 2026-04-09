import { supabase } from './supabase';
import type { UserProfile, FriendWithProfile, Friendship } from './types';

export async function searchUsers(
  query: string,
  currentUserId: string,
): Promise<UserProfile[]> {
  if (!query.trim()) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .ilike('username', `%${query.trim()}%`)
    .neq('id', currentUserId)
    .limit(20);

  if (error) throw error;
  return data ?? [];
}

export async function sendFriendRequest(
  userId: string,
  friendId: string,
): Promise<void> {
  // Check if the other person already sent us a request — auto-accept
  const { data: existing } = await supabase
    .from('friendships')
    .select('*')
    .eq('user_id', friendId)
    .eq('friend_id', userId)
    .maybeSingle();

  if (existing && existing.status === 'pending') {
    // Mutual request — accept it
    await supabase
      .from('friendships')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    return;
  }

  if (existing && existing.status === 'accepted') {
    return; // Already friends
  }

  const { error } = await supabase
    .from('friendships')
    .insert({ user_id: userId, friend_id: friendId });

  if (error) throw error;
}

export async function acceptFriendRequest(friendshipId: string): Promise<void> {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', friendshipId);

  if (error) throw error;
}

export async function removeFriend(friendshipId: string): Promise<void> {
  const { error } = await supabase
    .from('friendships')
    .delete()
    .eq('id', friendshipId);

  if (error) throw error;
}

export async function getFriends(userId: string): Promise<FriendWithProfile[]> {
  // Get all accepted friendships where I'm either party
  const { data: friendships, error } = await supabase
    .from('friendships')
    .select('*')
    .eq('status', 'accepted')
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);

  if (error) throw error;
  if (!friendships || friendships.length === 0) return [];

  // Collect the other user's ID for each friendship
  const otherIds = friendships.map((f: Friendship) =>
    f.user_id === userId ? f.friend_id : f.user_id
  );

  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', otherIds);

  const profileMap = new Map<string, UserProfile>();
  for (const p of profiles ?? []) {
    profileMap.set(p.id, p);
  }

  return friendships
    .map((f: Friendship) => {
      const otherId = f.user_id === userId ? f.friend_id : f.user_id;
      const profile = profileMap.get(otherId);
      if (!profile) return null;
      return {
        friendship_id: f.id,
        user: profile,
        status: f.status,
        is_incoming: f.friend_id === userId,
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null) as FriendWithProfile[];
}

export async function getPendingRequests(
  userId: string,
): Promise<FriendWithProfile[]> {
  // Incoming requests: where I'm friend_id and status is pending
  const { data: friendships, error } = await supabase
    .from('friendships')
    .select('*')
    .eq('friend_id', userId)
    .eq('status', 'pending');

  if (error) throw error;
  if (!friendships || friendships.length === 0) return [];

  const senderIds = friendships.map((f: Friendship) => f.user_id);

  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', senderIds);

  const profileMap = new Map<string, UserProfile>();
  for (const p of profiles ?? []) {
    profileMap.set(p.id, p);
  }

  return friendships
    .map((f: Friendship) => {
      const profile = profileMap.get(f.user_id);
      if (!profile) return null;
      return {
        friendship_id: f.id,
        user: profile,
        status: f.status,
        is_incoming: true,
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null) as FriendWithProfile[];
}

export async function getFriendshipStatus(
  userId: string,
  otherId: string,
): Promise<{ friendship_id: string; status: string; is_incoming: boolean } | null> {
  // Check both directions
  const { data } = await supabase
    .from('friendships')
    .select('*')
    .or(
      `and(user_id.eq.${userId},friend_id.eq.${otherId}),and(user_id.eq.${otherId},friend_id.eq.${userId})`
    )
    .maybeSingle();

  if (!data) return null;

  return {
    friendship_id: data.id,
    status: data.status,
    is_incoming: data.friend_id === userId,
  };
}
