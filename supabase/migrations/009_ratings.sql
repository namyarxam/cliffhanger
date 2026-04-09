ALTER TABLE public.user_shows ADD COLUMN rating NUMERIC(3,1) CHECK (rating >= 1.0 AND rating <= 10.0);
