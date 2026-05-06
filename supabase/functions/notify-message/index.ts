// Supabase Edge Function: Push-notify chat-conversation members about a new message.
// Deploy: supabase functions deploy notify-message
//
// Invoked from the client via supabase.functions.invoke('notify-message',
// { body: { message_id } }) right after a successful sendMessage. The SDK
// attaches the sender's JWT in the Authorization header.
//
// Recipients are filtered by:
//   - not the sender
//   - profiles.push_chat_messages = true (master toggle)
//   - conversation_members.muted = false (per-chat mute)
//   - conversation_members.last_active_at < now - 30s (don't push if they're
//     literally in this chat right now)
//
// Trust model: anyone with a valid JWT can call us with any message_id.
// We re-fetch the message and verify the JWT-user is its `user_id` — so a
// caller can only fire notifications about messages they themselves sent.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ACTIVE_WINDOW_MS = 30 * 1000;
const PREVIEW_LEN = 140;

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

  let payload: { message_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!payload.message_id) return json({ error: 'Missing message_id' }, 400);

  // Fetch the message and verify the caller authored it. Stops a token
  // holder from firing pushes about other people's messages.
  const { data: msg, error: msgErr } = await admin
    .from('messages')
    .select('id, conversation_id, user_id, message, gif_url')
    .eq('id', payload.message_id)
    .single();
  if (msgErr || !msg) return json({ error: 'Message not found' }, 404);
  if (msg.user_id !== callerId) return json({ error: 'Not your message' }, 403);

  // Sender's display name for the notification title.
  const { data: senderProfile } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', callerId)
    .single();
  const senderName = senderProfile?.display_name || 'Someone';

  // Conversation name (used for group chats; DMs lean on senderName instead).
  const { data: conversation } = await admin
    .from('conversations')
    .select('name')
    .eq('id', msg.conversation_id)
    .single();

  // Eligible recipients: members of this conversation who aren't the sender,
  // aren't muted on this chat, and weren't active in it in the last 30s.
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
  const { data: members } = await admin
    .from('conversation_members')
    .select('user_id, muted, last_active_at')
    .eq('conversation_id', msg.conversation_id)
    .neq('user_id', callerId)
    .eq('muted', false);

  const candidateIds = (members ?? [])
    .filter(m => !m.last_active_at || m.last_active_at < cutoff)
    .map(m => m.user_id);
  if (candidateIds.length === 0) return json({ ok: true, sent: 0 });

  // Filter to those who have the master toggle on.
  const { data: profiles } = await admin
    .from('profiles')
    .select('id')
    .in('id', candidateIds)
    .eq('push_chat_messages', true);
  const eligibleIds = (profiles ?? []).map(p => p.id);
  if (eligibleIds.length === 0) return json({ ok: true, sent: 0 });

  const { data: tokens } = await admin
    .from('push_tokens')
    .select('user_id, expo_push_token')
    .in('user_id', eligibleIds);
  if (!tokens || tokens.length === 0) return json({ ok: true, sent: 0 });

  const isGroup = !!conversation?.name;
  const title = isGroup ? `${senderName} in ${conversation!.name}` : senderName;
  const body = msg.gif_url
    ? '[GIF]'
    : (msg.message ?? '').slice(0, PREVIEW_LEN);

  const notifications = tokens.map(t => ({
    to: t.expo_push_token,
    title,
    body,
    data: { type: 'chat', conversation_id: msg.conversation_id },
    // iOS thread identifier groups multiple messages from the same chat into
    // one notification stack — same UX as iMessage.
    threadId: msg.conversation_id,
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
    // Most common cause of a non-2xx here is Expo Enhanced Push Security
    // rejecting the request — either EXPO_ACCESS_TOKEN is unset, expired,
    // or scoped to the wrong project. Log the body so the failure mode
    // shows up in supabase functions logs instead of silently no-op'ing.
    const errBody = await pushRes.text();
    console.error('notify-message: Expo push send failed', pushRes.status, errBody);
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
