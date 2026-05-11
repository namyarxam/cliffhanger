-- Make the last-message denorm trigger bypass RLS.
--
-- Bug: conversations RLS only allows UPDATEs by the conversation creator
-- ("Creator can update conversation" policy from migration 014). The trigger
-- function `update_conversation_last_message` runs as SECURITY INVOKER by
-- default, so when a non-creator member inserts a message, the trigger
-- fires but its UPDATE to conversations is silently RLS-rejected (0 rows
-- affected, no error raised). Result: chat-list previews freeze at the
-- last message sent by the creator and never reflect anyone else's posts.
--
-- Fix: switch the function to SECURITY DEFINER so it runs with the owner's
-- privileges. Trigger-only path — the function is only invoked via the
-- AFTER INSERT trigger on messages, so there's no surface for misuse
-- (a user can only trigger it by inserting a message they're already
-- authorized to insert, and the update is constrained to that message's
-- conversation_id).
--
-- SET search_path is the standard defensive measure for SECURITY DEFINER
-- functions — without it, a caller could shadow `public.conversations`
-- via search_path manipulation.

CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at,
      last_message_text = NEW.message,
      last_message_user_id = NEW.user_id
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

-- Backfill conversations that have stale last_message_text from messages
-- sent while the trigger was failing for non-creators. Uses DISTINCT ON to
-- pick the latest message per conversation.
UPDATE public.conversations c
SET last_message_at = m.created_at,
    last_message_text = m.message,
    last_message_user_id = m.user_id
FROM (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, message, user_id, created_at
  FROM public.messages
  ORDER BY conversation_id, created_at DESC
) m
WHERE m.conversation_id = c.id
  AND (
    c.last_message_at < m.created_at
    OR c.last_message_text IS DISTINCT FROM m.message
    OR c.last_message_user_id IS DISTINCT FROM m.user_id
  );
