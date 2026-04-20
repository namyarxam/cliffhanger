-- Add an opt-in so users don't have to flip the bell on every show individually.
-- When true, the poll-schedule Edge Function treats every currently_watching
-- show as if its notify flag were on, without mutating user_shows.notify.
-- Per-show bells remain an independent override.

ALTER TABLE public.profiles
  ADD COLUMN notify_all_current BOOLEAN NOT NULL DEFAULT false;
