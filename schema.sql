-- ============================================================================
-- From Fat to Fit — Supabase schema
--
-- Privacy model:
--   - Each person's starting weight, personal goal weight, and every
--     weigh-in they log lives in tables protected by row-level security
--     (RLS): a user's own login can only ever read/write THEIR OWN rows.
--     This is enforced by Postgres itself, not by the front-end hiding a
--     column.
--   - The leaderboard is produced by a single SECURITY DEFINER function
--     (`get_leaderboard`) that is allowed to read everyone's rows internally,
--     but it only ever RETURNS display_name + percent_lost + rank. There is
--     no code path, and no table grant, that lets a client pull anyone
--     else's raw weight, pounds-lost, or goal.
--   - Your own full stats (starting weight, current weight, lbs lost, %
--     lost, goal weight, and progress toward that goal) come from
--     `get_my_stats`, which only ever looks at your own rows. Your goal is
--     set with `set_goal` and is exactly as private as your starting weight
--     — it never factors into the leaderboard, which is driven only by
--     percent of starting weight lost.
--
-- Run this whole file once in the Supabase SQL editor (or `supabase db push`).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table if not exists public.challenges (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  join_code   text not null unique,        -- short code family members use to join, e.g. "CLARK2026"
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- One row per (user, challenge). Holds the sensitive starting weight and
-- (optionally) a personal goal weight. Both are private to the user — see
-- the RLS policies below — and neither ever feeds the leaderboard, which is
-- driven only by percent of starting weight lost (get_leaderboard).
create table if not exists public.participants (
  user_id         uuid not null references auth.users (id) on delete cascade,
  challenge_id    uuid not null references public.challenges (id) on delete cascade,
  display_name    text not null,
  starting_weight numeric(6, 2) not null check (starting_weight > 0),
  goal_weight     numeric(6, 2) check (goal_weight is null or goal_weight > 0),
  joined_at       timestamptz not null default now(),
  primary key (user_id, challenge_id)
);

-- Safe to run again on a database created from an earlier version of this
-- file — adds the goal weight column if it isn't there yet.
alter table public.participants
  add column if not exists goal_weight numeric(6, 2) check (goal_weight is null or goal_weight > 0);

-- Many rows per user: every weigh-in they log. Also sensitive.
create table if not exists public.weigh_ins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  challenge_id  uuid not null references public.challenges (id) on delete cascade,
  weight        numeric(6, 2) not null check (weight > 0),
  recorded_on   date not null default current_date,
  created_at    timestamptz not null default now(),
  foreign key (user_id, challenge_id) references public.participants (user_id, challenge_id) on delete cascade
);

create index if not exists weigh_ins_user_challenge_idx
  on public.weigh_ins (user_id, challenge_id, recorded_on desc);

-- ----------------------------------------------------------------------------
-- Row-level security — this is what actually keeps weights private
-- ----------------------------------------------------------------------------

alter table public.challenges   enable row level security;
alter table public.participants enable row level security;
alter table public.weigh_ins    enable row level security;

-- Challenges: anyone signed in can look up a challenge by id/join_code
-- (needed to join), but only see challenges they created or already joined.
drop policy if exists "challenges_select" on public.challenges;
create policy "challenges_select" on public.challenges
  for select using (
    created_by = auth.uid()
    or exists (
      select 1 from public.participants p
      where p.challenge_id = challenges.id and p.user_id = auth.uid()
    )
  );

drop policy if exists "challenges_insert" on public.challenges;
create policy "challenges_insert" on public.challenges
  for insert with check (created_by = auth.uid());

-- Participants: you can only ever see / change YOUR OWN row.
-- This is the policy that stops anyone from reading another person's
-- starting_weight, even by querying the table directly.
drop policy if exists "participants_select_own" on public.participants;
create policy "participants_select_own" on public.participants
  for select using (user_id = auth.uid());

drop policy if exists "participants_insert_own" on public.participants;
create policy "participants_insert_own" on public.participants
  for insert with check (user_id = auth.uid());

