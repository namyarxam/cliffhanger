-- ─── Unified Conversations (replaces groups) ─────────────────────────────────

-- New tables
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  show_id TEXT,
  show_title TEXT,
  show_image TEXT,
  spoiler_lock BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.conversation_members (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (length(message) > 0 AND length(message) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.conversation_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_user UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')) DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, invited_user)
);

-- Indexes
CREATE INDEX idx_conversation_members_user ON public.conversation_members (user_id);
CREATE INDEX idx_messages_conversation ON public.messages (conversation_id, created_at);
CREATE INDEX idx_conversation_invites_user ON public.conversation_invites (invited_user, status);
CREATE INDEX idx_conversation_invites_conv ON public.conversation_invites (conversation_id, status);

-- Auto-update last_message_at on new messages
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_last_message
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION update_conversation_last_message();

-- ─── Migrate existing data ───────────────────────────────────────────────────

INSERT INTO public.conversations (id, name, show_id, show_title, show_image, spoiler_lock, created_by, created_at, last_message_at)
SELECT id, name, show_id, show_title, show_image, spoiler_lock, created_by, created_at, created_at
FROM public.groups;

INSERT INTO public.conversation_members (conversation_id, user_id, joined_at)
SELECT group_id, user_id, joined_at FROM public.group_members;

INSERT INTO public.messages (id, conversation_id, user_id, message, created_at)
SELECT id, group_id, user_id, message, created_at FROM public.group_messages;

INSERT INTO public.conversation_invites (id, conversation_id, invited_by, invited_user, status, created_at)
SELECT id, group_id, invited_by, invited_user, status, created_at FROM public.group_invites;

-- Backfill last_message_at from actual messages
UPDATE public.conversations c SET last_message_at = COALESCE(
  (SELECT MAX(created_at) FROM public.messages WHERE conversation_id = c.id),
  c.created_at
);

-- ─── Drop old tables ─────────────────────────────────────────────────────────

DROP TABLE public.group_messages;
DROP TABLE public.group_invites;
DROP TABLE public.group_members;
DROP TABLE public.groups;

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_invites ENABLE ROW LEVEL SECURITY;

-- Helper to check invite status without RLS circularity
CREATE OR REPLACE FUNCTION is_conversation_invitee(conv_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_invites
    WHERE conversation_id = conv_id
    AND invited_user = uid
    AND status = 'pending'
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Conversations: creator, members, and invitees can view
CREATE POLICY "Members and creator can view conversations" ON public.conversations
  FOR SELECT USING (
    auth.uid() = created_by
    OR auth.uid() IN (SELECT user_id FROM public.conversation_members WHERE conversation_id = id)
    OR is_conversation_invitee(id, auth.uid())
  );

CREATE POLICY "Authenticated users can create conversations" ON public.conversations
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Creator can update conversation" ON public.conversations
  FOR UPDATE USING (auth.uid() = created_by);

CREATE POLICY "Creator can delete conversation" ON public.conversations
  FOR DELETE USING (auth.uid() = created_by);

-- Conversation members (broad SELECT avoids infinite recursion; conversations table gates visibility)
CREATE POLICY "Authenticated users can view conversation members" ON public.conversation_members
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can join conversations" ON public.conversation_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave conversations" ON public.conversation_members
  FOR DELETE USING (auth.uid() = user_id);

-- Messages
CREATE POLICY "Members can view messages" ON public.messages
  FOR SELECT USING (
    auth.uid() IN (SELECT user_id FROM public.conversation_members WHERE conversation_id = messages.conversation_id)
  );

CREATE POLICY "Members can send messages" ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND auth.uid() IN (SELECT user_id FROM public.conversation_members WHERE conversation_id = messages.conversation_id)
  );

-- Conversation invites
CREATE POLICY "Users can view their invites" ON public.conversation_invites
  FOR SELECT USING (
    auth.uid() = invited_user
    OR auth.uid() = invited_by
    OR auth.uid() IN (SELECT user_id FROM public.conversation_members WHERE conversation_id = conversation_invites.conversation_id)
  );

CREATE POLICY "Members can create invites" ON public.conversation_invites
  FOR INSERT WITH CHECK (
    auth.uid() = invited_by
    AND EXISTS (SELECT 1 FROM public.conversation_members WHERE conversation_id = conversation_invites.conversation_id AND user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.friendships
      WHERE status = 'accepted'
      AND (
        (user_id = auth.uid() AND friend_id = conversation_invites.invited_user)
        OR (friend_id = auth.uid() AND user_id = conversation_invites.invited_user)
      )
    )
  );

CREATE POLICY "Invited user can update invite" ON public.conversation_invites
  FOR UPDATE USING (auth.uid() = invited_user);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
