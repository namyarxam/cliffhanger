-- Let viewers flag a recap frame that is wrong.
--
-- Every serious defect found so far was found by a person looking at a slide,
-- and none of them tripped an automated check. Rhaenyra Targaryen's card
-- carried Matt Smith's photo and credit; Dark Matter's entire spine described
-- a different series with the same title; Helena Eagan was attributed to her
-- father. Each passed coverage, length, ordering, spoiler-scan and
-- well-formedness, because those verify SHAPE and every one of these was a
-- correctly shaped lie.
--
-- Automated gates cannot close that category, so the readers are the gate.
-- This is the channel.
--
-- A table rather than an email. Three people flagging one frame is a signal a
-- single message cannot carry, reports can be counted and deduplicated, and
-- the result is a work queue in the same shape as recap_requests rather than
-- an inbox. An email notification can be layered on later without changing
-- any of this.

create table if not exists recap_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  slug        text not null references recap_shows (slug) on delete cascade,

  -- WHERE the problem is. This is most of the value: "Severance season 2 is
  -- wrong" costs a full re-read, while "season 2, character card 3, wrong
  -- photo" is a one-line fix. Recorded as the frame's own coordinates rather
  -- than an index, since regenerating a recap renumbers frames but a
  -- character keeps their name.
  season      int,
  frame_kind  text,
  frame_label text,

  reason      text not null check (reason in (
    'wrong_photo',      -- picture or actor credit is not this character
    'wrong_facts',      -- the text is factually wrong about the show
    'spoiler',          -- reveals something past the season being recapped
    'wrong_show',       -- content belongs to a different series
    'other'
  )),
  note        text check (note is null or length(note) <= 500),

  created_at  timestamptz not null default now(),
  resolved_at timestamptz,

  -- One report per person per frame. A viewer tapping twice is not two
  -- signals, and the count is what decides priority.
  unique (user_id, slug, season, frame_label, reason)
);

create index if not exists recap_reports_open_idx
  on recap_reports (slug, season) where resolved_at is null;

alter table recap_reports enable row level security;

-- Users see and file only their own. The aggregate is exposed separately.
drop policy if exists "own recap reports are readable" on recap_reports;
create policy "own recap reports are readable"
  on recap_reports for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users can report a recap" on recap_reports;
create policy "users can report a recap"
  on recap_reports for insert to authenticated
  with check (auth.uid() = user_id);

-- --------------------------------------------------------------------------
-- recap_report_counts — the fix queue
-- --------------------------------------------------------------------------
--
-- SECURITY DEFINER because per-row RLS keeps users to their own reports while
-- the aggregate is safe to read, and ordering by count puts the frames most
-- people noticed first. Spoiler reports sort above everything regardless of
-- count: a spoiler is the one defect the feature exists to prevent, and it
-- cannot be un-shown to the person who hit it.

create or replace function recap_report_counts()
returns table (
  slug        text,
  title       text,
  season      int,
  frame_kind  text,
  frame_label text,
  reason      text,
  reports     bigint,
  latest_note text,
  last_seen   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.slug,
         min(sh.title) as title,
         r.season,
         min(r.frame_kind) as frame_kind,
         r.frame_label,
         r.reason,
         count(*) as reports,
         (array_remove(array_agg(r.note order by r.created_at desc), null))[1] as latest_note,
         max(r.created_at) as last_seen
    from recap_reports r
    join recap_shows sh on sh.slug = r.slug
   where r.resolved_at is null
   group by r.slug, r.season, r.frame_label, r.reason
   order by (r.reason = 'spoiler') desc, count(*) desc, max(r.created_at) desc;
$$;

grant execute on function recap_report_counts() to authenticated;
