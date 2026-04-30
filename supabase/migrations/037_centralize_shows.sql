-- Centralize TVMaze metadata into a `shows` table keyed by show_id.
--
-- Before: every user_shows row carried a copy of show_title/show_image/network/
-- status/next_episode_*/last_aired_*. Cron updates fanned out across N rows per
-- show. At ~50k users this becomes the dominant write cost.
--
-- After: one `shows` row per show_id holds the TVMaze data; user_shows keeps
-- only per-user state. Reads use the `user_shows_full` view so consuming code
-- sees the same flat shape it always did. Writes split:
--   - addShow: upsert shows + insert user_shows (idempotent — orphan shows are
--     harmless and reused on the next add).
--   - cron / cacheShowMetadata: update shows once per show_id instead of N
--     times per show_id.
--
-- The view uses security_invoker so the underlying RLS on user_shows + shows
-- applies, not the view owner's permissions.

-- ─── shows table ────────────────────────────────────────────────────────────
CREATE TABLE public.shows (
  show_id TEXT PRIMARY KEY,
  show_title TEXT NOT NULL,
  show_image TEXT,
  show_network TEXT,
  show_status TEXT,
  next_episode_airdate DATE,
  next_episode_season INT,
  next_episode_episode INT,
  last_aired_season INT,
  last_aired_episode INT,
  last_aired_airdate DATE,
  returning_announced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shows ENABLE ROW LEVEL SECURITY;

-- TVMaze data is shared and not user-private; reads are public.
CREATE POLICY "Shows are viewable by everyone"
  ON public.shows FOR SELECT USING (true);

-- Any authenticated client can upsert. We accept the "any user can clobber
-- another user's TVMaze cache" risk because the value is deterministic per
-- show_id and self-heals via the cron. Edge functions use service role and
-- bypass RLS anyway.
CREATE POLICY "Authenticated users can insert shows"
  ON public.shows FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update shows"
  ON public.shows FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ─── Backfill from existing user_shows ──────────────────────────────────────
-- Pick the most-recently-updated row per show_id as the canonical snapshot.
-- Imperfect (recent progress bumps updated_at without touching TVMaze fields)
-- but the cron self-heals within hours, and any null fields get filled in on
-- the first show-detail visit.
INSERT INTO public.shows (
  show_id, show_title, show_image, show_network, show_status,
  next_episode_airdate, next_episode_season, next_episode_episode,
  last_aired_season, last_aired_episode, last_aired_airdate,
  returning_announced_at
)
SELECT DISTINCT ON (show_id)
  show_id, show_title, show_image, show_network, show_status,
  next_episode_airdate, next_episode_season, next_episode_episode,
  last_aired_season, last_aired_episode, last_aired_airdate,
  returning_announced_at
FROM public.user_shows
ORDER BY show_id, updated_at DESC;

-- ─── Drop the migrated columns from user_shows ──────────────────────────────
ALTER TABLE public.user_shows
  DROP COLUMN show_title,
  DROP COLUMN show_image,
  DROP COLUMN show_network,
  DROP COLUMN show_status,
  DROP COLUMN next_episode_airdate,
  DROP COLUMN next_episode_season,
  DROP COLUMN next_episode_episode,
  DROP COLUMN last_aired_season,
  DROP COLUMN last_aired_episode,
  DROP COLUMN last_aired_airdate,
  DROP COLUMN returning_announced_at;

-- ─── user_shows_full: flat read view ────────────────────────────────────────
-- Same column set the old user_shows had, so consuming code keeps reading the
-- same flat shape. Writes still go to user_shows (per-user) or shows (shared)
-- directly — never through the view.
CREATE VIEW public.user_shows_full
WITH (security_invoker = true) AS
SELECT
  us.user_id,
  us.show_id,
  us.status,
  us.current_season,
  us.current_episode,
  us.current_episode_airdate,
  us.caught_up,
  us.notify,
  us.rating,
  us.new_episodes_seen_at,
  us.returning_seen_at,
  us.last_notified_season,
  us.last_notified_episode,
  us.added_at,
  us.updated_at,
  s.show_title,
  s.show_image,
  s.show_network,
  s.show_status,
  s.next_episode_airdate,
  s.next_episode_season,
  s.next_episode_episode,
  s.last_aired_season,
  s.last_aired_episode,
  s.last_aired_airdate,
  s.returning_announced_at
FROM public.user_shows us
LEFT JOIN public.shows s ON s.show_id = us.show_id;
