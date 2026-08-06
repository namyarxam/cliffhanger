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

    // Per-episode push notifications used to live here. Retired 2026-08:
    // the product's one push about airings is now the season-premiere alert
    // (notify-premieres, its own function + daily cron). This function's
    // remaining job is keeping `schedule` and shows.last_aired_* fresh,
    // which the in-app new-episode indicators read.

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
