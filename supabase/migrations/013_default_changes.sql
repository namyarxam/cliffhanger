-- Change spoiler lock default to false
ALTER TABLE public.groups ALTER COLUMN spoiler_lock SET DEFAULT false;

-- show_posters_in_list stays default true (from migration 011)
