-- Per-user record of which coachmarks the user has dismissed (or completed
-- the demonstrated gesture for). Each ID is a stable string keyed in
-- src/tutorial/registry.ts. TutorialProvider reads this list off the loaded
-- profile and considers any ID in here permanently retired for that user.
--
-- Cross-device + cross-reinstall: once seen, never resurfaced. To re-trigger
-- for testing: UPDATE profiles SET coachmarks_seen = '{}' WHERE username = 'me';

ALTER TABLE profiles
  ADD COLUMN coachmarks_seen text[] NOT NULL DEFAULT '{}';

-- Backfill: anyone already past onboarding shouldn't suddenly see brand-new
-- coachmarks for things they've already learned by exploring the app.
-- Append every currently-known coachmark ID to existing onboarded accounts.
UPDATE profiles
  SET coachmarks_seen = ARRAY['long_press_mute']::text[]
  WHERE onboarded_at IS NOT NULL;
