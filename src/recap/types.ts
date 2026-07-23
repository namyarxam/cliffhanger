// Recap data model.
//
// A recap is a flat list of FRAMES (one tap = one frame, Instagram-stories
// style), each tagged with the ACT it belongs to so the progress bar can group
// them. Flat-with-grouping rather than nested acts because the tap-through
// reducer only ever needs "next index" — nesting would mean tracking a cursor
// per act for no rendering benefit.

export type RecapAct = 'open' | 'players' | 'story' | 'cliffhanger';

export const ACT_ORDER: RecapAct[] = ['open', 'players', 'story', 'cliffhanger'];

export const ACT_LABELS: Record<RecapAct, string> = {
  open: 'Last time on',
  players: 'The Players',
  story: 'The Story So Far',
  cliffhanger: 'The Cliffhanger',
};

type FrameBase = {
  act: RecapAct;
  /** Full-bleed background. Always present — the ladder in content/ resolves
   *  episode still → show backdrop → poster before it ever reaches here. */
  image: string;
  /**
   * Extra dark overlay, 0–1, on top of the standard scrims.
   *
   * This is the lever for the image-doesn't-match-the-words problem. A frame
   * whose image genuinely depicts its text (a beat over its own episode's
   * still) wants a LOW dim — the picture is doing real work. A frame whose
   * image is only atmosphere (a character card, where no still can depict "who
   * this person is now") wants a HIGH dim, so the background reads as texture
   * and stops making a claim it can't back up.
   */
  dim?: number;
};

export type RecapFrame = FrameBase &
  (
    | {
        kind: 'title';
        kicker: string;
        title: string;
        meta: string;
      }
    | {
        kind: 'character';
        /**
         * The actor's headshot IS this frame's `image` — full-bleed, not an
         * inset circle. Cast photos are 2:3 portrait, which overflows a 9:16
         * screen only ~1.45x versus ~3.85x for a 16:9 backdrop, so these are
         * the one asset class that genuinely fits a phone. Falls back to key
         * art when no cast row matched.
         */
        name: string;
        /** Empty string when no cast row matched. */
        actor: string;
        /** Who they are AS OF the recap boundary — not their series-wide arc. */
        line: string;
        note?: string;
      }
    | {
        kind: 'beat';
        season: number;
        label: string;
        text: string;
      }
    | {
        kind: 'cliffhanger';
        kicker: string;
        text: string;
        questions: string[];
      }
  );

/**
 * Which slice of the story to recap — an inclusive season range.
 *
 * Each season is independently recappable, and the range is what the user
 * picks: "just S1", "just S2", or "S1–S2". `through` is the spoiler boundary
 * and can never exceed what was fetched.
 */
export type SeasonRange = { from: number; through: number };

export function rangeLabel({ from, through }: SeasonRange): string {
  return from === through ? `S${from}` : `S${from}–S${through}`;
}

/** ~14 frames/min at a comfortable tap-through pace; floored at 1. */
export function estimateMinutes(frameCount: number): number {
  return Math.max(1, Math.round(frameCount / 7));
}

export type RecapMeta = {
  slug: string;
  title: string;
  totalSeasons: number;
  /** Seasons we actually hold content for — the spoiler ceiling. */
  availableSeasons: number[];
  network: string | null;
  poster: string;
  /** Card art for the recap list. */
  backdrop: string;
};

/** The season ranges offered on the list card. Every single season, plus the
 *  full span when there's more than one. */
export function offeredRanges(availableSeasons: number[]): SeasonRange[] {
  const singles = availableSeasons.map(s => ({ from: s, through: s }));
  if (availableSeasons.length < 2) return singles;
  const full = { from: availableSeasons[0], through: availableSeasons[availableSeasons.length - 1] };
  return [...singles, full];
}
