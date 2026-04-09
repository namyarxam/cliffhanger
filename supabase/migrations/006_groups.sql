-- ============================================================================
-- Cliffhanger Mobile — Groups
-- Run this in your Supabase SQL Editor
-- ============================================================================

-- ─── Groups ─────────────────────────────────────────────────────────────────

CREATE TABLE public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  show_id TEXT NOT NULL,
  show_title TEXT NOT NULL,
  show_image TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_code TEXT UNIQUE NOT NULL DEFAULT substr(md5(random()::text), 1, 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Groups are readable by any authenticated user (needed for invite code lookup)
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Groups are viewable by authenticated users"
  ON public.groups FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create groups"
  ON public.groups FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Creator can update group"
  ON public.groups FOR UPDATE USING (auth.uid() = created_by);

CREATE POLICY "Creator can delete group"
  ON public.groups FOR DELETE USING (auth.uid() = created_by);

-- ─── Group Members ──────────────────────────────────────────────────────────

CREATE TABLE public.group_members (
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_members_user ON public.group_members (user_id);

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view group members"
  ON public.group_members FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM public.group_members gm WHERE gm.group_id = group_members.group_id));

CREATE POLICY "Users can join groups"
  ON public.group_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave or creator can remove"
  ON public.group_members FOR DELETE
  USING (
    auth.uid() = user_id
    OR auth.uid() IN (SELECT created_by FROM public.groups WHERE id = group_id)
  );

-- ─── Group Messages ─────────────────────────────────────────────────────────

CREATE TABLE public.group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (length(message) > 0 AND length(message) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_group_messages_group ON public.group_messages (group_id, created_at);

ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view group messages"
  ON public.group_messages FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM public.group_members WHERE group_id = group_messages.group_id));

CREATE POLICY "Members can send messages"
  ON public.group_messages FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND auth.uid() IN (SELECT user_id FROM public.group_members WHERE group_id = group_messages.group_id)
  );

-- ─── Enable Realtime for chat ───────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE group_messages;
