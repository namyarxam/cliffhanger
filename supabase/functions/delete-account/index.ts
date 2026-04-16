// Supabase Edge Function: Delete the calling user's account and cascade their data.
// Deploy: supabase functions deploy delete-account
//
// Client invokes via supabase.functions.invoke('delete-account') — the SDK
// attaches the user's JWT in the Authorization header automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const token = authHeader.replace('Bearer ', '');
  const adminClient = createClient(supabaseUrl, serviceKey);

  const { data: userData, error: userErr } = await adminClient.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: 'Invalid session', detail: userErr?.message }, 401);

  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userData.user.id);
  if (deleteErr) return json({ error: 'Delete failed', detail: deleteErr.message }, 500);

  return json({ ok: true }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
