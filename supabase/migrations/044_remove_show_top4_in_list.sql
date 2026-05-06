-- Remove the "Show Favorites in My Shows" toggle column.
--
-- The feature surfaced the user's display list (Top 4) at the top of the
-- My Shows screen behind a Settings toggle. Decision: drop the feature
-- entirely on My Shows. The display list itself stays — still rendered
-- on Profile and friend-profile screens — only the My Shows surface and
-- its Settings toggle are being removed.
--
-- Original column added in migration 011, default flipped to false in
-- migration 018.

ALTER TABLE public.profiles
  DROP COLUMN show_top4_in_list;
