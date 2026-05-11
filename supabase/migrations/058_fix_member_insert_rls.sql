-- Fix the RLS INSERT policies introduced in migration 057.
--
-- The original policies referenced `public.conversation_members` inside their
-- subqueries without aliasing the inner table. PostgreSQL resolves bare
-- `conversation_members.conversation_id` against the most local scope (the
-- subquery's FROM), so the WHERE clauses degenerated to column-equals-itself
-- — always true. The "Creator can self-join" NOT EXISTS therefore always
-- rejected (any row in the table satisfied the trivial WHERE), and the
-- "Members can add accepted friends" EXISTS would have looked for any
-- existing member of any conversation rather than this conversation.
--
-- Net effect: createConversation's first insert (creator → self) silently
-- failed RLS; the second insert (friend) then visibly failed because no
-- existing member was present to satisfy "Members can add". Users saw
-- "new row violates row-level security policy" on every chat creation.
--
-- Fix: alias the inner table references so `conversation_members.<col>` in
-- the WHERE unambiguously refers to the row being inserted. Also drop the
-- "no existing members" guard from the creator policy — the unique
-- (conversation_id, user_id) constraint already prevents duplicates, and
-- the guard was the source of the broken NOT EXISTS.

DROP POLICY IF EXISTS "Creator can self-join new conversation" ON public.conversation_members;
DROP POLICY IF EXISTS "Members can add accepted friends" ON public.conversation_members;

CREATE POLICY "Creator can self-join new conversation"
  ON public.conversation_members
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND auth.uid() = (SELECT created_by FROM public.conversations WHERE id = conversation_id)
  );

CREATE POLICY "Members can add accepted friends"
  ON public.conversation_members
  FOR INSERT
  WITH CHECK (
    auth.uid() <> user_id
    AND EXISTS (
      SELECT 1 FROM public.conversation_members AS existing
      WHERE existing.conversation_id = conversation_members.conversation_id
        AND existing.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.friendships AS f
      WHERE f.status = 'accepted'
        AND (
          (f.user_id = auth.uid() AND f.friend_id = conversation_members.user_id)
          OR (f.friend_id = auth.uid() AND f.user_id = conversation_members.user_id)
        )
    )
  );
