-- Stop returning recaps the viewer cannot open.
--
-- 069 gave those their own tier. This removes them instead, because there was
-- no good answer to "why is this on my Recap tab at all":
--
--   * Not on the watchlist — the row existed to advertise the catalogue. But
--     Explore is the discovery surface, and a Recap tab that mostly lists
--     things you cannot open is a worse version of both screens.
--   * On the watchlist, no season finished — you are already watching it, so
--     by definition you do not need a recap of it yet.
--   * Muted — the closest to a plain bug. recap_max_season already returns 0
--     for muted shows, so the CONTENT was protected, but the row still came
--     back from the join and the show kept appearing after an explicit
--     "stop showing me this".
--
-- The catalogue is still fully readable to anyone who asks for a specific
-- slug; get_recap is unchanged and remains the spoiler boundary. This narrows
-- one list, not access.
--
-- Tier values stay 0 and 2 rather than renumbering to 0 and 1. The numbers
-- mean something — earned-and-ahead vs used-up — and the gap is a truer record
-- of what happened than a tidy sequence would be.

create or replace function list_recaps_for_user()
returns table (
  slug                text,
  show_id             text,
  title               text,
  overview            text,
  network             text,
  poster              text,
  backdrop            text,
  total_seasons       int,
  through_season      int,
  generated_at        timestamptz,
  max_season          int,
  watch_status        text,
  next_episode_airdate date,
  -- 0 live · 2 spent. 1 (unearned) is no longer returned; see above.
  tier                int
)
language sql
stable
security invoker
set search_path = public
as $$
  with entries as (
    select sh.slug,
           sh.show_id,
           sh.title,
           sh.overview,
           sh.network,
           sh.poster,
           sh.backdrop,
           sh.total_seasons,
           sh.through_season,
           sh.generated_at,
           recap_max_season(sh.slug) as max_season,
           us.status::text           as watch_status,
           s.next_episode_airdate,
           -- Nothing more is coming AND the viewer has reached the end of it.
           -- total_seasons falls back to through_season so a show missing that
           -- metadata degrades to "not spent" — keeping a recap one tier too
           -- high is a smaller error than hiding one somebody still wants.
           (s.show_status = 'Ended'
             and (us.status::text = 'watched'
                  or recap_max_season(sh.slug)
                       >= coalesce(sh.total_seasons, sh.through_season))) as spent,
           case
             -- Not on the watchlist at all, or not being watched: everything
             -- below the four Currently Watching groups.
             when us.status is null or us.status <> 'currently_watching' then 5
             -- Behind on episodes that have already aired.
             when coalesce(s.last_aired_season, 0) > us.current_season
               or (coalesce(s.last_aired_season, 0) = us.current_season
                   and coalesce(s.last_aired_episode, 0) > us.current_episode) then 0
             -- Caught up, next episode imminent — still "Watching".
             when s.next_episode_airdate is not null
              and s.next_episode_airdate <= current_date + 14 then 1
             -- Caught up, next episode further out — "Returning".
             when s.next_episode_airdate is not null then 2
             -- Finished show with nothing scheduled — "Series Ended".
             when s.show_status = 'Ended' then 4
             -- Airing show with nothing scheduled — "On Hiatus".
             else 3
           end as group_rank
      from recap_shows sh
      left join user_shows us
        on us.show_id = sh.show_id
       and us.user_id = auth.uid()
      left join shows s
        on s.show_id = sh.show_id
  )
  select slug, show_id, title, overview, network, poster, backdrop,
         total_seasons, through_season, generated_at, max_season,
         watch_status, next_episode_airdate,
         case when spent then 2 else 0 end as tier
    from entries
   -- The whole change. max_season > 0 is exactly "this viewer has finished a
   -- season of this show", which is exactly when a recap becomes openable, and
   -- it already covers muted and untracked shows because recap_max_season
   -- returns 0 for both.
   where max_season > 0
   order by
     -- Spent shows last, so the collapsed section on the client never
     -- interleaves with the cards above it.
     (case when spent then 2 else 0 end) asc,
     group_rank asc,
     -- Within a tier: soonest return first, matching My Shows. Titles break
     -- the tie so the order is stable rather than arbitrary between renders.
     next_episode_airdate asc nulls last,
     title asc;
$$;

grant execute on function list_recaps_for_user() to authenticated;
