-- Add 'dropped' as a valid watch status
ALTER TABLE public.user_shows DROP CONSTRAINT user_shows_status_check;
ALTER TABLE public.user_shows ADD CONSTRAINT user_shows_status_check
  CHECK (status IN ('want_to_watch', 'currently_watching', 'watched', 'dropped'));
