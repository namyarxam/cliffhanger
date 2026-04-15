-- New user settings: hide ratings
ALTER TABLE public.profiles ADD COLUMN hide_ratings BOOLEAN NOT NULL DEFAULT false;
