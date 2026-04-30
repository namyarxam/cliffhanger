-- Add a real "aired episode count" denominator to shows so the My Shows
-- progress bar can stop pretending every season has 10 episodes. Numerator
-- is COUNT(episode_watches) per (user, show); denominator is this column.
--
-- Populated by:
--   - addShow (client has the seasons array from TVMaze)
--   - cacheShowMetadata (show detail page, same source)
--   - refresh-show-metadata cron (fetches /shows/:id?embed[]=episodes)
--
-- NULL until first write — WatchlistCard treats NULL as "no signal" and
-- falls back to the old position-based heuristic so legacy rows don't render
-- a 0% bar.

ALTER TABLE public.shows ADD COLUMN total_aired_episodes INTEGER;

-- Recreate the view to expose the new column. DROP + CREATE keeps the
-- security_invoker option explicit; CREATE OR REPLACE works for additive
-- changes but the explicit recreate is easier to reason about.
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
  s.last_aired_season,
  s.last_aired_episode,
  s.last_aired_airdate,
  s.returning_announced_at,
  s.total_aired_episodes
FROM public.user_shows us
LEFT JOIN public.shows s ON s.show_id = us.show_id;
