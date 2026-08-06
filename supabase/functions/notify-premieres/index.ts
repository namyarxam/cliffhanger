// Supabase Edge Function: push "your show is coming back" the week a new
// season of a tracked show premieres. Replaces the per-episode push system.
//
// Deploy:   supabase functions deploy notify-premieres
// Schedule: daily cron (see migration 072) — the 7-day window plus a
//           once-per-(user,show,season) stamp means overlapping or missed
//           runs change WHEN the push lands, never WHETHER it duplicates.
//
// Detection reads only the `shows` table, which refresh-show-metadata keeps
// fresh. A qualifying premiere is:
//   - next_episode_episode = 1                      (a season opener)
//   - next season > last aired season, or nothing   (returning from hiatus,
//     aired at all                                   or a brand-new show)
//   - airdate within [today, today+6]               ("the week of")
//
// Everyone with a non-muted user_shows row for the show gets it. No opt-in,
// no opt-out flag — this is the one notification the app considers core.
// Stamps are written per-user only after Expo accepts that user's messages;
// users without a push token are left unstamped so registering a device
// mid-week still gets them the push.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface PremiereShow {
  show_id: string;
  show_title: string | null;
  next_episode_season: number;
  next_episode_airdate: string;
}

interface PushTicket {
  status: string;
  details?: { error?: string; expoPushToken?: string };
}

const EXPO_BATCH = 100; // Expo push API hard limit per request

