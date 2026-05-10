-- Denormalize last_message text + sender onto conversations so chat-list
-- previews don't require fetching every message in every conversation.
--
-- Before: getMyConversations pulled the full messages table for the user's
-- conversations to find the latest message per chat. O(total_messages) per
-- chat-list render, gets visibly slow once conversations have >100 messages.
--
-- After: conversation rows carry last_message_text + last_message_user_id,
-- updated by the existing trg_update_last_message trigger on insert. The
-- chat list reads them directly off the conversation row.
--
-- last_message_text is nullable because GIF-only messages have NULL message
-- text — the chat list already renders nothing in that case (matches prior
-- behavior).

ALTER TABLE public.conversations
  ADD COLUMN last_message_text TEXT,
  ADD COLUMN last_message_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill from the latest message in each conversation.
UPDATE public.conversations c
SET last_message_text = m.message,
    last_message_user_id = m.user_id
FROM (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, message, user_id
  FROM public.messages
  ORDER BY conversation_id, created_at DESC
) m
WHERE m.conversation_id = c.id;

-- Expand the existing trigger function to also write the denormalized fields.
-- The trigger itself (trg_update_last_message) doesn't need to be re-created.
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at,
      last_message_text = NEW.message,
      last_message_user_id = NEW.user_id
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
