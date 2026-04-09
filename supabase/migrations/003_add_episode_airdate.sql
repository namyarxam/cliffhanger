-- Add current episode airdate to user_shows for display on My Shows list
ALTER TABLE public.user_shows ADD COLUMN current_episode_airdate TEXT;
