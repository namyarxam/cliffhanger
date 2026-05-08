-- Backfills the four show-detail coachmarks (Watchlist → Watching → Finished →
-- Mute) for existing onboarded users so they don't see a tutorial for pills
-- they're already used to. New users start with an empty array and will see
-- the sequence on their first show detail visit.

UPDATE profiles
  SET coachmarks_seen = array_append(coachmarks_seen, 'tap_watchlist')
  WHERE onboarded_at IS NOT NULL
    AND NOT 'tap_watchlist' = ANY(coachmarks_seen);

UPDATE profiles
  SET coachmarks_seen = array_append(coachmarks_seen, 'tap_watching')
  WHERE onboarded_at IS NOT NULL
    AND NOT 'tap_watching' = ANY(coachmarks_seen);

UPDATE profiles
  SET coachmarks_seen = array_append(coachmarks_seen, 'tap_finished')
  WHERE onboarded_at IS NOT NULL
    AND NOT 'tap_finished' = ANY(coachmarks_seen);

UPDATE profiles
  SET coachmarks_seen = array_append(coachmarks_seen, 'tap_mute')
  WHERE onboarded_at IS NOT NULL
    AND NOT 'tap_mute' = ANY(coachmarks_seen);
