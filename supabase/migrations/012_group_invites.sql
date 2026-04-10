-- Group invites table (replaces invite codes)
CREATE TABLE public.group_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_user UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')) DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, invited_user)
);

CREATE INDEX idx_group_invites_user ON public.group_invites (invited_user, status);
CREATE INDEX idx_group_invites_group ON public.group_invites (group_id, status);

-- RLS
ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;

-- Invitees and group members can view invites
CREATE POLICY "Users can view their own invites" ON public.group_invites
  FOR SELECT USING (
    auth.uid() = invited_user
    OR auth.uid() = invited_by
    OR auth.uid() IN (SELECT user_id FROM public.group_members WHERE group_id = group_invites.group_id)
  );

-- Group members can invite their friends
CREATE POLICY "Group members can create invites" ON public.group_invites
  FOR INSERT WITH CHECK (
    auth.uid() = invited_by
    AND EXISTS (SELECT 1 FROM public.group_members WHERE group_id = group_invites.group_id AND user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.friendships
      WHERE status = 'accepted'
      AND (
        (user_id = auth.uid() AND friend_id = group_invites.invited_user)
        OR (friend_id = auth.uid() AND user_id = group_invites.invited_user)
      )
    )
  );

-- Only the invited user can accept/decline
CREATE POLICY "Invited user can update invite" ON public.group_invites
  FOR UPDATE USING (auth.uid() = invited_user);

-- Drop invite_code from groups
ALTER TABLE public.groups DROP COLUMN invite_code;
