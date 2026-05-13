-- Backfill conversation_members.last_active_at = joined_at for all remaining
-- NULL rows, so the new "unseen chats" badge doesn't flag every chat a user
-- has been sitting in without ever triggering bumpLastActive.
--
-- Why this is needed: until migration 061 (the UPDATE RLS policy fix),
-- bumpLastActive was silently no-op'ing under RLS, so last_active_at stayed
-- NULL on every member row that wasn't a creator (migration 060 had set
-- creators). With 061 in place, the column would finally start flipping —
-- but without this backfill, every existing member would see a backlog
-- badge of every chat they've ever been added to.
--
-- Going forward NULL means truly unseen (a friend just added me), which is
-- what the badge counts.

UPDATE public.conversation_members
SET last_active_at = joined_at
WHERE last_active_at IS NULL;
