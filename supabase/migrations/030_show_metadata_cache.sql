-- Cache TVMaze show metadata on user_shows so My Shows can sub-group
-- "currently watching" rows by airing state without N round-trips to TVMaze.
--
-- next_episode_airdate: from `_embedded.nextepisode.airdate` on `/shows/:id`.
--   NULL means TVMaze has no scheduled next episode (show is between seasons
--   with no announced return → "On hiatus").
-- show_status: TVMaze's `status` field. "Running" | "Ended" |
--   "To Be Determined" | "In Development". Used to detect "Ended" → nudge to
--   move into Watched.
--
-- Both populated on addShow + every time the user opens the show detail page
-- (useShowData fires-and-forgets a cache write). Existing rows stay NULL until
-- the user navigates into them — graceful degradation, no backfill required.

ALTER TABLE public.user_shows
  ADD COLUMN next_episode_airdate DATE,
  ADD COLUMN show_status TEXT;
