-- Cache the airdate of the last-aired episode + return airdate from the
-- next-episode RPC. Both feed the "NEW" label on the My Shows card, which now
-- only fires when the specific episode the user is being prompted to mark
-- aired in the last 7 days. Without this, NEW reads weirdly on old shows
-- (e.g., "NEW S1 E10" on Band of Brothers from 2001).

ALTER TABLE public.user_shows
  ADD COLUMN last_aired_airdate DATE;

-- Extend the schedule-path RPC to also return airdate, so the card can decide
-- whether to surface "NEW" without a second query. Postgres rejects changing
-- the return type via CREATE OR REPLACE, so drop and recreate.
DROP FUNCTION IF EXISTS get_next_episodes_for_shows(UUID);

CREATE FUNCTION get_next_episodes_for_shows(p_user_id UUID)
RETURNS TABLE(show_id TEXT, next_season INT, next_episode INT, next_airdate DATE) AS $$
  SELECT DISTINCT ON (us.show_id)
    us.show_id,
    s.season AS next_season,
    s.episode AS next_episode,
    s.airdate AS next_airdate
  FROM user_shows us
  JOIN schedule s ON s.show_id = us.show_id
  WHERE us.user_id = p_user_id
    AND us.status = 'currently_watching'
    AND s.airdate <= CURRENT_DATE
    AND (
      s.season > us.current_season
      OR (s.season = us.current_season AND s.episode > us.current_episode)
    )
  ORDER BY us.show_id, s.season, s.episode
$$ LANGUAGE sql STABLE;
