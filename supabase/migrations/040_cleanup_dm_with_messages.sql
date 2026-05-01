-- Follow-up to migration 039's DM cleanup. The original cleanup spared
-- conversations that had any messages, but those messages were sent into
-- the void — the intended recipient was never added as a member because
-- of the RLS bug, so they couldn't read any of it. Deleting the
-- conversation here loses nothing anyone has actually seen.

DELETE FROM public.conversations c
WHERE c.show_id IS NULL
  AND (SELECT count(*) FROM public.conversation_members WHERE conversation_id = c.id) = 1;
