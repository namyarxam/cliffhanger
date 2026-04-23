-- Fix reports FK deletion behavior.
--
-- Migration 025 set target_user_id and target_message_id to ON DELETE SET NULL,
-- which violates the report_has_target check constraint when a referenced user
-- or message is deleted (both targets become NULL simultaneously → check fails →
-- DELETE blocked). Change both to ON DELETE CASCADE so reports are removed
-- alongside their targets. Semantically correct: a report about a deleted user
-- is no longer actionable.
--
-- reporter_id stays ON DELETE SET NULL — anonymous reports are fine and don't
-- violate any constraint.

ALTER TABLE public.reports
  DROP CONSTRAINT reports_target_user_id_fkey,
  ADD CONSTRAINT reports_target_user_id_fkey
    FOREIGN KEY (target_user_id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;

ALTER TABLE public.reports
  DROP CONSTRAINT reports_target_message_id_fkey,
  ADD CONSTRAINT reports_target_message_id_fkey
    FOREIGN KEY (target_message_id)
    REFERENCES public.messages(id)
    ON DELETE CASCADE;