drop policy if exists "participants_update_own" on public.participants;
create policy "participants_update_own" on public.participants
  for update using (user_id = auth.uid());

-- Weigh-ins: same rule — only your own rows, ever.
drop policy if exists "weigh_ins_select_own" on public.weigh_ins;
create policy "weigh_ins_select_own" on public.weigh_ins
  for select using (user_id = auth.uid());

drop policy if exists "weigh_ins_insert_own" on public.weigh_ins;
create policy "weigh_ins_insert_own" on public.weigh_ins
  for insert with check (user_id = auth.uid());

drop policy if exists "weigh_ins_update_own" on public.weigh_ins;
create policy "weigh_ins_update_own" on public.weigh_ins
  for update using (user_id = auth.uid());

drop policy if exists "weigh_ins_delete_own" on public.weigh_ins;
create policy "weigh_ins_delete_own" on public.weigh_ins
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- join_challenge(join_code, display_name, starting_weight)
-- Lets a family member join with a code, setting their own starting weight.
-- ----------------------------------------------------------------------------

create or replace function public.join_challenge(
  p_join_code       text,
  p_display_name    text,
  p_starting_weight numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge_id uuid;
begin
  select id into v_challenge_id
  from public.challenges
  where join_code = p_join_code;

  if v_challenge_id is null then
    raise exception 'No challenge found for that join code';
  end if;

  if p_starting_weight is null or p_starting_weight <= 0 then
    raise exception 'Starting weight must be a positive number';
  end if;

  insert into public.participants (user_id, challenge_id, display_name, starting_weight)
  values (auth.uid(), v_challenge_id, p_display_name, p_starting_weight)
  on conflict (user_id, challenge_id) do nothing;

  return v_challenge_id;
end;
$$;

grant execute on function public.join_challenge(text, text, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- create_challenge(name) -> creates a challenge + a random join code,
-- and returns both. Whoever creates it still has to join separately with
-- their own starting weight, same as anyone else.
-- ----------------------------------------------------------------------------

create or replace function public.create_challenge(
  p_name text
) returns table (id uuid, join_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_code text;
begin
  -- 6-character, easy-to-read join code (no 0/O/1/I confusion)
  v_code := (
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ceil(random() * 32)::int, 1), '')
    from generate_series(1, 6)
  );

  insert into public.challenges (id, name, join_code, created_by)
  values (v_id, p_name, v_code, auth.uid());

  return query select v_id, v_code;
end;
$$;

grant execute on function public.create_challenge(text) to authenticated;

-- ----------------------------------------------------------------------------
-- get_my_stats(challenge_id) — your own full numbers. Only ever reads rows
-- where user_id = auth.uid(), so RLS alone would already block anyone else's
-- data even without this function; it just packages your numbers together.
-- ----------------------------------------------------------------------------

create or replace function public.get_my_stats(
  p_challenge_id uuid
) returns table (
  display_name     text,
  starting_weight  numeric,
  current_weight   numeric,
  lbs_lost         numeric,
  percent_lost     numeric,
  last_weigh_in    date,
  weigh_in_count   bigint,
  goal_weight      numeric,
  lbs_to_goal      numeric,
  goal_percent     numeric
)
language sql
security invoker
set search_path = public
as $$
  with mine as (
    select p.display_name, p.starting_weight, p.goal_weight
    from public.participants p
    where p.challenge_id = p_challenge_id and p.user_id = auth.uid()
  ),
  latest as (
    select w.weight as current_weight, w.recorded_on as last_weigh_in
    from public.weigh_ins w
    where w.challenge_id = p_challenge_id and w.user_id = auth.uid()
    order by w.recorded_on desc, w.created_at desc
    limit 1
  ),
  cnt as (
    select count(*) as weigh_in_count
    from public.weigh_ins w
    where w.challenge_id = p_challenge_id and w.user_id = auth.uid()
  )
  select
    mine.display_name,
    mine.starting_weight,
    coalesce(latest.current_weight, mine.starting_weight),
    round(mine.starting_weight - coalesce(latest.current_weight, mine.starting_weight), 2),
    round(
      100 * (mine.starting_weight - coalesce(latest.current_weight, mine.starting_weight))
      / mine.starting_weight,
      2
    ),
    latest.last_weigh_in,
    cnt.weigh_in_count,
    mine.goal_weight,
    -- lbs still to lose to reach the goal (0 once at or past it)
    case
      when mine.goal_weight is null then null
      else round(greatest(coalesce(latest.current_weight, mine.starting_weight) - mine.goal_weight, 0), 2)
    end,
    -- % of the way from starting weight to goal weight, clamped to [0, 100]
    case
      when mine.goal_weight is null or mine.starting_weight = mine.goal_weight then null
      else round(
        greatest(least(
          100 * (mine.starting_weight - coalesce(latest.current_weight, mine.starting_weight))
          / (mine.starting_weight - mine.goal_weight),
        100), 0),
        1
      )
    end
  from mine, cnt
  left join latest on true;
$$;

grant execute on function public.get_my_stats(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- set_goal(challenge_id, goal_weight) — lets you set or clear (pass null)
-- your own personal goal weight. security invoker + the participants RLS
-- policy (user_id = auth.uid()) is what actually restricts this to your own
-- row; the function just validates the input. Nobody else can ever read or
-- write this value — it's not returned by get_leaderboard, and the
-- participants table itself is only ever selectable by its own row's owner.
-- ----------------------------------------------------------------------------

create or replace function public.set_goal(
  p_challenge_id uuid,
  p_goal_weight  numeric
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_goal_weight is not null and p_goal_weight <= 0 then
    raise exception 'Goal weight must be a positive number';
  end if;

  update public.participants
  set goal_weight = p_goal_weight
  where challenge_id = p_challenge_id and user_id = auth.uid();

  if not found then
    raise exception 'You are not a participant in this challenge';
  end if;
end;
$$;

grant execute on function public.set_goal(uuid, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- get_leaderboard(challenge_id) — the ONLY way percent-lost numbers for
-- other people ever leave the database. SECURITY DEFINER lets it read
-- across all participants internally, but the return type has no weight
-- or lbs-lost column at all, so there's nothing sensitive to leak.
-- It also refuses to run unless the caller is a participant in that
-- challenge, so a random authenticated user can't query someone else's
-- family's leaderboard by guessing a challenge id.
-- ----------------------------------------------------------------------------

create or replace function public.get_leaderboard(
  p_challenge_id uuid
) returns table (
  rank          bigint,
  display_name  text,
  percent_lost  numeric,
  is_you        boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.participants
    where challenge_id = p_challenge_id and user_id = auth.uid()
  ) then
    raise exception 'Not a participant in this challenge';
  end if;

  return query
  with latest_weight as (
    select
      p.user_id,
      p.display_name,
      p.starting_weight,
      coalesce(
        (
          select w.weight
          from public.weigh_ins w
          where w.user_id = p.user_id and w.challenge_id = p.challenge_id
          order by w.recorded_on desc, w.created_at desc
          limit 1
        ),
        p.starting_weight
      ) as current_weight
    from public.participants p
    where p.challenge_id = p_challenge_id
  ),
  scored as (
    select
      display_name,
      user_id,
      round(100 * (starting_weight - current_weight) / starting_weight, 2) as percent_lost
    from latest_weight
  )
  select
    rank() over (order by percent_lost desc) as rank,
    display_name,
    percent_lost,
    user_id = auth.uid() as is_you
  from scored
  order by percent_lost desc, display_name asc;
end;
$$;

grant execute on function public.get_leaderboard(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Lock down the base tables from direct client access to the raw columns.
-- The app should only ever call the functions above for anything
-- cross-person; RLS above still governs direct reads of your OWN rows
-- (used for "log a weigh-in" and your own history chart).
-- ----------------------------------------------------------------------------

revoke all on public.participants from anon;
revoke all on public.weigh_ins   from anon;
