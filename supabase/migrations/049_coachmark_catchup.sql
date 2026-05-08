-- Adds the 'long_press_catchup' coachmark ID to existing onboarded users so
-- they don't get hit with a tutorial for a feature they're already used to.
-- New users start with an empty array and will see the coachmark naturally.

UPDATE profiles
  SET coachmarks_seen = array_append(coachmarks_seen, 'long_press_catchup')
  WHERE onboarded_at IS NOT NULL
    AND NOT 'long_press_catchup' = ANY(coachmarks_seen);
