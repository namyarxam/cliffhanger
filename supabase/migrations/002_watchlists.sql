-- ============================================================================
-- Cliffhanger Mobile — Watchlists
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================================

-- ─── User Shows (Watchlist) ────────────────────────────────────────────────
-- Tracks which shows a user has added and their current status/progress.
-- show_title and show_image are denormalized from TVMaze so the My Shows
-- tab can render without hitting the API for every row.

CREATE TABLE public.user_shows (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  show_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('want_to_watch', 'currently_watching', 'watched')),
  show_title TEXT NOT NULL,
  show_image TEXT,
  current_season INTEGER NOT NULL DEFAULT 0,
  current_episode INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, show_id)
);

CREATE INDEX idx_user_shows_user_status ON public.user_shows (user_id, status);

-- ─── Episode Watches ───────────────────────────────────────────────────────
-- Individual episode tracking. Source of truth for what a user has watched.

CREATE TABLE public.episode_watches (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  show_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  episode INTEGER NOT NULL,
  watched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, show_id, season, episode)
);

CREATE INDEX idx_episode_watches_user_show ON public.episode_watches (user_id, show_id);

-- ─── Row Level Security ─────────────────────────────────────────────────────
-- Lists are public-read (for future friend/group features), owner-write.

ALTER TABLE public.user_shows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User shows are viewable by everyone"
  ON public.user_shows FOR SELECT USING (true);

CREATE POLICY "Users can insert own shows"
  ON public.user_shows FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own shows"
  ON public.user_shows FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own shows"
  ON public.user_shows FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.episode_watches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Episode watches are viewable by everyone"
  ON public.episode_watches FOR SELECT USING (true);

CREATE POLICY "Users can insert own episode watches"
  ON public.episode_watches FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own episode watches"
  ON public.episode_watches FOR DELETE USING (auth.uid() = user_id);
