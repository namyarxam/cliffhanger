-- Schema for chat push notifications.
--
-- Three new fields:
--
-- 1. profiles.push_chat_messages — master toggle, default ON. Sits next to
--    push_new_episodes (default OFF, opt-in). Defaults differ because chat
--    messages are interactive social content users expect notifications
--    for; episode notifications are a side-feature most don't care about.
--
-- 2. conversation_members.muted — per-chat mute. Default OFF. Bell icon
--    in chat settings modal toggles it. Mirrors the per-show notify
--    pattern from migration 021.
--
-- 3. conversation_members.last_active_at — bumped from chat detail screen
--    on focus + on send. The notify Edge Function skips members whose
--    last_active_at is within the last 30s, so we don't push someone
--    sitting in the chat right now.

ALTER TABLE public.profiles
  ADD COLUMN push_chat_messages BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.conversation_members
  ADD COLUMN muted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.conversation_members
  ADD COLUMN last_active_at TIMESTAMPTZ;
