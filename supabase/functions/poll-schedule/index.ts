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

    // Find users who are watching these shows and want push notifications
    const showIds = [...new Set(episodes.map(e => e.show_id))];

    if (showIds.length > 0) {
      // Get users watching these shows with push enabled
      const { data: watchers } = await supabase
        .from('user_shows')
        .select('user_id, show_id, show_title, current_season, current_episode')
        .in('show_id', showIds)
        .eq('status', 'currently_watching');

      if (watchers && watchers.length > 0) {
        // Check which users want push notifications
        const userIds = [...new Set(watchers.map(w => w.user_id))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, push_new_episodes')
          .in('id', userIds)
          .eq('push_new_episodes', true);

        const pushEnabledUsers = new Set((profiles || []).map(p => p.id));

        // Get push tokens for these users
        if (pushEnabledUsers.size > 0) {
          const { data: tokens } = await supabase
            .from('push_tokens')
            .select('user_id, expo_push_token')
            .in('user_id', [...pushEnabledUsers]);

          if (tokens && tokens.length > 0) {
            // Build notifications: one per user per show with new episodes
            const notifications: { to: string; title: string; body: string }[] = [];

            for (const watcher of watchers) {
              if (!pushEnabledUsers.has(watcher.user_id)) continue;

              // Check if any new episodes are beyond the user's current position
              const newEps = episodes.filter(
                e =>
                  e.show_id === watcher.show_id &&
                  (e.season > watcher.current_season ||
                    (e.season === watcher.current_season && e.episode > watcher.current_episode))
              );

              if (newEps.length === 0) continue;

              const userTokens = tokens.filter(t => t.user_id === watcher.user_id);
              for (const token of userTokens) {
                notifications.push({
                  to: token.expo_push_token,
                  title: 'New Episode',
                  body: `${watcher.show_title} — S${newEps[0].season} E${newEps[0].episode} aired today`,
                });
              }
            }

            // Send via Expo push service (batch)
            if (notifications.length > 0) {
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(notifications),
              });
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
