-- Cache the last-aired episode on user_shows so the "Behind" detection on the
-- My Shows tab doesn't depend solely on the schedule cron. Self-healing: the
-- moment a user opens a show detail page, useShowData computes
-- getLastAiredEpisode() from the full season list and writes it here, so the
-- next list render shows the correct grouping even if the cron missed a poll.
--
-- NULL means we haven't cached anything yet (legacy rows or shows the user
-- hasn't viewed). The classifier treats NULL as "no signal" and falls back to
-- the schedule table.

ALTER TABLE public.user_shows
  ADD COLUMN last_aired_season INTEGER,
  ADD COLUMN last_aired_episode INTEGER;
