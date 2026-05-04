-- Audit-driven RLS tightening before public launch.
--
-- Three issues caught by a pre-launch RLS audit:
--
-- 1. CRITICAL — episode_watches SELECT was `USING (true)` (mig 002), making
--    every user's episode-by-episode watch history readable by anyone with
--    the anon key. Lock to self. Verified that every client read path
--    (getWatchedEpisodes, getWatchedCounts via the user_episode_watch_counts
--    view, EpisodeCatchUpSheet) only reads the current user's own data —
--    no cross-user reads to preserve. The view already runs with
--    security_invoker=true so the new policy carries through.
--
-- 2. HIGH — conversation_members SELECT was `auth.role() = 'authenticated'`
--    (mig 014), letting any signed-in user enumerate the membership of
--    every DM/group in the database (you could see exactly who was DMing
--    whom). Tighten to "you're in the same conversation OR you're an
--    invitee." A SECURITY DEFINER helper avoids RLS recursion the same way
--    is_conversation_invitee did in mig 014.
--
-- 3. MEDIUM — profiles UPDATE had USING but no WITH CHECK (mig 001).
--    PK + auth.users FK already contain the practical risk, but adding
--    WITH CHECK is the correct belt-and-suspenders form for an UPDATE
--    policy.

-- ─── 1. Lock episode_watches SELECT to self ─────────────────────────────────

DROP POLICY IF EXISTS "Episode watches are viewable by everyone"
  ON public.episode_watches;

CREATE POLICY "Users can view own episode watches"
  ON public.episode_watches FOR SELECT
  USING (auth.uid() = user_id);

-- ─── 2. Tighten conversation_members SELECT ─────────────────────────────────

-- SECURITY DEFINER helper: am I a member of this conversation? Bypasses RLS
-- on conversation_members itself, which is what lets us scope the SELECT
-- policy below without infinite recursion (you can't read the members table
-- to gate reading the members table).
CREATE OR REPLACE FUNCTION is_conversation_member(conv_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = conv_id
    AND user_id = uid
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DROP POLICY IF EXISTS "Authenticated users can view conversation members"
  ON public.conversation_members;

CREATE POLICY "Members and invitees can view conversation members"
  ON public.conversation_members FOR SELECT
  USING (
    is_conversation_member(conversation_id, auth.uid())
    OR is_conversation_invitee(conversation_id, auth.uid())
  );

-- ─── 3. profiles UPDATE WITH CHECK ──────────────────────────────────────────

DROP POLICY IF EXISTS "Users can update own profile"
  ON public.profiles;

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
