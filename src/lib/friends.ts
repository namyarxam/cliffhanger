import { supabase } from './supabase';
import { buildMap } from './utils';
import type { UserProfile, FriendWithProfile, Friendship } from './types';

const SEARCH_RESULTS_LIMIT = 20;

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
    .limit(SEARCH_RESULTS_LIMIT);

  if (error) throw error;
  return data ?? [];
}

// Fire-and-forget push trigger. Errors are swallowed locally so a push
// failure never blocks the friend request itself — the Edge Function logs
// to Supabase logs + Sentry catches its own.
async function notifyFriendRequest(friendshipId: string): Promise<void> {
  try {
    await supabase.functions.invoke('notify-friend-request', {
      body: { friendship_id: friendshipId },
    });
  } catch {
    // Intentionally silent — see comment above.
  }
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
    // Mutual request — accept it. Push the original sender that we accepted.
    await supabase
      .from('friendships')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    notifyFriendRequest(existing.id);
    return;
  }

  if (existing && existing.status === 'accepted') {
    return; // Already friends
  }

  const { data: inserted, error } = await supabase
    .from('friendships')
    .insert({ user_id: userId, friend_id: friendId })
    .select('id')
    .single();

  if (error) throw error;
  if (inserted?.id) notifyFriendRequest(inserted.id);
}

export async function acceptFriendRequest(friendshipId: string): Promise<void> {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', friendshipId);

  if (error) throw error;
  // Notify the original sender that their request was accepted.
  notifyFriendRequest(friendshipId);
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

  const profileMap = buildMap(profiles);

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

/**
 * Just the number, for the tab badge. A HEAD request with count — zero rows
 * over the wire, where the badge poll used to pull every request row (and
 * its profile joins) only to take .length.
 */
export async function getPendingRequestCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('friendships')
    .select('*', { count: 'exact', head: true })
    .eq('friend_id', userId)
    .eq('status', 'pending');

  if (error) throw error;
  return count ?? 0;
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

  const profileMap = buildMap(profiles);

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
