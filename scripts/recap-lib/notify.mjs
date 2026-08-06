// Close the request loop: when a recap ships, tell the people who asked.
//
// This runs pipeline-side rather than as an edge function because ship already
// holds the service role and the moment of truth — assertShipped has just
// proven the recap is live. The push itself follows the same shape as
// supabase/functions/notify-friend-request: Expo push API, batch send,
// EXPO_ACCESS_TOKEN required (Enhanced Push Security rejects unauthenticated
// server pushes).
//
// notified_at is stamped for EVERY open request row for the show, including
// users with no push token — the mark means "this request was fulfilled and
// handled", not "a push landed". A user without a token still finds the recap
// in the app; leaving their row unstamped would re-notify forever once they
// ever register a device.

export async function notifyRequesters(db, env, show) {
  const { data: requests, error } = await db
    .from('recap_requests')
    .select('id, user_id')
    .eq('show_id', show.show_id)
    .is('notified_at', null);
  if (error) {
    console.warn(`  ⚠ could not read recap_requests: ${error.message}`);
    return;
  }
  if (!requests?.length) return;

  const userIds = [...new Set(requests.map(r => r.user_id))];
  console.log(`  ${requests.length} open request(s) for this show from ${userIds.length} user(s)`);

  const expoToken = env.EXPO_ACCESS_TOKEN;
  if (!expoToken) {
    console.warn(
      '  ⚠ EXPO_ACCESS_TOKEN not in .env — skipping pushes AND leaving requests unstamped so a later ship can notify.',
    );
    return;
  }

  const { data: tokens, error: tokErr } = await db
    .from('push_tokens')
    .select('user_id, expo_push_token')
    .in('user_id', userIds);
  if (tokErr) {
    console.warn(`  ⚠ could not read push_tokens: ${tokErr.message}`);
    return;
  }

  if (tokens?.length) {
    const notifications = tokens.map(t => ({
      to: t.expo_push_token,
      title: `Your recap is ready: ${show.title}`,
      body: 'You asked for this one. Open the Recap tab to catch up.',
      data: { type: 'recap_ready', slug: show.slug },
      sound: 'default',
    }));
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${expoToken}`,
      },
      body: JSON.stringify(notifications),
    });
    if (!res.ok) {
      console.warn(`  ⚠ Expo push failed ${res.status}: ${(await res.text()).slice(0, 200)} — requests left unstamped`);
      return;
    }
    console.log(`  ✓ pushed to ${notifications.length} device(s)`);
  } else {
    console.log('  · no push tokens among requesters — stamping requests fulfilled without a push');
  }

  const { error: stampErr } = await db
    .from('recap_requests')
    .update({ notified_at: new Date().toISOString() })
    .eq('show_id', show.show_id)
    .is('notified_at', null);
  if (stampErr) console.warn(`  ⚠ could not stamp notified_at: ${stampErr.message}`);
}

/**
 * Record that a show was evaluated and turned down, so the app can say why
 * instead of leaving its request button a black hole.
 */
export async function declineShow(db, { showId, title, reason, publicReason }) {
  const { error } = await db.from('recap_declined').upsert(
    {
      show_id: showId,
      show_title: title,
      reason,
      public_reason: publicReason,
      declined_at: new Date().toISOString(),
    },
    { onConflict: 'show_id' },
  );
  if (error) throw new Error(`recap_declined: ${error.message}`);
  console.log(`  ✓ declined "${title}" (${showId}): ${publicReason}`);
}
