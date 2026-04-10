-- Returns the next unwatched aired episode per show for a user
CREATE OR REPLACE FUNCTION get_next_episodes_for_shows(p_user_id UUID)
RETURNS TABLE(show_id TEXT, next_season INT, next_episode INT) AS $$
  SELECT DISTINCT ON (us.show_id)
    us.show_id,
    s.season AS next_season,
    s.episode AS next_episode
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
