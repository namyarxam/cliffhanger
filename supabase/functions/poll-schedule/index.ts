// Supabase Edge Function: Poll TVMaze schedule and notify users
// Deploy: supabase functions deploy poll-schedule
// Schedule: set up pg_cron or external cron to call every 6 hours

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface TVMazeEpisode {
  id: number;
  airdate: string;
  airtime: string;
  runtime: number | null;
  season: number;
  number: number | null;
  name: string;
  show: {
    id: number;
    name: string;
    network: { name: string } | null;
    webChannel: { name: string } | null;
  };
}

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const today = new Date().toISOString().split('T')[0];

  try {
    // Fetch broadcast + streaming schedules from TVMaze
    const [broadcastRes, streamingRes] = await Promise.all([
      fetch(`https://api.tvmaze.com/schedule?date=${today}`),
      fetch(`https://api.tvmaze.com/schedule/web?date=${today}`),
    ]);

    const broadcast: TVMazeEpisode[] = broadcastRes.ok ? await broadcastRes.json() : [];
    const streaming: TVMazeEpisode[] = streamingRes.ok ? await streamingRes.json() : [];

    // Combine, filter valid episodes, deduplicate by show_id+season+episode
    const seen = new Set<string>();
    const episodes = [...broadcast, ...streaming]
      .filter(ep => ep.show?.id && ep.season && ep.number)
      .filter(ep => {
        const key = `${ep.show.id}-${ep.season}-${ep.number}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(ep => ({
        show_id: String(ep.show.id),
        season: ep.season,
        episode: ep.number!,
        episode_name: ep.name || null,
        airdate: ep.airdate,
        airtime: ep.airtime || null,
        runtime: ep.runtime || null,
        network: ep.show.network?.name || ep.show.webChannel?.name || null,
      }));

    // Upsert into schedule table
    if (episodes.length > 0) {
      await supabase
        .from('schedule')
        .upsert(episodes, { onConflict: 'show_id,season,episode', ignoreDuplicates: true });
    }

    // Bump shows.last_aired_* whenever the schedule reveals an episode newer
    // than what's cached. After the centralize-shows refactor this is one
    // write per show_id (was N writes per show_id, one per watcher). The OR
    // filter ensures we only overwrite when the new episode is actually
    // newer — cron runs against the same airdates can no-op cleanly.
    //
    // Also +1 the total_aired_episodes counter (My Shows progress-bar
    // denominator). The OR filter doubles as the dedup guard: an UPDATE that
    // matches no rows is a no-op, so re-running the same poll won't
    // double-count. RPC needed because PostgREST .update() can't reference
    // the row's existing column value.
    for (const ep of episodes) {
      const { data: updated } = await supabase
        .from('shows')
        .update({
          last_aired_season: ep.season,
          last_aired_episode: ep.episode,
          last_aired_airdate: ep.airdate,
          updated_at: new Date().toISOString(),
        })
        .eq('show_id', ep.show_id)
        .or(
          `last_aired_season.is.null,` +
          `last_aired_season.lt.${ep.season},` +
          `and(last_aired_season.eq.${ep.season},last_aired_episode.lt.${ep.episode})`,
        )
        .select('show_id, total_aired_episodes');

      if (updated && updated.length > 0 && updated[0].total_aired_episodes != null) {
        await supabase
          .from('shows')
          .update({ total_aired_episodes: updated[0].total_aired_episodes + 1 })
          .eq('show_id', ep.show_id);
      }
    }

    // Find users who are watching these shows and want push notifications
    const showIds = [...new Set(episodes.map(e => e.show_id))];

    if (showIds.length > 0) {
      // Pull all currently_watching rows for our show_ids. We'll filter to
      // "notify-eligible" below once we know per-user preferences.
      // last_notified_{season,episode} is the push-dedup cursor — separate from
      // current_{season,episode} so watching progress and push state don't conflate.
      const { data: allWatchers } = await supabase
        .from('user_shows_full')
        .select('user_id, show_id, show_title, notify, last_notified_season, last_notified_episode')
        .in('show_id', showIds)
        .eq('status', 'currently_watching');

      if (allWatchers && allWatchers.length > 0) {
        // Check which users have the master push toggle on, and which have the
        // "alert for all currently watching" override.
        const userIds = [...new Set(allWatchers.map(w => w.user_id))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, push_new_episodes, notify_all_current')
          .in('id', userIds)
          .eq('push_new_episodes', true);

        const pushEnabledUsers = new Set((profiles || []).map(p => p.id));
        const notifyAllUsers = new Set((profiles || []).filter(p => p.notify_all_current).map(p => p.id));

        // Per-show notify OR global notify_all_current override
        const watchers = allWatchers.filter(
          w => w.notify === true || notifyAllUsers.has(w.user_id),
        );

        // Get push tokens for these users
        if (pushEnabledUsers.size > 0) {
          const { data: tokens } = await supabase
            .from('push_tokens')
            .select('user_id, expo_push_token')
            .in('user_id', [...pushEnabledUsers]);

          if (tokens && tokens.length > 0) {
            // Build notifications: one per user per show with new episodes.
            // Track which (user, show) pairs we're notifying and the latest episode,
            // so we can bump last_notified_{season,episode} after sending.
            const notifications: { to: string; title: string; body: string }[] = [];
            const notified: { user_id: string; show_id: string; season: number; episode: number }[] = [];

            for (const watcher of watchers) {
              if (!pushEnabledUsers.has(watcher.user_id)) continue;

              // Only surface episodes we haven't already pushed about.
              const newEps = episodes.filter(
                e =>
                  e.show_id === watcher.show_id &&
                  (e.season > watcher.last_notified_season ||
                    (e.season === watcher.last_notified_season && e.episode > watcher.last_notified_episode))
              );

              if (newEps.length === 0) continue;

              const latest = newEps.reduce((a, b) =>
                b.season > a.season || (b.season === a.season && b.episode > a.episode) ? b : a,
              );

              const userTokens = tokens.filter(t => t.user_id === watcher.user_id);
              for (const token of userTokens) {
                notifications.push({
                  to: token.expo_push_token,
                  title: 'New Episode',
                  body: `${watcher.show_title} — S${newEps[0].season} E${newEps[0].episode} aired today`,
                });
              }

              notified.push({
                user_id: watcher.user_id,
                show_id: watcher.show_id,
                season: latest.season,
                episode: latest.episode,
              });
            }

            // Send via Expo push service (batch) and prune dead tokens from the response
            if (notifications.length > 0) {
              const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(notifications),
              });

              if (pushRes.ok) {
                const pushBody = await pushRes.json();
                const tickets: Array<{ status: string; details?: { error?: string; expoPushToken?: string } }> =
                  pushBody?.data ?? [];

                // Expo returns DeviceNotRegistered when a token is dead (uninstall, logout,
                // permission revoked). Remove those so we stop wasting future sends on them.
                const deadTokens: string[] = [];
                for (let i = 0; i < tickets.length; i++) {
                  const t = tickets[i];
                  if (t?.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
                    const token = t.details.expoPushToken ?? notifications[i]?.to;
                    if (token) deadTokens.push(token);
                  }
                }

                if (deadTokens.length > 0) {
                  await supabase
                    .from('push_tokens')
                    .delete()
                    .in('expo_push_token', deadTokens);
                }
              }

              // Bump last_notified_{season,episode} for every (user, show) pair we just
              // pushed about. On the next poll, those episodes won't re-qualify even if
              // the user hasn't watched them yet.
              for (const n of notified) {
                await supabase
                  .from('user_shows')
                  .update({
                    last_notified_season: n.season,
                    last_notified_episode: n.episode,
                  })
                  .eq('user_id', n.user_id)
                  .eq('show_id', n.show_id);
              }
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, date: today, episodes: episodes.length }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
