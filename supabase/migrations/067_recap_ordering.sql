-- Order the Recap tab the way My Shows is ordered.
--
-- 065 sorted purely by next air date, so a show returning soonest led the
-- list regardless of whether the viewer was actually watching it. The result
-- was that shows on the watchlist right now — the ones a recap is FOR — sat
-- below shows that merely had an episode scheduled.
--
-- The two screens should agree. If My Shows puts The Expanse, Silo and House
-- of the Dragon at the top, the recap for those shows should be at the top
-- too; a different order on a different tab reads as a different app.
--
-- This mirrors the grouping in app/(tabs)/index.tsx, which splits
-- currently_watching into four sub-groups rendered in this order:
--
--   Watching       actively airing — either behind on aired episodes, or
--                  caught up with the next episode inside the ~14-day window
--   Returning      caught up, next episode further out (between seasons)
--   On Hiatus      not airing, nothing scheduled
--   Series Ended   TVMaze reports the show as finished
--
-- The client computes "behind" partly from an RPC and a local cache, which is
-- not available here, so behind-ness is derived from the same underlying
-- columns instead: progress sitting before the last aired episode. Close
-- enough that the two lists agree in practice, and it degrades to the
-- caught-up branch rather than mis-ordering when the metadata is missing.

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
  next_episode_airdate date
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
         watch_status, next_episode_airdate
    from entries
   order by
     -- Recaps the viewer can actually open lead, so the collapsed second tier
     -- on the client never interleaves with the first.
     (max_season > 0) desc,
     group_rank asc,
     -- Within a group: soonest return first, matching My Shows. Titles break
     -- the tie so the order is stable rather than arbitrary between renders.
     next_episode_airdate asc nulls last,
     title asc;
$$;

grant execute on function list_recaps_for_user() to authenticated;
