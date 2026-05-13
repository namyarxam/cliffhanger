// Supabase Edge Function: Push-notify a user that someone sent them a
// friend request (or accepted theirs, in the auto-accept mutual case).
// Deploy: supabase functions deploy notify-friend-request
//
// Invoked from the client via supabase.functions.invoke('notify-friend-request',
// { body: { friendship_id } }) right after sendFriendRequest succeeds. The
// SDK attaches the sender's JWT in the Authorization header.
//
// Trust model: anyone with a valid JWT can call us with any friendship_id.
// We re-fetch the row and verify the JWT-user is its `user_id` (the sender)
// — so a caller can only fire notifications about requests they sent.
//
// Auto-accept case (mutual request): the original recipient is now the
// "friend_id" on the row, but its `user_id` is them too. We detect this by
// reading the status: if 'accepted' on insert-time invoke, it means we
// flipped the existing row in sendFriendRequest — push to the OTHER user
// with an "accepted" copy.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface PushTicket {
  status: string;
  details?: { error?: string; expoPushToken?: string };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const token = authHeader.replace('Bearer ', '');
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: 'Invalid session' }, 401);
  const callerId = userData.user.id;

  let payload: { friendship_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!payload.friendship_id) return json({ error: 'Missing friendship_id' }, 400);

  const { data: friendship, error: fErr } = await admin
    .from('friendships')
    .select('id, user_id, friend_id, status')
    .eq('id', payload.friendship_id)
    .single();
  if (fErr || !friendship) return json({ error: 'Friendship not found' }, 404);

  // Determine recipient + body based on the row state. Two valid cases:
  //   1. status=pending, caller is the sender (user_id) → notify friend_id
  //      with "wants to be your friend".
  //   2. status=accepted, caller is the original recipient (friend_id) →
  //      notify the original sender (user_id) with "accepted your request".
  let recipientId: string;
  let isAccept: boolean;
  if (friendship.status === 'pending' && friendship.user_id === callerId) {
    recipientId = friendship.friend_id;
    isAccept = false;
  } else if (friendship.status === 'accepted' && friendship.friend_id === callerId) {
    recipientId = friendship.user_id;
    isAccept = true;
  } else {
    return json({ error: 'Not authorized for this friendship row' }, 403);
  }

  const { data: senderProfile } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', callerId)
    .single();
  const senderName = senderProfile?.display_name || 'Someone';

  // Recipient's master toggle gate.
  const { data: recipProfile } = await admin
    .from('profiles')
    .select('id, push_friend_requests')
    .eq('id', recipientId)
    .single();
  if (!recipProfile?.push_friend_requests) return json({ ok: true, sent: 0 });

  const { data: tokens } = await admin
    .from('push_tokens')
    .select('expo_push_token')
    .eq('user_id', recipientId);
  if (!tokens || tokens.length === 0) return json({ ok: true, sent: 0 });

  const title = isAccept ? `${senderName} accepted your friend request` : `${senderName} added you as a friend`;
  const body = isAccept ? "You're friends now — tap to view their profile." : 'Tap to view their request.';

  const notifications = tokens.map(t => ({
    to: t.expo_push_token,
    title,
    body,
    data: { type: 'friend_request', user_id: callerId },
    sound: 'default' as const,
  }));

  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  const pushHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (expoToken) pushHeaders['Authorization'] = `Bearer ${expoToken}`;

  const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: pushHeaders,
    body: JSON.stringify(notifications),
  });

  if (!pushRes.ok) {
    const errBody = await pushRes.text();
    console.error('notify-friend-request: Expo push send failed', pushRes.status, errBody);
    return json({ ok: false, expo_status: pushRes.status, expo_body: errBody }, 502);
  }

  const pushBody = await pushRes.json();
  const tickets: PushTicket[] = pushBody?.data ?? [];
  const deadTokens: string[] = [];
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    if (t?.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
      const tk = t.details.expoPushToken ?? notifications[i]?.to;
      if (tk) deadTokens.push(tk);
    }
  }
  if (deadTokens.length > 0) {
    await admin.from('push_tokens').delete().in('expo_push_token', deadTokens);
  }

  return json({ ok: true, sent: notifications.length });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