function premiereDayLabel(airdate: string, today: string): string {
  if (airdate === today) return 'today';
  const d = new Date(airdate + 'T00:00:00Z');
  const diffDays = Math.round((d.getTime() - new Date(today + 'T00:00:00Z').getTime()) / 86_400_000);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  return diffDays === 1 ? 'tomorrow' : weekday;
}

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (!expoToken) {
    // Fail loud and send nothing: Enhanced Push Security rejects
    // unauthenticated sends, and a half-configured run must not stamp.
    return json({ ok: false, error: 'EXPO_ACCESS_TOKEN not set' }, 500);
  }

  const today = new Date().toISOString().split('T')[0];
  const windowEnd = new Date(Date.now() + 6 * 86_400_000).toISOString().split('T')[0];

  try {
    // 1. Season premieres inside the window. last_aired guard in JS — the
    //    "or never aired" arm reads clearer than a PostgREST or-filter.
    const { data: candidates, error: showErr } = await supabase
      .from('shows')
      .select('show_id, show_title, next_episode_season, next_episode_episode, next_episode_airdate, last_aired_season')
      .eq('next_episode_episode', 1)
      .gte('next_episode_airdate', today)
      .lte('next_episode_airdate', windowEnd);
    if (showErr) throw showErr;

    const premieres: PremiereShow[] = (candidates ?? [])
      .filter(s =>
        s.next_episode_season != null &&
        (s.last_aired_season == null || s.next_episode_season > s.last_aired_season))
      .map(s => ({
        show_id: s.show_id,
        show_title: s.show_title,
        next_episode_season: s.next_episode_season,
        next_episode_airdate: s.next_episode_airdate,
      }));

    if (premieres.length === 0) return json({ ok: true, premieres: 0, sent: 0 });

    const showIds = premieres.map(p => p.show_id);
    const byShow = new Map(premieres.map(p => [p.show_id, p]));

    // 2. Everyone tracking those shows, muted excluded.
    const { data: trackers, error: trackErr } = await supabase
      .from('user_shows')
      .select('user_id, show_id, status')
      .in('show_id', showIds)
      .neq('status', 'muted');
    if (trackErr) throw trackErr;
    if (!trackers || trackers.length === 0) return json({ ok: true, premieres: premieres.length, sent: 0 });

    // 3. Drop (user, show, season) pairs already stamped.
    const { data: stamps, error: stampErr } = await supabase
      .from('premiere_notifications')
      .select('user_id, show_id, season')
      .in('show_id', showIds);
    if (stampErr) throw stampErr;
    const stamped = new Set((stamps ?? []).map(s => `${s.user_id}|${s.show_id}|${s.season}`));

    const pending = trackers.filter(t => {
      const p = byShow.get(t.show_id)!;
      return !stamped.has(`${t.user_id}|${t.show_id}|${p.next_episode_season}`);
    });
    if (pending.length === 0) return json({ ok: true, premieres: premieres.length, sent: 0 });

    // 4. Tokens for the pending users.
    const userIds = [...new Set(pending.map(t => t.user_id))];
    const { data: tokens, error: tokErr } = await supabase
      .from('push_tokens')
      .select('user_id, expo_push_token')
      .in('user_id', userIds);
    if (tokErr) throw tokErr;
    const tokensByUser = new Map<string, string[]>();
    for (const t of tokens ?? []) {
      const list = tokensByUser.get(t.user_id) ?? [];
      list.push(t.expo_push_token);
      tokensByUser.set(t.user_id, list);
    }

    // 5. Build messages. One per device; stamp bookkeeping per (user, show).
    const messages: { to: string; title: string; body: string; sound: 'default'; data: Record<string, string> }[] = [];
    const toStamp: { user_id: string; show_id: string; season: number }[] = [];

    for (const t of pending) {
      const p = byShow.get(t.show_id)!;
      const deviceTokens = tokensByUser.get(t.user_id);
      if (!deviceTokens?.length) continue; // no device — leave unstamped, window may still catch them

      const title = p.next_episode_season === 1
        ? `${p.show_title ?? 'A show you track'} premieres soon`
        : `${p.show_title ?? 'A show you track'} is back`;
      const body = `Season ${p.next_episode_season} premieres ${premiereDayLabel(p.next_episode_airdate, today)}.`;

      for (const token of deviceTokens) {
        messages.push({
          to: token,
          title,
          body,
          sound: 'default',
          data: { type: 'show_premiere', show_id: t.show_id },
        });
      }
      toStamp.push({ user_id: t.user_id, show_id: t.show_id, season: p.next_episode_season });
    }
    if (messages.length === 0) return json({ ok: true, premieres: premieres.length, sent: 0 });

    // 6. Send in Expo-sized batches. A failed batch aborts before stamping —
    //    those users simply retry on the next run.
    const deadTokens: string[] = [];
    for (let i = 0; i < messages.length; i += EXPO_BATCH) {
      const batch = messages.slice(i, i + EXPO_BATCH);
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${expoToken}`,
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.error('notify-premieres: Expo send failed', res.status, await res.text());
        return json({ ok: false, error: `expo ${res.status}`, sent: i }, 502);
      }
      const tickets: PushTicket[] = (await res.json())?.data ?? [];
      tickets.forEach((ticket, j) => {
        if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          const tk = ticket.details.expoPushToken ?? batch[j]?.to;
          if (tk) deadTokens.push(tk);
        }
      });
    }

    if (deadTokens.length > 0) {
      await supabase.from('push_tokens').delete().in('expo_push_token', deadTokens);
    }

    // 7. Stamp everyone whose messages Expo accepted. upsert+ignore: a race
    //    with a concurrent run inserts once and errors never.
    const { error: insErr } = await supabase
      .from('premiere_notifications')
      .upsert(toStamp, { onConflict: 'user_id,show_id,season', ignoreDuplicates: true });
    if (insErr) console.error('notify-premieres: stamping failed', insErr.message);

    return json({ ok: true, premieres: premieres.length, users: toStamp.length, sent: messages.length });
  } catch (error) {
    // Supabase client errors are plain objects, not Errors — String() yields
    // "[object Object]". Prefer .message, fall back to JSON.
    const msg = error instanceof Error ? error.message
      : (error as { message?: string })?.message ?? JSON.stringify(error);
    return json({ ok: false, error: msg }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
