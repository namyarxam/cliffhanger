-- Remove creator's unilateral delete power; "leave" is the only exit.
-- Empty conversations get cleaned up by a trigger on conversation_members.

DROP POLICY IF EXISTS "Creator can delete conversation" ON public.conversations;

CREATE OR REPLACE FUNCTION delete_conversation_if_empty()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_members WHERE conversation_id = OLD.conversation_id
  ) THEN
    DELETE FROM public.conversations WHERE id = OLD.conversation_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_delete_conversation_if_empty
AFTER DELETE ON public.conversation_members
FOR EACH ROW EXECUTE FUNCTION delete_conversation_if_empty();
