-- Content moderation: blocks + reports.
-- Required for App Store Guideline 1.2 (user-generated content apps must allow
-- users to block other users and report abusive content).
--
-- Side-effects of a block (deleting friendships, DMs) are handled in the
-- moderation client lib, not triggers, so the logic is easier to reason about.

-- ─── Blocks ──────────────────────────────────────────────────────────────────

CREATE TABLE public.blocks (
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT no_self_block CHECK (blocker_id <> blocked_id)
);

CREATE INDEX idx_blocks_blocked ON public.blocks (blocked_id);

ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;

-- Blocker can read their own block list
CREATE POLICY "Users read own blocks"
  ON public.blocks FOR SELECT
  USING (auth.uid() = blocker_id);

-- Blocker can add blocks
CREATE POLICY "Users create own blocks"
  ON public.blocks FOR INSERT
  WITH CHECK (auth.uid() = blocker_id);

-- Blocker can remove blocks (unblock)
CREATE POLICY "Users delete own blocks"
  ON public.blocks FOR DELETE
  USING (auth.uid() = blocker_id);

-- ─── Reports ─────────────────────────────────────────────────────────────────

CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate', 'other')),
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_has_target CHECK (target_user_id IS NOT NULL OR target_message_id IS NOT NULL)
);

CREATE INDEX idx_reports_reporter ON public.reports (reporter_id);
CREATE INDEX idx_reports_target_user ON public.reports (target_user_id) WHERE target_user_id IS NOT NULL;
CREATE INDEX idx_reports_target_message ON public.reports (target_message_id) WHERE target_message_id IS NOT NULL;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Reporters can create reports against anyone; details visible to them only
CREATE POLICY "Users create reports"
  ON public.reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

-- Users can see their own submitted reports (for a potential "report history" UI)
CREATE POLICY "Users read own reports"
  ON public.reports FOR SELECT
  USING (auth.uid() = reporter_id);

-- NOTE: reports are reviewed manually via the Supabase dashboard.
-- No admin-facing UI is exposed to end users.
