-- Welcome flow gate. Nullable timestamp set when a user finishes (or skips)
-- the post-signup onboarding screens. AuthGate routes accounts with NULL
-- here into /(onboarding); existing users are backfilled to NOW() so they
-- skip straight into (tabs) on next session.

ALTER TABLE profiles
  ADD COLUMN onboarded_at timestamptz;

UPDATE profiles SET onboarded_at = now() WHERE onboarded_at IS NULL;
