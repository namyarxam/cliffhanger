// Write composed frames to Supabase, then PROVE the write.
//
// The whole silent-truncation class came from stages reporting success with
// nothing comparing output to input, so upload does not end at "no error" —
// it reads the show back out of the live database and asserts the invariants
// from the old check-shipped.mjs, scoped to this slug, in the same process:
//
//   1. through_season equals the max season actually stored
//   2. no gaps below it
//   3. the stored seasons are exactly the composed ones (plus pre-existing)
//   4. episode_count populated everywhere (recap_max_season reads it)
//   5. every beat carries an image; every season carries a cliffhanger
//
// Requires SUPABASE_SERVICE_ROLE_KEY — recap tables are deliberately
// read-only to clients. That variable must never gain an EXPO_PUBLIC_ prefix.

import { createClient } from '@supabase/supabase-js';

export function makeDb(env) {
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Season numbers currently stored for a slug, or null when the show is absent. */
export async function existingSeasons(db, slug) {
  const { data: show, error: showErr } = await db
    .from('recap_shows')
    .select('slug, through_season, total_seasons, generated_at')
    .eq('slug', slug)
    .maybeSingle();
  if (showErr) throw new Error(`recap_shows lookup: ${showErr.message}`);
  if (!show) return null;
  const { data: rows, error } = await db.from('recap_seasons').select('season').eq('slug', slug);
  if (error) throw new Error(`recap_seasons lookup: ${error.message}`);
  return { show, seasons: rows.map(r => r.season).sort((a, b) => a - b) };
}

export async function uploadShow(db, show, seasons) {
  // UPDATE-or-INSERT rather than upsert: recap_shows carries TWO unique
  // indexes (slug and show_id) and Postgres arbitrates ON CONFLICT against
  // exactly one, so upsert on slug raises on the show_id index for any
  // re-upload — which is precisely the operation "a new season aired" needs.
  const { data: existing, error: findErr } = await db
    .from('recap_shows')
    .select('slug')
    .eq('slug', show.slug)
    .maybeSingle();
  if (findErr) throw new Error(`recap_shows lookup: ${findErr.message}`);
  const { error: showErr } = existing
    ? await db.from('recap_shows').update(show).eq('slug', show.slug)
    : await db.from('recap_shows').insert(show);
  if (showErr) throw new Error(`recap_shows write: ${showErr.message}`);

  const { error: seasonErr } = await db
    .from('recap_seasons')
    .upsert(seasons, { onConflict: 'slug,season' });
  if (seasonErr) throw new Error(`recap_seasons write: ${seasonErr.message}`);
  console.log(`  ✓ wrote recap_shows + ${seasons.length} season row(s)`);
}

/**
 * Read the slug back from the LIVE database and assert every invariant.
 * `composedSeasons` is the set this run wrote. Throws on any break.
 */
export async function assertShipped(db, slug, composedSeasons) {
  const { data: show, error: showErr } = await db
    .from('recap_shows')
    .select('slug, through_season, total_seasons')
    .eq('slug', slug)
    .single();
  if (showErr) throw new Error(`verify read recap_shows: ${showErr.message}`);

  const { data: rows, error } = await db
    .from('recap_seasons')
    .select('season, beats, characters, cliffhanger, episode_count')
    .eq('slug', slug)
    .order('season');
  if (error) throw new Error(`verify read recap_seasons: ${error.message}`);

  const breaks = [];
  const dbSeasons = rows.map(r => r.season);
  const maxDb = dbSeasons.length ? Math.max(...dbSeasons) : 0;

  if (show.through_season !== maxDb)
    breaks.push(`through_season claims S${show.through_season}, database holds S${maxDb || 'none'}`);

  for (let n = 1; n <= maxDb; n++)
    if (!dbSeasons.includes(n)) breaks.push(`gap: missing S${n} below S${maxDb}`);

  const notStored = composedSeasons.filter(n => !dbSeasons.includes(n));
  if (notStored.length) breaks.push(`composed S${notStored.join(',S')} but the database does not hold them`);

  for (const r of rows) {
    const beats = Array.isArray(r.beats) ? r.beats : [];
    if (!beats.length) breaks.push(`S${r.season}: no beats`);
    const imageless = beats.filter(b => !b.image).length;
    if (imageless) breaks.push(`S${r.season}: ${imageless} beat(s) without an image`);
    if (!r.cliffhanger?.text) breaks.push(`S${r.season}: no cliffhanger`);
    if (!r.episode_count) breaks.push(`S${r.season}: episode_count null/zero — the season cap reads this`);
  }

  if (breaks.length) {
    throw new Error(`shipped-state invariants BROKEN for ${slug}:\n  ${breaks.join('\n  ')}`);
  }
  console.log(`  ✓ shipped-state verified against the live database: S1-S${maxDb}, all invariants hold`);
}
