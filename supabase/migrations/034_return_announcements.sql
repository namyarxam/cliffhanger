-- Surface a "Coming back!" banner on My Shows when one of the user's currently
-- watching shows transitions hiatus → returning. The transition is detected by
-- the refresh-show-metadata cron when next_episode_airdate flips null → non-null.
--
-- announced_at: stamped by the cron at the moment of the transition.
-- seen_at:      stamped by the client when the user views/dismisses the banner.
--
-- Banner predicate: announced_at > COALESCE(seen_at, '-infinity')
--                   AND next_episode_airdate >= today
-- Once seen, banner doesn't re-fire until a fresh hiatus → returning transition
-- (cron resets seen_at to NULL when stamping a new announced_at).

ALTER TABLE public.user_shows
  ADD COLUMN returning_announced_at TIMESTAMPTZ,
  ADD COLUMN returning_seen_at TIMESTAMPTZ;
