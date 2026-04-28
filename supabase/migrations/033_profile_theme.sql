-- Persist the user's selected theme palette server-side so it syncs across
-- devices (sign in on a second phone → your saved theme follows). AsyncStorage
-- still holds the value locally as a fast-boot cache; this is the source of
-- truth that the cache reconciles against on profile fetch.
--
-- NULL = user hasn't picked one yet (default to navy in the client).
-- Constrained to the four palette names defined in src/lib/theme.ts.

ALTER TABLE public.profiles
  ADD COLUMN theme TEXT
  CHECK (theme IS NULL OR theme IN ('navy', 'smoke', 'plum', 'paper'));
