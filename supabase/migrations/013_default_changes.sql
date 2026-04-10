-- Change spoiler lock default to false
ALTER TABLE public.groups ALTER COLUMN spoiler_lock SET DEFAULT false;

-- Change show_posters_in_list default to false
ALTER TABLE public.profiles ALTER COLUMN show_posters_in_list SET DEFAULT false;
