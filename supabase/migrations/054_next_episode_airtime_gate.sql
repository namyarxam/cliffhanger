-- Re-add next_episode_airtime alongside the airstamp added in 053. Used as a
-- presence gate, not for display: when TVMaze leaves `airtime` blank on the
-- nextepisode embed, the `airstamp` it returns is a placeholder (defaults to
-- noon UTC) — common for streamers like Prime / Apple TV+ / MGM+. The
-- WatchlistCard formatter renders the timed copy only when airtime is
-- non-null; otherwise it falls back to date-only ("Returns today",
-- "Returns in 3d") so we don't show a confidently-wrong time.

DROP VIEW public.user_shows_full;

ALTER TABLE public.shows
  ADD COLUMN next_episode_airtime TIME;

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
  s.next_episode_airtime,
  s.last_aired_season,
  s.last_aired_episode,
  s.last_aired_airdate,
  s.returning_announced_at,
  s.total_aired_episodes
FROM public.user_shows us
LEFT JOIN public.shows s ON s.show_id = us.show_id;
