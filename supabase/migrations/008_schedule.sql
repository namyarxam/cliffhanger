-- ============================================================================
-- Cliffhanger Mobile — Schedule + Push Notifications
-- Run this in your Supabase SQL Editor
-- ============================================================================

-- ─── Schedule ───────────────────────────────────────────────────────────────
-- Stores episodes fetched from TVMaze schedule API by Edge Function

CREATE TABLE public.schedule (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  show_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  episode INTEGER NOT NULL,
  episode_name TEXT,
  airdate DATE NOT NULL,
  airtime TIME,
  runtime INTEGER,
  network TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (show_id, season, episode)
);

CREATE INDEX idx_schedule_show ON public.schedule (show_id);
CREATE INDEX idx_schedule_airdate ON public.schedule (airdate DESC);

ALTER TABLE public.schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Schedule is viewable by everyone"
  ON public.schedule FOR SELECT USING (true);

-- ─── New episodes seen tracking ─────────────────────────────────────────────

ALTER TABLE public.user_shows
  ADD COLUMN new_episodes_seen_at TIMESTAMPTZ;

-- ─── Push notification tokens ───────────────────────────────────────────────

CREATE TABLE public.push_tokens (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, expo_push_token)
);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own push tokens"
  ON public.push_tokens FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own push tokens"
  ON public.push_tokens FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own push tokens"
  ON public.push_tokens FOR DELETE USING (auth.uid() = user_id);

-- ─── Notification preferences ───────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN push_new_episodes BOOLEAN NOT NULL DEFAULT false;

-- ─── Database function: find shows with new episodes for a user ─────────────

CREATE OR REPLACE FUNCTION get_shows_with_new_episodes(p_user_id UUID)
RETURNS TABLE(show_id TEXT) AS $$
  SELECT DISTINCT us.show_id
  FROM user_shows us
  JOIN schedule s ON s.show_id = us.show_id
  WHERE us.user_id = p_user_id
    AND us.status = 'currently_watching'
    AND (
      s.season > us.current_season
      OR (s.season = us.current_season AND s.episode > us.current_episode)
    )
    AND s.airdate <= CURRENT_DATE
    AND (us.new_episodes_seen_at IS NULL OR s.created_at > us.new_episodes_seen_at)
$$ LANGUAGE sql STABLE;
