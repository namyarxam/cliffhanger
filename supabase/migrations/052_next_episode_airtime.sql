-- Add airtime + network timezone to the shared `shows` cache so the My Shows
-- row can render "Next episode Wednesday at 9PM" (converted to the viewer's
-- local clock) instead of just "Next episode in 3d" when an episode is within
-- the 3-day window. Both columns are nullable; WatchlistCard falls back to the
-- existing date-only copy when either is missing.
--
-- Populated by:
--   - addShow         (client extracts airtime from TVMaze nextepisode embed +
--                     timezone from network.country.timezone / webChannel
--                     equivalent on initial add)
--   - cacheShowMetadata (same path on every show-detail visit, so existing
--                     rows backfill organically as users open shows)

ALTER TABLE public.shows
  ADD COLUMN next_episode_airtime TIME,
  ADD COLUMN network_timezone TEXT;

-- Recreate user_shows_full to expose the new columns. Mirrors migration 038's
-- DROP + CREATE pattern so the security_invoker option stays explicit.
DROP VIEW public.user_shows_full;

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
  s.next_episode_airtime,
  s.last_aired_season,
  s.last_aired_episode,
  s.last_aired_airdate,
  s.returning_announced_at,
  s.total_aired_episodes,
  s.network_timezone
FROM public.user_shows us
LEFT JOIN public.shows s ON s.show_id = us.show_id;
