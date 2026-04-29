-- Add behind_count to the next-episodes RPC so the home screen can decide
-- between "single catchup" (count = 1) and "multi-behind" (count >= 2)
-- treatment using the schedule table directly, instead of relying on the
-- last_aired_* cache that only refreshes when the user opens the show
-- detail page. Before this, the "Catch up · N" pill would stay stuck at
-- N=1 (or whatever was cached) when a new episode aired, until the user
-- visited the show — defeating the purpose of the home-screen indicator.
--
-- Postgres rejects changing the return type of an existing function via
-- CREATE OR REPLACE, so DROP + CREATE.

DROP FUNCTION IF EXISTS get_next_episodes_for_shows(UUID);

CREATE FUNCTION get_next_episodes_for_shows(p_user_id UUID)
RETURNS TABLE(
  show_id TEXT,
  next_season INT,
  next_episode INT,
  next_airdate DATE,
  behind_count INT
) AS $$
  WITH unwatched AS (
    SELECT
      us.show_id,
      s.season,
      s.episode,
      s.airdate,
      ROW_NUMBER() OVER (PARTITION BY us.show_id ORDER BY s.season, s.episode) AS rn,
      COUNT(*) OVER (PARTITION BY us.show_id) AS cnt
    FROM user_shows us
    JOIN schedule s ON s.show_id = us.show_id
    WHERE us.user_id = p_user_id
      AND us.status = 'currently_watching'
      AND s.airdate <= CURRENT_DATE
      AND (
        s.season > us.current_season
        OR (s.season = us.current_season AND s.episode > us.current_episode)
      )
  )
  SELECT
    show_id,
    season AS next_season,
    episode AS next_episode,
    airdate AS next_airdate,
    cnt::INT AS behind_count
  FROM unwatched
  WHERE rn = 1
$$ LANGUAGE sql STABLE;
