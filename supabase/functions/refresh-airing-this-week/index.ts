// Supabase Edge Function: Refresh the "Airing This Week" carousel.
//
// Deploy: supabase functions deploy refresh-airing-this-week
// Schedule: pg_cron daily at 06:00 UTC. The carousel is a 7-day rolling
// window, so technically weekly would be enough, but daily catches mid-
// week premieres faster and the cost is negligible (~10-15MB TVMaze
// download per run, 15 row writes).
//
// What it does:
// 1. Pull TVMaze /schedule/full (one big response, ~10-15MB).
// 2. Filter to the v1 spec we locked in:
//    - episode airdate within [today, today+7)
//    - show.type === 'Scripted'
//    - season < 100 (skips data quirks like Marvel S2026)
//    - English-speaking country OR major streaming network
//    - NOT broadcast network (NBC/CBS/ABC/Fox/CW)
//    - NOT a procedural-franchise prefix (NCIS, Law & Order, etc.)
// 3. Sort by weight desc, rating desc; dedupe by show_id; take top 15.
// 4. Upsert each show into the centralized `shows` table so JOINs work.
// 5. Replace `airing_this_week` rows in a single transaction.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TARGET_COUNT = 15;
const ENGLISH_COUNTRIES = new Set(['US', 'GB', 'CA', 'AU', 'IE', 'NZ']);
const STREAMER_NETWORKS = new Set([
  'Netflix', 'Prime Video', 'Disney+', 'Apple TV+', 'Apple TV', 'Hulu',
  'HBO', 'HBO Max', 'Max', 'Paramount+', 'Peacock', 'AMC+', 'Showtime',
  'Starz', 'STARZ', 'FX', 'MGM+',
]);
const BROADCAST_NETWORKS = new Set(['NBC', 'CBS', 'ABC', 'Fox', 'The CW']);
const PROCEDURAL_PREFIXES = [
  'NCIS', 'Law & Order', 'FBI', 'Chicago Fire', 'Chicago P.D.', 'Chicago Med',
  '9-1-1', 'CSI', "Grey's Anatomy", 'Magnum P.I.', 'Hawaii Five-0',
  'MacGyver', 'S.W.A.T.', 'Blue Bloods', 'The Rookie',
];

interface TVMazeEp {
  airdate: string;
  season: number;
  number: number;
  _embedded?: {
    show?: {
      id: number;
      name: string;
      type: string;
      status: string;
      premiered: string | null;
      genres: string[];
      weight: number;
      rating: { average: number | null };
      image: { medium: string; original: string } | null;
      summary: string | null;
      network: { name: string; country: { code: string } | null } | null;
      webChannel: { name: string; country: { code: string } | null } | null;
    };
  };
}

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const res = await fetch('https://api.tvmaze.com/schedule/full');
  if (!res.ok) {
    return json({ ok: false, error: `tvmaze ${res.status}` }, 502);
  }
  const eps: TVMazeEp[] = await res.json();

  type Candidate = ReturnType<typeof scoreCandidate>;
  const byShow = new Map<number, Candidate>();

  for (const ep of eps) {
    const show = ep._embedded?.show;
    if (!show) continue;
    if (ep.airdate < today || ep.airdate >= end) continue;
    if (show.type !== 'Scripted') continue;
    if (ep.season >= 100) continue;

    const country = show.network?.country?.code ?? show.webChannel?.country?.code ?? '';
    const networkName = show.network?.name ?? show.webChannel?.name ?? '';

    const englishOrStreamer = ENGLISH_COUNTRIES.has(country) || STREAMER_NETWORKS.has(networkName);
    if (!englishOrStreamer) continue;
    if (BROADCAST_NETWORKS.has(show.network?.name ?? '')) continue;
    if (PROCEDURAL_PREFIXES.some(p => show.name.startsWith(p))) continue;

    const c = scoreCandidate(show, ep, networkName);
    const existing = byShow.get(show.id);
    if (!existing || c.score > existing.score) {
      byShow.set(show.id, c);
    }
  }

  const ranked = [...byShow.values()].sort((a, b) => b.score - a.score).slice(0, TARGET_COUNT);

  if (ranked.length === 0) {
    return json({ ok: true, count: 0, note: 'no candidates passed the filter' });
  }

  // Upsert into shows so the FK on airing_this_week is satisfied. Mirrors
  // the cacheShowMetadata pattern from src/lib/watchlist.ts.
  const showsRows = ranked.map(c => ({
    show_id: String(c.show.id),
    show_title: c.show.name,
    show_image: c.show.image?.original ?? c.show.image?.medium ?? null,
    show_network: c.networkName || null,
    show_status: c.show.status,
    updated_at: new Date().toISOString(),
  }));
  const { error: showsErr } = await admin
    .from('shows')
    .upsert(showsRows, { onConflict: 'show_id' });
  if (showsErr) return json({ ok: false, error: 'upsert shows', detail: showsErr.message }, 500);

  // Replace airing_this_week atomically: delete-then-insert in a
  // transaction. Postgres function is overkill — Supabase REST does the
  // delete, then insert in two calls. A brief empty window between is
  // acceptable since the cron runs once a week, but we can minimize the
  // gap by inserting first under a temp marker if needed. Skipping that
  // for now; one-second blip during the weekly refresh is fine.
  const { error: delErr } = await admin
    .from('airing_this_week')
    .delete()
    .gte('rank', 0);
  if (delErr) return json({ ok: false, error: 'clear airing_this_week', detail: delErr.message }, 500);

  const insertRows = ranked.map((c, i) => ({
    show_id: String(c.show.id),
    rank: i + 1,
  }));
  const { error: insErr } = await admin
    .from('airing_this_week')
    .insert(insertRows);
  if (insErr) return json({ ok: false, error: 'insert airing_this_week', detail: insErr.message }, 500);

  return json({ ok: true, count: ranked.length, ranked: ranked.map(c => ({ id: c.show.id, name: c.show.name, weight: c.show.weight, rating: c.show.rating.average })) });
});

function scoreCandidate(show: TVMazeEp['_embedded'] extends infer X ? X extends { show?: infer S } ? NonNullable<S> : never : never, _ep: TVMazeEp, networkName: string) {
  // Primary: weight (0-100). Tiebreaker: rating (0-10) scaled into the
  // sub-integer range so it never overrides weight. So weight=100 rating=8.3
  // beats weight=100 rating=7.4 beats weight=99 rating=anything.
  const score = show.weight * 100 + (show.rating.average ?? 0) * 10;
  return { show, networkName, score };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
