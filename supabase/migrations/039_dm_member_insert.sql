-- Fix DM creation: the existing conversation_members INSERT policy only lets
-- you insert yourself (auth.uid() = user_id), but createConversation()'s DM
-- branch direct-inserts the friend as a member without using the invite flow.
-- That insert was silently RLS-rejected, so DM conversations ended up with
-- only the creator as a member — the recipient never saw them.
--
-- Add a second INSERT policy that lets the conversation creator add an
-- accepted friend as a member. Mirrors the conversation_invites INSERT
-- policy (creator + friendship check). Multiple INSERT policies are OR'd,
-- so the existing self-join policy still works for invite acceptance.

CREATE POLICY "Conversation creator can add friend members"
  ON public.conversation_members
  FOR INSERT
  WITH CHECK (
    auth.uid() = (SELECT created_by FROM public.conversations WHERE id = conversation_id)
    AND EXISTS (
      SELECT 1 FROM public.friendships
      WHERE status = 'accepted'
        AND (
          (user_id = auth.uid() AND friend_id = conversation_members.user_id)
          OR (friend_id = auth.uid() AND user_id = conversation_members.user_id)
        )
    )
  );

-- Cleanup: delete dangling 1-member, no-show, no-message conversations left
-- behind by past failed DM creations. The leave-cleanup trigger from
-- migration 023 handles future cases (deletes conversations when their last
-- member leaves), so this is a one-shot backfill.

DELETE FROM public.conversations c
WHERE c.show_id IS NULL
  AND (SELECT count(*) FROM public.conversation_members WHERE conversation_id = c.id) = 1
  AND NOT EXISTS (SELECT 1 FROM public.messages WHERE conversation_id = c.id);
