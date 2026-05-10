-- Remove the chat-invite system entirely. New behavior: when a user creates
-- a chat or adds a friend from chat settings, the friend is dropped straight
-- into conversation_members with no accept/decline step. This kills the
-- half-accepted state that left users stuck looking at chats they couldn't
-- post into, and removes the confusing "Invite" UI.
--
-- Steps:
--   1. Wipe all existing conversations. Per user request — current chats are
--      tiny test data and the invite flow has corrupted some of them.
--      ON DELETE CASCADE on conversation_members / conversation_invites /
--      messages cleans up child rows.
--   2. Drop the conversation_invites table.
--   3. Replace the conversation_members INSERT policy. Today migration 014
--      lets you insert yourself (auth.uid() = user_id) — that was the
--      invite-acceptance path. Migration 039 added "creator can add a friend
--      member" for DM creation. We collapse both into a single policy:
--      "any existing member can add an accepted friend." That covers
--      DM creation (creator is the first member, adding the other), group
--      creation (creator adds friends), and post-creation Add (any current
--      member adds one of their friends).
--
-- Self-join (auth.uid() = user_id) is no longer needed since invites are
-- gone, but we keep it under a tightened condition for robustness — a user
-- can still insert themselves only if they aren't already a member (i.e. on
-- a fresh DM, the creator inserting themselves first).

BEGIN;

-- 1. Wipe all conversations (cascades to members/invites/messages).
DELETE FROM public.conversations;

-- 2. Drop the invites table.
DROP TABLE IF EXISTS public.conversation_invites CASCADE;

-- 3. Replace the INSERT policies on conversation_members.
DROP POLICY IF EXISTS "Users can join conversations" ON public.conversation_members;
DROP POLICY IF EXISTS "Conversation creator can add friend members" ON public.conversation_members;

-- Allow self-insert for the creator's first row (no prior members exist yet).
CREATE POLICY "Creator can self-join new conversation"
  ON public.conversation_members
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND auth.uid() = (SELECT created_by FROM public.conversations WHERE id = conversation_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.conversation_members
      WHERE conversation_id = conversation_members.conversation_id
    )
  );

-- Allow any existing member to add an accepted friend as a new member.
-- This is the path used by chat creation (creator adds initial friends) and
-- by the Add button in chat settings (any member adds a friend post-creation).
CREATE POLICY "Members can add accepted friends"
  ON public.conversation_members
  FOR INSERT
  WITH CHECK (
    auth.uid() <> user_id
    AND EXISTS (
      SELECT 1 FROM public.conversation_members existing
      WHERE existing.conversation_id = conversation_members.conversation_id
        AND existing.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.friendships
      WHERE status = 'accepted'
        AND (
          (user_id = auth.uid() AND friend_id = conversation_members.user_id)
          OR (friend_id = auth.uid() AND user_id = conversation_members.user_id)
        )
    )
  );

COMMIT;
