-- Enforce reasonable bounds on profile fields at the DB level so client-side
-- validation can't be bypassed. A 1MB display_name would break every chat header
-- and friend row in the UI.

-- Display name: cap at 40 characters. Any character allowed (accents, emoji, etc.).
-- No minimum: the handle_new_user() trigger defaults to empty string if no
-- metadata is provided, and the UI falls back to @username when display_name is blank.
ALTER TABLE public.profiles
  ADD CONSTRAINT display_name_length CHECK (length(display_name) <= 40);

-- Username: 3-24 characters, lowercase alphanumeric and underscore.
-- Matches the client-side normalization in sign-up.tsx and the handle_new_user
-- trigger fallback ('user_' || 8 hex chars).
ALTER TABLE public.profiles
  ADD CONSTRAINT username_format CHECK (username ~ '^[a-z0-9_]{3,24}$');
