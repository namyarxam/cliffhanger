-- Three tiers on the Recap tab instead of two.
--
-- 067 ordered the list; the client then split it in two on
-- `max_season > 0 && watch_status !== 'watched'`. That rule conflated two
-- unrelated states and got a third one wrong:
--
--   * A recap you have not EARNED yet (nothing finished, untracked, muted) is
--     ahead of you. It becomes useful the moment you finish a season.
--   * A recap you have USED UP — the show has ended and you have seen all of
--     it — is behind you. Its only remaining use is nostalgia.
--   * A show you marked Finished that is still AIRING was being demoted, and
--     that is the single most useful recap in the list: the next season is
--     coming and the last one has gone.
--
-- So the bottom tier is the conjunction, not either half. "The show ended"
-- alone would bury The Expanse for a viewer on season 2, who needs it more
-- than anyone. "You marked it watched" alone buries next year's House of the
-- Dragon.
--
-- Computed here rather than on the client because the client does not have
-- shows.show_status on this screen, and because the ordering and the grouping
-- must agree — deriving them in two places is how they drift.

drop function if exists list_recaps_for_user();

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
  -- 0 live · 1 not yet earned · 2 spent. The client groups on this directly.
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
  ),
  tiered as (
    select entries.*,
           case
             when spent then 2
             when max_season > 0 then 0
             else 1
           end as tier
      from entries
  )
  select slug, show_id, title, overview, network, poster, backdrop,
         total_seasons, through_season, generated_at, max_season,
         watch_status, next_episode_airdate, tier
    from tiered
   order by
     -- Tier leads so the collapsed sections on the client never interleave.
     tier asc,
     group_rank asc,
     -- Within a tier: soonest return first, matching My Shows. Titles break
     -- the tie so the order is stable rather than arbitrary between renders.
     next_episode_airdate asc nulls last,
     title asc;
$$;

grant execute on function list_recaps_for_user() to authenticated;
