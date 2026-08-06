// Request-a-recap: the client side of the demand queue.
//
// Requests are votes, not orders — fulfilment is a manual, curated pipeline
// run, and the app copy should never promise otherwise. A request row is
// (user, TVMaze show id) with the title and image denormalised, because the
// requested show is by definition not in recap_shows and may not be in
// `shows` either.

import { supabase } from '@/src/lib/supabase';
import type { ShowSummary } from '@/src/lib/types';

/** One search result's recap-world state, from recap_search_state(). */
export type RecapSearchState = {
  showId: string;
  /** Set when a recap exists. Content still unlocks per-viewer via get_recap. */
  slug: string | null;
  throughSeason: number | null;
  totalSeasons: number | null;
  /** Set when the show was evaluated and turned down — the sentence to show. */
  declinedReason: string | null;
  requests: number;
  requestedByMe: boolean;
};

export async function getRecapSearchState(showIds: string[]): Promise<Map<string, RecapSearchState>> {
  if (!showIds.length) return new Map();
  const { data, error } = await supabase.rpc('recap_search_state', { p_show_ids: showIds });
  if (error) throw error;
  const map = new Map<string, RecapSearchState>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    map.set(r.show_id as string, {
      showId: r.show_id as string,
      slug: (r.slug as string) ?? null,
      throughSeason: (r.through_season as number) ?? null,
      totalSeasons: (r.total_seasons as number) ?? null,
      declinedReason: (r.declined_reason as string) ?? null,
      requests: Number(r.requests ?? 0),
      requestedByMe: Boolean(r.requested_by_me),
    });
  }
  return map;
}

/**
 * Client-side eligibility for the OBVIOUS cases only. TVMaze's `type` field
 * marks Reality / Talk Show / Documentary / Game Show / Sports / News right
 * in the search payload, and those shows have no story to recap — blocking
 * them here saves a doomed request and explains the feature in one line.
 * Everything subtler (anthologies, scale) is decided by the offline
 * eligibility gate after a request comes in.
 */
export function recapIneligibleReason(show: ShowSummary): string | null {
  if (show.type && !['Scripted', 'Animation'].includes(show.type)) {
    return "Recaps are for scripted shows — there's no story to catch up on.";
  }
  return null;
}

export async function requestRecap(userId: string, show: ShowSummary): Promise<void> {
  const { error } = await supabase.from('recap_requests').upsert(
    {
      user_id: userId,
      show_id: show.id,
      show_title: show.title,
      show_image: show.image,
    },
    { onConflict: 'user_id,show_id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function withdrawRecapRequest(userId: string, showId: string): Promise<void> {
  const { error } = await supabase
    .from('recap_requests')
    .delete()
    .eq('user_id', userId)
    .eq('show_id', showId);
  if (error) throw error;
}
