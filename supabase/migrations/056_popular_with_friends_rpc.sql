-- Server-side aggregation for the "Popular with Friends" carousel.
--
-- Before: client fetches every friend's full watchlist over the wire, then
-- groups + counts in JS. With 50 friends × 100 shows that's 5,000 rows on
-- every Explore-tab open.
--
-- After: a single RPC returns just the top-N already-aggregated shows. The
-- function runs SECURITY INVOKER so RLS on friendships / user_shows /
-- profiles still applies — the caller can only see friends they're allowed
-- to see, and only watchlists those friends share.

CREATE OR REPLACE FUNCTION public.get_popular_with_friends(
  p_user_id UUID,
  p_limit INT DEFAULT 25
)
RETURNS TABLE (
  show_id TEXT,
  show_title TEXT,
  show_image TEXT,
  friend_count INT,
  friend_names TEXT[],
  latest_add TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH friends AS (
    SELECT CASE WHEN user_id = p_user_id THEN friend_id ELSE user_id END AS friend_id
    FROM public.friendships
    WHERE status = 'accepted'
      AND (user_id = p_user_id OR friend_id = p_user_id)
  ),
  my_shows AS (
    SELECT show_id FROM public.user_shows WHERE user_id = p_user_id
  ),
  friend_shows AS (
    SELECT
      us.show_id,
      us.added_at,
      p.display_name
    FROM public.user_shows us
    JOIN friends f ON f.friend_id = us.user_id
    JOIN public.profiles p ON p.id = us.user_id
    WHERE us.status <> 'muted'
      AND us.show_id NOT IN (SELECT show_id FROM my_shows)
  )
  SELECT
    fs.show_id,
    s.show_title,
    s.show_image,
    COUNT(*)::INT AS friend_count,
    ARRAY_AGG(fs.display_name ORDER BY fs.added_at DESC) AS friend_names,
    MAX(fs.added_at) AS latest_add
  FROM friend_shows fs
  LEFT JOIN public.shows s ON s.show_id = fs.show_id
  GROUP BY fs.show_id, s.show_title, s.show_image
  ORDER BY friend_count DESC, latest_add DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_popular_with_friends(UUID, INT) TO authenticated;
