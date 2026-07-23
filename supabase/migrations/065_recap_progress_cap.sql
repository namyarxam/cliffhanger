-- Cap recaps at the last season the viewer has actually finished.
--
-- This is the feature's central safety property, so it is enforced here
-- rather than in the client. A recap that runs one season past where you are
-- does not degrade the experience, it destroys the thing the feature exists
-- to protect, and it cannot be un-shown. Server-side means no client bug —
-- stale progress, an off-by-one on a season chip, a hand-edited deep link, a
-- render that beats the progress query — can leak a season: the rows are
-- never sent in the first place.
--
-- WHY episode_count LIVES HERE
--
-- Deciding "has this person finished season N" needs the number of episodes
-- in season N, and the database had no trustworthy source for it. `schedule`
-- is populated by polling TVMaze's schedule feed, so it only holds episodes
-- that aired since polling began — nothing for older seasons, which is
-- exactly where recaps operate. The fetch script already has the full episode
-- list per season, so the count is recorded at upload time and the cap
-- becomes exact arithmetic instead of an estimate.

alter table recap_seasons
  add column if not exists episode_count int;

-- --------------------------------------------------------------------------
-- recap_max_season — highest season this user is allowed to see
-- --------------------------------------------------------------------------
--
-- Returns 0 when the user cannot see anything: show not tracked, muted, or
-- no completed season yet. Zero rather than NULL so callers can compare
-- without null-handling at every site.
--
-- A season counts as finished when progress has moved past it, or when
-- progress sits on its final episode. Mid-season does NOT count — someone
-- five episodes into season 5 has not finished season 5, and showing them
-- its cliffhanger would spoil the episodes they have left. That rule is what
-- makes the current Expanse dataset (generated through season 4 for a viewer
-- mid-season-5) correct by construction rather than by hand-limiting.
--
-- status 'watched' means the whole show is done, so the cap is simply
-- whatever we hold content for. 'muted' returns 0 — a muted show should no
-- more surface a recap than it should surface a notification.

create or replace function recap_max_season(p_slug text)
returns int
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (
      select case
        when us.status = 'muted' then 0
        when us.status = 'watched' then sh.through_season
        else least(
          sh.through_season,
          coalesce((
            select max(rs.season)
              from recap_seasons rs
             where rs.slug = sh.slug
               and (
                 us.current_season > rs.season
                 or (
                   us.current_season = rs.season
                   and rs.episode_count is not null
                   and us.current_episode >= rs.episode_count
                 )
               )
          ), 0)
        )
      end
        from recap_shows sh
        join user_shows us
          on us.show_id = sh.show_id
         and us.user_id = auth.uid()
       where sh.slug = p_slug
    ),
    0
  );
$$;

-- --------------------------------------------------------------------------
-- get_recap — replaced to clamp against the cap
-- --------------------------------------------------------------------------
--
-- 064 clamped only to through_season (what we generated). That is no longer
-- sufficient: the binding limit is the tighter of what we hold and what the
-- viewer has earned. Requesting past either simply returns fewer rows, so a
-- hand-edited range degrades to less content rather than to a spoiler.

create or replace function get_recap(p_slug text, p_from int, p_through int)
returns table (season int, beats jsonb, cliffhanger jsonb, characters jsonb)
language sql
stable
security invoker
set search_path = public
as $$
  select s.season, s.beats, s.cliffhanger, s.characters
    from recap_seasons s
   where s.slug = p_slug
     and s.season >= greatest(p_from, 1)
     and s.season <= least(p_through, recap_max_season(p_slug))
   order by s.season;
$$;

-- --------------------------------------------------------------------------
-- list_recaps_for_user — the Recap tab's list
-- --------------------------------------------------------------------------
--
-- One call returns every recap plus the two things the list needs to rank
-- and render: how far this viewer may go (max_season, so season chips can be
-- drawn without a second round trip and without the client deriving the cap
-- itself), and when the show next airs.
--
-- next_episode_airdate is the ranking signal that makes the feature land at
-- the right moment. A recap surfaced the week a show returns is useful; the
-- same recap sitting in an alphabetical list is a catalogue nobody opens.
--
-- Shows the viewer does not track come back with max_season 0 and a null
-- status. They are returned rather than filtered so the tab can still offer
-- them as browsable, with their seasons locked until the show is added.

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
         s.next_episode_airdate
    from recap_shows sh
    left join user_shows us
      on us.show_id = sh.show_id
     and us.user_id = auth.uid()
    left join shows s
      on s.show_id = sh.show_id
   order by
     -- Returning soonest first, but only among shows the viewer can actually
     -- recap; everything else falls to the back regardless of air date.
     (recap_max_season(sh.slug) > 0) desc,
     (s.next_episode_airdate is not null and s.next_episode_airdate >= current_date) desc,
     s.next_episode_airdate asc nulls last,
     sh.title asc;
$$;

grant execute on function recap_max_season(text)  to authenticated;
grant execute on function get_recap(text, int, int) to authenticated;
grant execute on function list_recaps_for_user()  to authenticated;
