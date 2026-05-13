-- Add missing UPDATE RLS policy on conversation_members.
--
-- Migration 014 created SELECT/INSERT/DELETE policies but never an UPDATE
-- policy, so every `.update()` against this table has been silently no-op'ing
-- under RLS (no error, 0 rows affected). This broke:
--
--   - bumpLastActive — last_active_at stayed NULL forever, so the Chat tab
--     unseen badge (migration 060 era) never cleared after opening a chat,
--     and notify-message could never suppress pushes for users sitting in
--     the chat (broken since migration 043 added last_active_at).
--   - setConversationMuted — per-chat mute toggle silently did nothing.
--
-- Users may only update their own membership row.

CREATE POLICY "Users can update own membership"
  ON public.conversation_members
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
