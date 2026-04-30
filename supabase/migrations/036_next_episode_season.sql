-- Cache the season + episode number of the next upcoming episode (in addition
-- to its date, which we already cache). Lets the home-screen classification
-- distinguish "user is mid-season, next ep is in the same season they're
-- watching" (Watching) from "user finished their current season, next ep
-- starts a new season they haven't engaged with" (Returning) — without
-- needing season episode counts or a per-render TVMaze fetch.
--
-- Populated by:
--   - refresh-show-metadata cron (alongside next_episode_airdate)
--   - addShow when a user first tracks the show
--   - cacheShowMetadata when the user opens a show detail page

ALTER TABLE public.user_shows
  ADD COLUMN next_episode_season INT,
  ADD COLUMN next_episode_episode INT;
