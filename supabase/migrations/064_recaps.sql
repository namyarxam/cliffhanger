-- Recap storage.
--
-- Recaps are generated offline (scripts/fetch-recap.mjs -> generate-spine.mjs)
-- and uploaded here. They are NOT bundled into the app binary, for three
-- reasons that all turned out to matter:
--
--   1. Shipping cadence. A show's finale airs and the recap needs to exist that
--      week, not in the next App Store release. Bundled content ties every
--      content update to a binary review cycle.
--   2. Payload. ~3.5 KB per season shipped, so 500 shows is only ~8 MB — but
--      that is 8 MB every user carries for shows they will never open.
--   3. The spoiler boundary. Seasons are separate rows, so a user asking for a
--      season-1 recap is only ever SENT season 1. The boundary stops being a
--      client-side clamp that a modified client could step past, and becomes a
--      property of what left the server.
--
-- Split into two tables rather than one JSONB blob per show specifically for
-- (3): per-season rows are what let the fetch be range-scoped.

-- --------------------------------------------------------------------------
-- recap_shows — one row per show that has a recap
-- --------------------------------------------------------------------------

create table if not exists recap_shows (
  slug            text primary key,
  -- The join key to everything else in the app. user_shows.show_id is a TVMaze
  -- id, so this is what makes "recap the shows you are actually behind on"
  -- possible; slug alone joins to nothing.
  show_id         text not null unique,
  title           text not null,
  overview        text,
  network         text,
  poster          text,
  backdrop        text,
  -- Total seasons the show HAS, which can exceed what we generated. Lets the
  -- UI say "recap covers S1-S4 of 6" honestly instead of implying coverage.
  total_seasons   int,
  -- Highest season we hold content for. Also the hard ceiling on any range
  -- request, enforced in get_recap below.
  through_season  int not null,
  generated_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists recap_shows_show_id_idx on recap_shows (show_id);

-- --------------------------------------------------------------------------
-- recap_seasons — one row per season
-- --------------------------------------------------------------------------

create table if not exists recap_seasons (
  slug         text not null references recap_shows (slug) on delete cascade,
  season       int  not null,
  -- [{ label, text, image }] — already composed against the chosen still, so
  -- the client does no picking. whyLoadBearing and the stills pool are
  -- generation-time only and deliberately not stored.
  beats        jsonb not null,
  -- { text, questions: [...] }
  cliffhanger  jsonb not null,
  -- [{ name, actor, line, note, image }]
  characters   jsonb not null,
  primary key (slug, season)
);

-- --------------------------------------------------------------------------
-- RLS — public read, no client writes
-- --------------------------------------------------------------------------
--
-- Recap content is not user data; every authenticated user sees the same rows.
-- Writes come from the upload script over the service-role key, which bypasses
-- RLS, so there is deliberately no insert/update/delete policy here at all.

alter table recap_shows   enable row level security;
alter table recap_seasons enable row level security;

drop policy if exists "recap shows are readable" on recap_shows;
create policy "recap shows are readable"
  on recap_shows for select
  to authenticated
  using (true);

drop policy if exists "recap seasons are readable" on recap_seasons;
create policy "recap seasons are readable"
  on recap_seasons for select
  to authenticated
  using (true);

-- --------------------------------------------------------------------------
-- get_recap — range-scoped fetch
-- --------------------------------------------------------------------------
--
-- The client asks for a range and receives only that range. p_through is
-- clamped to through_season server-side so a hand-edited request cannot pull
-- content past what we hold, and p_from is clamped to 1.

create or replace function get_recap(p_slug text, p_from int, p_through int)
returns table (season int, beats jsonb, cliffhanger jsonb, characters jsonb)
language sql
stable
security invoker
set search_path = public
as $$
  select s.season, s.beats, s.cliffhanger, s.characters
    from recap_seasons s
    join recap_shows sh on sh.slug = s.slug
   where s.slug = p_slug
     and s.season >= greatest(p_from, 1)
     and s.season <= least(p_through, sh.through_season)
   order by s.season;
$$;

-- --------------------------------------------------------------------------
-- recap_requests — user-driven generation queue
-- --------------------------------------------------------------------------
--
-- Rather than guessing which shows are worth generating, let demand say so.
-- A user who does not find their show requests it; the aggregate becomes the
-- work queue, ordered by how many people actually want each one.
--
-- show_id is a TVMaze id and is NOT a foreign key: the whole point is that the
-- show has no recap yet, and it may not be in `shows` either if nobody tracks
-- it. Title is denormalised for the same reason.

create table if not exists recap_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  show_id     text not null,
  show_title  text not null,
  show_image  text,
  created_at  timestamptz not null default now(),
  -- Set when a recap ships for this show, so the notifier can find who to tell
  -- and not tell them twice.
  notified_at timestamptz,
  unique (user_id, show_id)
);

create index if not exists recap_requests_show_idx on recap_requests (show_id);

alter table recap_requests enable row level security;

-- Users manage only their own requests. Reading someone else's would leak
-- watch intent, which is the same class of data as a watchlist.
drop policy if exists "own recap requests are readable" on recap_requests;
create policy "own recap requests are readable"
  on recap_requests for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users can request a recap" on recap_requests;
create policy "users can request a recap"
  on recap_requests for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can withdraw a request" on recap_requests;
create policy "users can withdraw a request"
  on recap_requests for delete
  to authenticated
  using (auth.uid() = user_id);

-- --------------------------------------------------------------------------
-- recap_request_counts — the generation queue
-- --------------------------------------------------------------------------
--
-- SECURITY DEFINER because the per-row RLS above restricts users to their own
-- requests; the aggregate is safe to expose (a count reveals nothing about who
-- asked) and is what makes "37 people want Andor" visible in the app.
-- Already-generated shows are excluded so the queue is only outstanding work.

create or replace function recap_request_counts()
returns table (show_id text, show_title text, show_image text, requests bigint)
language sql
stable
security definer
set search_path = public
as $$
  select r.show_id,
         min(r.show_title) as show_title,
         min(r.show_image) as show_image,
         count(*)          as requests
    from recap_requests r
   where not exists (select 1 from recap_shows s where s.show_id = r.show_id)
   group by r.show_id
   order by count(*) desc, min(r.show_title);
$$;

grant execute on function recap_request_counts() to authenticated;
grant execute on function get_recap(text, int, int) to authenticated;
