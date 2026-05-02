-- Pre-aggregated watched-episode counts. Powers the My Shows progress-bar
-- numerator. Replaces a client-side approach that selected every
-- episode_watches row and counted in JS — that path hit PostgREST's default
-- 1000-row limit for power users, returning a different non-deterministic
-- slice each request and producing wildly inconsistent progress bars on
-- the same data across loads.
--
-- security_invoker = true makes the view honor the calling user's RLS,
-- so the existing "users can only read their own watches" policy on
-- episode_watches carries over with no new policy needed.

CREATE OR REPLACE VIEW public.user_episode_watch_counts
WITH (security_invoker = true) AS
SELECT user_id, show_id, COUNT(*)::int AS watched_count
FROM public.episode_watches
GROUP BY user_id, show_id;

-- Tell PostgREST to refresh its schema cache so the view is queryable
-- immediately without a project restart.
NOTIFY pgrst, 'reload schema';
