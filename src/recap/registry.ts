// Available recaps.
//
// Adding a show is three steps and no new code:
//   node scripts/fetch-recap.mjs   --show "Name" --slug slug --through N
//   node scripts/generate-spine.mjs --slug slug
//   add the two imports + one RECAPS entry below
//
// In the real feature this becomes a query against a generated dataset (top ~N
// shows, cross-referenced against the user's watchlist and progress) rather
// than bundled JSON — see the scaling note in the design discussion. Bundling
// works at prototype scale and would not at 1000 shows.

import type { RecapFrame, RecapMeta, SeasonRange } from './types';
import { createRecap } from './build';
import type { ShowData, ShowSpine } from './build';

import siloData from './data/silo.json';
import siloSpine from './data/silo.spine.json';
import expanseData from './data/expanse.json';
import expanseSpine from './data/expanse.spine.json';

const RECAPS = [
  createRecap(siloData as unknown as ShowData, siloSpine as unknown as ShowSpine),
  createRecap(expanseData as unknown as ShowData, expanseSpine as unknown as ShowSpine),
].reduce<Record<string, ReturnType<typeof createRecap>>>((acc, r) => {
  acc[r.meta.slug] = r;
  return acc;
}, {});

export function getRecapMeta(slug: string): RecapMeta | null {
  return RECAPS[slug]?.meta ?? null;
}

export function listRecaps(): RecapMeta[] {
  return Object.values(RECAPS).map(r => r.meta);
}

/** Beats that bypassed source grounding and need a human read before shipping. */
export function getNeedsVerify(slug: string): string[] {
  return RECAPS[slug]?.needsVerify ?? [];
}

/**
 * Frames for a season range. Clamped to what we actually hold content for, so a
 * hand-edited deep link can't request a season past the spoiler boundary.
 */
export function buildFrames(slug: string, range: SeasonRange): RecapFrame[] {
  const entry = RECAPS[slug];
  if (!entry) return [];
  const seasons = entry.meta.availableSeasons;
  const min = seasons[0];
  const max = seasons[seasons.length - 1];
  const from = Math.max(min, Math.min(range.from, max));
  const through = Math.max(from, Math.min(range.through, max));
  return entry.buildFrames({ from, through });
}
