// Supabase Edge Function: Push-notify the recipient of a chat invite.
// Deploy: supabase functions deploy notify-invite
//
// Invoked from the client right after sendConversationInvite. The SDK
// attaches the inviter's JWT — we verify they're the recorded `invited_by`
// before firing the push (so a token holder can't spam invites they didn't
// actually send).
//
// Recipient eligibility: invitee's profile.push_chat_messages must be true.
// We don't apply the conversation_members.muted check here because they
// aren't a member yet.

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

  let payload: { invite_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!payload.invite_id) return json({ error: 'Missing invite_id' }, 400);

  const { data: invite, error: inviteErr } = await admin
    .from('conversation_invites')
    .select('id, conversation_id, invited_by, invited_user, status')
    .eq('id', payload.invite_id)
    .single();
  if (inviteErr || !invite) return json({ error: 'Invite not found' }, 404);
  if (invite.invited_by !== callerId) return json({ error: 'Not your invite' }, 403);
  if (invite.status !== 'pending') return json({ ok: true, sent: 0, reason: 'not pending' });

  const { data: inviterProfile } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', callerId)
    .single();
  const inviterName = inviterProfile?.display_name || 'Someone';

  const { data: conversation } = await admin
    .from('conversations')
    .select('name')
    .eq('id', invite.conversation_id)
    .single();

  // Master-toggle gate.
  const { data: invitee } = await admin
    .from('profiles')
    .select('id, push_chat_messages')
    .eq('id', invite.invited_user)
    .single();
  if (!invitee || !invitee.push_chat_messages) return json({ ok: true, sent: 0 });

  const { data: tokens } = await admin
    .from('push_tokens')
    .select('expo_push_token')
    .eq('user_id', invite.invited_user);
  if (!tokens || tokens.length === 0) return json({ ok: true, sent: 0 });

  const convoLabel = conversation?.name ? `"${conversation.name}"` : 'a chat';
  const notifications = tokens.map(t => ({
    to: t.expo_push_token,
    title: 'New invite',
    body: `${inviterName} invited you to ${convoLabel}`,
    data: { type: 'invite', conversation_id: invite.conversation_id },
    threadId: invite.conversation_id,
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
    console.error('notify-invite: Expo push send failed', pushRes.status, errBody);
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
