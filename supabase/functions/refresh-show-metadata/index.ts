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
      season?: number;
      number?: number;
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
        // Pre-read one row's cached airdate so we can detect a hiatus → returning
        // transition. All currently_watching rows for the same show carry the
        // same cached value (cron writes them in lockstep), so one row is enough.
        const { data: existing } = await supabase
          .from('user_shows')
          .select('next_episode_airdate')
          .eq('show_id', showId)
          .eq('status', 'currently_watching')
          .limit(1);
        const previousAirdate = existing?.[0]?.next_episode_airdate ?? null;

        const res = await fetch(`${TVMAZE_BASE}/shows/${showId}?embed[]=nextepisode`);
        if (!res.ok) {
          failed++;
        } else {
          const data: TVMazeShowResponse = await res.json();
          const nextEp = data._embedded?.nextepisode;
          const nextAirdate = nextEp?.airdate ?? null;
          const nextSeason = nextEp?.season ?? null;
          const nextEpisode = nextEp?.number ?? null;
          const status = data.status ?? null;

          // Hiatus → returning: TVMaze just announced a future airdate for a
          // show that didn't have one before. Stamp announced_at (drives the
          // "Coming back!" banner) and reset seen_at so it re-fires even if
          // this same show has been announced before.
          const isReturnAnnouncement = previousAirdate == null && nextAirdate != null;

          const update: Record<string, unknown> = {
            show_status: status,
            next_episode_airdate: nextAirdate,
            next_episode_season: nextSeason,
            next_episode_episode: nextEpisode,
          };
          if (isReturnAnnouncement) {
            update.returning_announced_at = new Date().toISOString();
            update.returning_seen_at = null;
          }

          // Update across all users watching this show. Scoping to
          // currently_watching keeps want_to_watch / watched rows untouched —
          // their sub-grouping doesn't depend on this cache.
          const { error: updateError } = await supabase
            .from('user_shows')
            .update(update)
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

    // ─── Badge push ─────────────────────────────────────────────────────────
    // After all metadata is refreshed, recompute each user's "soon" unseen
    // announcement count (returns within 5 days, banner not yet acknowledged)
    // and bump their iOS app icon badge via silent push. Catches both fresh
    // hiatus → returning transitions AND previously-announced shows that
    // rolled into the soon window since the last cron run.
    //
    // Only sends to users with count > 0. Users with count = 0 get their
    // badge cleared client-side when they next open the app (setBadgeCountAsync
    // in MyShowsScreen). Acceptable staleness since stale badges self-heal
    // on next open and silent push is best-effort anyway.
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const soonStr = new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: soonRows } = await supabase
      .from('user_shows')
      .select('user_id, returning_announced_at, returning_seen_at')
      .eq('status', 'currently_watching')
      .not('returning_announced_at', 'is', null)
      .gte('next_episode_airdate', todayStr)
      .lte('next_episode_airdate', soonStr);

    const unseenByUser = new Map<string, number>();
    for (const r of soonRows ?? []) {
      const seen = r.returning_seen_at;
      const announced = r.returning_announced_at;
      if (seen == null || (announced != null && seen < announced)) {
        unseenByUser.set(r.user_id, (unseenByUser.get(r.user_id) ?? 0) + 1);
      }
    }

    let pushedBadges = 0;
    if (unseenByUser.size > 0) {
      const { data: tokens } = await supabase
        .from('push_tokens')
        .select('user_id, expo_push_token')
        .in('user_id', [...unseenByUser.keys()]);

      // Silent push: no title/body, just a badge bump. _contentAvailable lets
      // iOS deliver it without showing anything to the user. Best-effort —
      // iOS may throttle silent pushes, and users with notifications disabled
      // won't get them at all (the on-open setBadgeCountAsync is the safety net).
      const notifications = (tokens ?? []).map(t => ({
        to: t.expo_push_token,
        badge: unseenByUser.get(t.user_id) ?? 0,
        _contentAvailable: true,
      }));

      if (notifications.length > 0) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(notifications),
        });
        pushedBadges = notifications.length;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, total: showIds.length, refreshed, failed, pushedBadges }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
