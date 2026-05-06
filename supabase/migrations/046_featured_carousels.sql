-- Schema for the two new explore carousels: Airing This Week + Top Rated.
--
-- Both store just (show_id, rank). Display metadata (title/image/network)
-- comes from the centralized `shows` table via JOIN — no denormalization
-- here since the shows row is the source of truth for poster + name.
--
-- Airing This Week: refreshed by a daily Edge Function cron that pulls
-- TVMaze /schedule/full, applies the v1 filter (Scripted, non-broadcast,
-- non-procedural-franchise, English-speaking-or-major-streamer), takes
-- top 15 by weight desc / rating desc, and replaces the table.
--
-- Top Rated: one-time hand seeded from a filtered IMDB Top 250 (90 entries
-- after removing mini-series except Chernobyl + dropping regional-fanbase
-- shows). Updated quarterly by editing the table in the Supabase UI.

CREATE TABLE public.airing_this_week (
  show_id TEXT PRIMARY KEY REFERENCES public.shows(show_id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_airing_this_week_rank ON public.airing_this_week (rank);

CREATE TABLE public.top_rated_shows (
  show_id TEXT PRIMARY KEY REFERENCES public.shows(show_id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_top_rated_shows_rank ON public.top_rated_shows (rank);

-- Public-read, no client writes — both tables are server-managed (cron for
-- airing, manual for top-rated). Same posture as the `shows` table itself.
ALTER TABLE public.airing_this_week ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Airing this week is publicly readable"
  ON public.airing_this_week FOR SELECT USING (true);

ALTER TABLE public.top_rated_shows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Top rated shows is publicly readable"
  ON public.top_rated_shows FOR SELECT USING (true);
