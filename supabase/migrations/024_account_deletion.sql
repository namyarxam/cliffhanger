-- Account deletion prep: creator deleting their account should leave
-- conversations intact (orphaned), not cascade-kill every member's messages.
-- Empty conversations self-clean via the trigger added in migration 023.

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_created_by_fkey;
ALTER TABLE public.conversations ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
