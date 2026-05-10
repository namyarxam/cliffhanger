-- Replace the airtime + network_timezone pair (added in 052) with a single
-- next_episode_airstamp TIMESTAMPTZ. Reason: TVMaze leaves `airtime` blank on
-- the /shows/:id?embed[]=nextepisode response for many shows (especially
-- streamers) but reliably populates `airstamp` — a fully-qualified ISO 8601
-- timestamp with the network's UTC offset already applied. Storing the
-- absolute instant skips the timezone conversion gymnastics entirely.

-- Drop the view first — Postgres refuses to drop columns the view depends on.
DROP VIEW public.user_shows_full;

ALTER TABLE public.shows
  ADD COLUMN next_episode_airstamp TIMESTAMPTZ,
  DROP COLUMN next_episode_airtime,
  DROP COLUMN network_timezone;

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
  s.next_episode_airstamp,
  s.last_aired_season,
  s.last_aired_episode,
  s.last_aired_airdate,
  s.returning_announced_at,
  s.total_aired_episodes
FROM public.user_shows us
LEFT JOIN public.shows s ON s.show_id = us.show_id;
