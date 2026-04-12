-- Add GIF support to messages
ALTER TABLE public.messages ADD COLUMN gif_url TEXT;

-- Allow message text to be nullable (GIF-only messages)
ALTER TABLE public.messages ALTER COLUMN message DROP NOT NULL;

-- Ensure at least one of message or gif_url is present
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_message_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_content_check
  CHECK (
    (message IS NOT NULL AND length(message) > 0 AND length(message) <= 2000)
    OR gif_url IS NOT NULL
  );
