// All known coachmark IDs. Adding a new ID requires:
//   1. Adding the literal here
//   2. Calling useCoachmark({ id, ... }) somewhere in the app
//   3. (optional) backfilling existing users in a migration so they don't
//      see a coachmark for a feature they've already been using.
//
// IDs are persisted in profiles.coachmarks_seen — never rename without a
// migration that translates old → new in every user's array.

export const COACHMARK_IDS = [
  'long_press_mute',
  'tap_show_detail',
  'long_press_catchup',
  // Sequential quartet on the show detail page (first visit):
  // Watchlist → Watching → Finished → Mute. Chained via showAfter.
  'tap_watchlist',
  'tap_watching',
  'tap_finished',
  'tap_mute',
] as const;

export type CoachmarkId = typeof COACHMARK_IDS[number];
