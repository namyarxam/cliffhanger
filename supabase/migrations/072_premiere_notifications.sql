-- Premiere notifications: the per-episode push system is retired in favour of
-- one automatic, no-opt-in notification — "your show is coming back" — sent
-- the week a new season of a tracked show premieres.
--
-- Detection needs no new polling: refresh-show-metadata (the healthy cron)
-- already maintains shows.next_episode_{season,episode,airdate} and
-- last_aired_season. A premiere is next_episode_episode = 1 with
-- next_episode_season above the last aired one (or a brand-new show with
-- nothing aired). The notify-premieres function scans for premieres within
-- the next 7 days, pushes to every non-muted tracker, and stamps this table.
--
-- The stamp is the rock-solid part: one row per (user, show, season), primary
-- key enforced, written only after Expo accepts the batch. Re-runs, overlapping
-- crons, and rescheduled premiere dates can never double-send — the worst
-- failure mode is a missed stamp, which re-sends once, not a loop.

CREATE TABLE public.premiere_notifications (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  show_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, show_id, season)
);

-- Service-role only: RLS on with no policies. Clients never read or write
-- this; it exists solely as the sender's dedup ledger.
ALTER TABLE public.premiere_notifications ENABLE ROW LEVEL SECURITY;

-- ─── push_tokens upsert fix ────────────────────────────────────────────────
-- Registration upserts on the (user_id, expo_push_token) PK, but the table
-- only had INSERT/SELECT/DELETE policies — the ON CONFLICT UPDATE arm was
-- silently rejected on every re-registration. Harmless (the row already
-- existed) but every re-register errored invisibly.

CREATE POLICY "Users can update own push tokens"
  ON public.push_tokens FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Cron (run these in the Dashboard SQL editor after deploying) ──────────
--
-- Two jobs. Check `select jobid, jobname, schedule, command from cron.job;`
-- first — poll-schedule's old job died ~2026-04-20 (last schedule row that
-- date); if a broken job remains, cron.unschedule it before re-adding.
-- Replace <ANON_KEY> with the current anon key from .env.
--
-- select cron.schedule(
--   'poll-schedule', '0 */3 * * *',
--   $$select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/poll-schedule',
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb,
--     body := '{}'::jsonb)$$
-- );
--
-- select cron.schedule(
--   'notify-premieres', '0 15 * * *',
--   $$select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-premieres',
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb,
--     body := '{}'::jsonb)$$
-- );
