-- Track the latest episode we've already sent a push notification about,
-- per (user, show). Prevents duplicate pushes across polls for the same episode.
--
-- The poll-schedule Edge Function currently compares incoming episodes against
-- user_shows.current_{season,episode}, which never changes until the user
-- manually marks episodes watched. That means every 3-hour poll re-notifies
-- about any aired-but-unwatched episode. This column gives push de-dup its
-- own independent cursor.
--
-- Backfill to current_* so existing users don't get spammed for historical
-- episodes they already know about.

ALTER TABLE public.user_shows
  ADD COLUMN last_notified_season INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_notified_episode INTEGER NOT NULL DEFAULT 0;

UPDATE public.user_shows
SET last_notified_season = current_season,
    last_notified_episode = current_episode;
