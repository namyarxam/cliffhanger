-- Rename watch status `dropped` → `muted`.
--
-- Product reframe: the status was originally a "I started this and quit"
-- signal but is being repurposed as a universal "don't surface this in
-- explore" signal. Same column, same semantics for the user, friendlier
-- name and broader applicability (you can mute a show you never started).
--
-- Drop the existing CHECK, migrate every row, reapply with the new value.

ALTER TABLE public.user_shows DROP CONSTRAINT user_shows_status_check;

UPDATE public.user_shows SET status = 'muted' WHERE status = 'dropped';

ALTER TABLE public.user_shows ADD CONSTRAINT user_shows_status_check
  CHECK (status IN ('want_to_watch', 'currently_watching', 'watched', 'muted'));
