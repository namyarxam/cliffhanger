-- Per-show notification opt-in
ALTER TABLE public.user_shows ADD COLUMN notify BOOLEAN NOT NULL DEFAULT false;
