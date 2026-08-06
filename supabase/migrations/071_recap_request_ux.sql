-- Request-a-recap UX: search state in one round trip, and a place to record
-- "we looked at this show and recaps don't fit it".
--
-- recap_requests itself shipped in 064 (per-user rows, dedupe, withdraw,
-- notified_at). What was missing is what the SEARCH screen needs: given the
-- TVMaze ids on a results page, which already have recaps, which were
-- declined, how many people asked, and did *I* ask.

-- ---------------------------------------------------------------------------
-- recap_declined — shows evaluated and rejected, with a reason the app can say
-- ---------------------------------------------------------------------------
--
-- Without this, a rejected show is indistinguishable from an ignored one, and
-- its request button becomes a black hole. `reason` is the eligibility
-- verdict verbatim (internal); `public_reason` is the sentence the app shows.
-- Written by the pipeline (service role); read by clients only through the
-- RPC below, so there are no client policies.

create table if not exists recap_declined (
  show_id       text primary key,
  show_title    text not null,
  reason        text not null,
  public_reason text not null,
  declined_at   timestamptz not null default now()
);

alter table recap_declined enable row level security;

-- ---------------------------------------------------------------------------
-- recap_search_state — everything a search results page needs, one call
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER for the same reason as recap_request_counts: per-row RLS
-- on recap_requests restricts users to their own rows, but an aggregate count
-- and a "did I request it" flag leak nothing about anyone else. recap_shows
-- exposure here is metadata only (slug + season bounds) — recap CONTENT stays
-- behind get_recap and its per-viewer season cap.

create or replace function recap_search_state(p_show_ids text[])
returns table (
  show_id         text,
  slug            text,
  through_season  int,
  total_seasons   int,
  declined_reason text,
  requests        bigint,
  requested_by_me boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ids.show_id,
    sh.slug,
    sh.through_season,
    sh.total_seasons,
    d.public_reason,
    (select count(*) from recap_requests r where r.show_id = ids.show_id),
    exists (
      select 1 from recap_requests r
      where r.show_id = ids.show_id and r.user_id = auth.uid()
    )
  from unnest(p_show_ids) as ids(show_id)
  left join recap_shows sh on sh.show_id = ids.show_id
  left join recap_declined d on d.show_id = ids.show_id;
$$;
