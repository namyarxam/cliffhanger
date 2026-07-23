-- When did this user last open the app?
--
-- Nothing recorded it. Every existing timestamp is a WRITE proxy — an episode
-- marked, a show added, a setting changed — so a user who opens the app to see
-- what is airing and closes it again leaves no trace at all. auth.last_sign_in_at
-- does not help either: sessions persist on a refresh token, and autoRefreshToken
-- is deliberately false (the cold-launch deadlock fix), so it only moves on an
-- explicit re-login. push_tokens is registered on every launch but carries only
-- created_at, so the one signal that does fire on every open discards its own
-- evidence.
--
-- The result was being unable to answer "how many people opened the app this
-- week", which is the first question worth asking about any feature that ships
-- after this — including whether recaps bring anyone back.
--
-- Nullable with no backfill: pretending existing users were seen at migration
-- time would put a false spike in the first week of data. NULL honestly means
-- "not seen since we started counting".

ALTER TABLE profiles
  ADD COLUMN last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_last_seen_at_idx
  ON profiles (last_seen_at DESC NULLS LAST);

-- Usage, once there is data:
--
--   -- daily / weekly / monthly actives
--   SELECT count(*) FROM profiles WHERE last_seen_at > now() - interval '1 day';
--   SELECT count(*) FROM profiles WHERE last_seen_at > now() - interval '7 days';
--   SELECT count(*) FROM profiles WHERE last_seen_at > now() - interval '30 days';
--
--   -- who has drifted away
--   SELECT username, last_seen_at
--     FROM profiles
--    WHERE last_seen_at < now() - interval '14 days'
--    ORDER BY last_seen_at DESC;
