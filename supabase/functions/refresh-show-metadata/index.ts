// Supabase Edge Function: Refresh cached TVMaze metadata for currently-watching shows.
//
// poll-schedule only writes today's airing episodes — it never touches the
// next_episode_airdate / show_status cache on user_shows. So when TVMaze
// announces a future airdate (e.g. House of the Dragon's next season), the
// home screen sub-grouping ("On Hiatus" vs "Returning") stays stale until the
// user opens the show detail page, which is the only thing that calls
// cacheShowMetadata.
//
// This function fixes that without per-user TVMaze calls: pull every distinct
// show_id that someone is currently watching (skipping Ended shows, which
// won't get new episodes), fetch /shows/{id}?embed=nextepisode once per show,
// and bulk-update next_episode_airdate + show_status on every user_shows row
// for that show_id. One TVMaze call covers all users watching the show.
//
// Deploy: supabase functions deploy refresh-show-metadata
// Schedule: see pg_cron SQL in CLAUDE.md / project docs (twice daily,
// 10:00 + 19:00 UTC ≈ 6am + 3pm ET).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TVMAZE_BASE = 'https://api.tvmaze.com';
// TVMaze's polite-use guidance is ~20 req/10s. 250ms between calls = 4 req/s,
// comfortably under the cap and leaves headroom if a request is slow.
const REQ_INTERVAL_MS = 250;

interface TVMazeShowResponse {
  status?: string;
  _embedded?: {
    nextepisode?: {
      airdate?: string;
    };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Pull every show_id on someone's currently-watching list, excluding
    // shows TVMaze has marked Ended. Returning + Hiatus + Behind shows are
    // all in scope — any of their cached metadata could change (date moves,
    // hiatus → returning, returning → ended).
    const { data: rows, error } = await supabase
      .from('user_shows')
      .select('show_id')
      .eq('status', 'currently_watching')
      .or('show_status.is.null,show_status.neq.Ended');

    if (error) throw error;

    const showIds = [...new Set((rows ?? []).map(r => r.show_id))];

    let refreshed = 0;
    let failed = 0;

    for (const showId of showIds) {
      try {
        const res = await fetch(`${TVMAZE_BASE}/shows/${showId}?embed[]=nextepisode`);
        if (!res.ok) {
          failed++;
        } else {
          const data: TVMazeShowResponse = await res.json();
          const nextAirdate = data._embedded?.nextepisode?.airdate ?? null;
          const status = data.status ?? null;

          // Update across all users watching this show. Scoping to
          // currently_watching keeps want_to_watch / watched rows untouched —
          // their sub-grouping doesn't depend on this cache.
          const { error: updateError } = await supabase
            .from('user_shows')
            .update({
              show_status: status,
              next_episode_airdate: nextAirdate,
            })
            .eq('show_id', showId)
            .eq('status', 'currently_watching');

          if (updateError) failed++;
          else refreshed++;
        }
      } catch {
        failed++;
      }
      await sleep(REQ_INTERVAL_MS);
    }

    return new Response(
      JSON.stringify({ ok: true, total: showIds.length, refreshed, failed }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
