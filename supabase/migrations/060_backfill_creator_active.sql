-- Backfill conversation_members.last_active_at = joined_at for the creator
-- row of each conversation, so the new "unseen chats" badge (counts members
-- where last_active_at IS NULL) doesn't immediately flag every chat its
-- creator already made.
--
-- Reasoning: createConversation inserts the creator's own conversation_members
-- row without setting last_active_at, so the column is NULL until they
-- open the chat detail screen and bumpLastActive fires. Going forward we'll
-- set last_active_at at creation time (separate code change). This migration
-- handles the rows already in the table.
--
-- Non-creator rows stay NULL by design — those represent chats a user was
-- added to but hasn't opened yet, which is exactly what the badge counts.

UPDATE public.conversation_members cm
SET last_active_at = cm.joined_at
WHERE cm.last_active_at IS NULL
  AND cm.user_id = (
    SELECT created_by FROM public.conversations WHERE id = cm.conversation_id
  );
