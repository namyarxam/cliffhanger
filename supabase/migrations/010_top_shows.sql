CREATE TABLE public.top_shows (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1 AND position <= 4),
  show_id TEXT NOT NULL,
  show_title TEXT NOT NULL,
  show_image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, position),
  UNIQUE (user_id, show_id)
);

ALTER TABLE public.top_shows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Top shows are viewable by everyone"
  ON public.top_shows FOR SELECT USING (true);

CREATE POLICY "Users can manage own top shows"
  ON public.top_shows FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own top shows"
  ON public.top_shows FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own top shows"
  ON public.top_shows FOR DELETE USING (auth.uid() = user_id);
