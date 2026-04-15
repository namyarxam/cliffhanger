-- Add caught_up flag to user_shows so we don't depend on the schedule table
ALTER TABLE public.user_shows ADD COLUMN caught_up BOOLEAN NOT NULL DEFAULT false;
