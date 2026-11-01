-- Corporate Ladder · Daily Challenges v0.1
--
-- One shared puzzle per game and UTC day, one ranked attempt per player.
-- Additive: reuses game_sessions, game_results, the XP ledger and contribution
-- events unchanged. A daily round is an ordinary verified session plus an
-- attempt row linking it to the day's challenge.
--
--   * daily_assignments: the recurring assignments (Daily Audit, Daily Sales
--     Briefing) with their game and generation strategy version.
--   * daily_challenges: one row per assignment and UTC date, created on first
--     use. Holds the shared puzzle seed (strategy DC1: 2 × 122 random bits,
--     drawn once by the database), the pinned rules version and the opening
--     window. No client role can read this table at all.
--   * daily_challenge_attempts: one per (challenge, player), primary key.
--     Created together with the session, so starting reserves the attempt.
--
-- Shared seed vs. existing protections: every daily session gets its own
-- random session seed ("DS1-…"), which is what game_sessions/game_results
-- store. Players can read their own game_results (including that seed), so
-- the shared puzzle seed must never be stored there. The puzzle is generated
-- from daily_challenges.seed, which get_game_session returns to the server as
-- puzzle_seed. Seed uniqueness, XP replay protection (per session seed) and
-- one contribution per (player, game, seed) keep working unchanged; a player
-- can't attempt the same daily twice anyway.
--
-- An unfinished daily round is never abandoned implicitly: starting another
-- round raises daily_in_progress. The server settles expired daily rounds
-- (finalizes them as timed out) before retrying, so every reserved attempt
-- ends with an official result.

create table public.daily_assignments (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{2,40}$'),
  game_id text not null unique check (game_id ~ '^[a-z][a-z0-9-]{1,40}$'),
  title text not null check (char_length(title) between 3 and 60),
  generation_version integer not null check (generation_version >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.daily_assignments (id, game_id, title, generation_version) values
  ('daily-audit', 'reconciliation-rush', 'Daily Audit', 1),
  ('daily-sales-briefing', 'pipeline-panic', 'Daily Sales Briefing', 1);

create table public.daily_challenges (
  -- Stable and public: '<assignment>:<YYYY-MM-DD>'. Reveals nothing about the puzzle.
  id text primary key check (char_length(id) <= 64),
  assignment_id text not null references public.daily_assignments (id),
  game_id text not null,
  challenge_date date not null,
  generation_version integer not null check (generation_version >= 1),
  rules_version integer not null,
  -- Secret: regenerates the shared puzzle and its answer key.
  seed text not null unique check (char_length(seed) between 32 and 128),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (assignment_id, challenge_date),
  foreign key (game_id, rules_version) references public.game_rules (game_id, rules_version),
  check (opens_at = (challenge_date::timestamp at time zone 'UTC') and closes_at = opens_at + interval '1 day')
);

create table public.daily_challenge_attempts (
  challenge_id text not null references public.daily_challenges (id),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  session_id uuid not null unique references public.game_sessions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create index daily_challenge_attempts_user_idx on public.daily_challenge_attempts (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Owner-level guards
-- ---------------------------------------------------------------------------

-- Challenges never change or disappear once created (results refer to them).
create function public.guard_daily_challenges() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'daily_challenges_immutable';
end;
$$;

create trigger daily_challenges_immutable before update or delete on public.daily_challenges
  for each row execute function public.guard_daily_challenges();
create trigger daily_challenges_no_truncate before truncate on public.daily_challenges
  for each statement execute function public.guard_daily_challenges();

-- Attempts are permanent; they disappear only with the player's account.
create function public.guard_daily_attempts() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'daily_challenge_attempts_append_only';
end;
$$;

create trigger daily_challenge_attempts_append_only before update or delete on public.daily_challenge_attempts
  for each row execute function public.guard_daily_attempts();
create trigger daily_challenge_attempts_no_truncate before truncate on public.daily_challenge_attempts
  for each statement execute function public.guard_daily_attempts();

-- Assignments: only is_active may change (pause or resume an assignment).
create function public.guard_daily_assignments() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.id, new.game_id, new.title, new.generation_version, new.created_at)
     = (old.id, old.game_id, old.title, old.generation_version, old.created_at) then
    return new;
  end if;
  raise exception 'daily_assignments_immutable';
end;
$$;

create trigger daily_assignments_immutable before update or delete on public.daily_assignments
  for each row execute function public.guard_daily_assignments();
create trigger daily_assignments_no_truncate before truncate on public.daily_assignments
  for each statement execute function public.guard_daily_assignments();

-- ---------------------------------------------------------------------------
-- Internal helpers (not executable by any API role)
-- ---------------------------------------------------------------------------

-- Creates the given UTC day's challenges once; concurrent callers converge on one row.
create function public.ensure_daily_challenges(p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  assignment public.daily_assignments;
  pinned integer;
begin
  for assignment in select * from public.daily_assignments where is_active order by id loop
    select rules_version into pinned from public.game_rules
      where game_id = assignment.game_id and is_active order by rules_version desc limit 1;
    continue when pinned is null;
    insert into public.daily_challenges (id, assignment_id, game_id, challenge_date, generation_version, rules_version, seed, opens_at, closes_at)
    values (
      assignment.id || ':' || to_char(p_date, 'YYYY-MM-DD'), assignment.id, assignment.game_id, p_date,
      assignment.generation_version, pinned,
      -- Strategy DC1: drawn once from the database's cryptographic RNG, then fixed for the day.
      'DC' || assignment.generation_version || '-' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      p_date::timestamp at time zone 'UTC', (p_date + 1)::timestamp at time zone 'UTC'
    )
    on conflict do nothing;
  end loop;
end;
$$;

-- One challenge with the player's attempt, official result and standing. Never includes the seed.
-- Standing: rank among finalized results (test accounts excluded, except the player themself).
create function public.daily_challenge_entry(p_challenge_id text, p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with c as (select * from public.daily_challenges where id = p_challenge_id),
  mine as (
    select s.id as session_id, s.status, s.started_at, s.deadline_at, r.score, r.max_score, r.completion,
           r.time_used_ms, r.time_remaining_ms, r.assistance_used, r.completed_at, r.xp_awarded,
           r.errors_fixed, r.total_errors, r.incorrect_corrections
    from public.daily_challenge_attempts a
    join public.game_sessions s on s.id = a.session_id
    left join public.game_results r on r.session_id = a.session_id
    where a.challenge_id = p_challenge_id and a.user_id = p_user_id),
  field as (
    select r.session_id, r.score, r.time_used_ms, r.assistance_used, r.completed_at
    from public.daily_challenge_attempts a
    join public.game_results r on r.session_id = a.session_id
    join auth.users u on u.id = a.user_id
    where a.challenge_id = p_challenge_id
      and ((u.raw_app_meta_data ->> 'test_account') is distinct from 'true' or a.user_id = p_user_id))
  select jsonb_build_object(
    'id', c.id, 'assignment_id', c.assignment_id, 'game_id', c.game_id, 'challenge_date', c.challenge_date,
    'generation_version', c.generation_version, 'rules_version', c.rules_version,
    'opens_at', c.opens_at, 'closes_at', c.closes_at,
    'attempt', (select jsonb_build_object(
        'session_id', m.session_id, 'session_status', m.status, 'started_at', m.started_at, 'deadline_at', m.deadline_at,
        'result', case when m.score is null then null else jsonb_build_object(
          'score', m.score, 'max_score', m.max_score, 'completion', m.completion, 'time_used_ms', m.time_used_ms,
          'time_remaining_ms', m.time_remaining_ms, 'assistance_used', m.assistance_used, 'completed_at', m.completed_at,
          'xp_awarded', m.xp_awarded, 'errors_fixed', m.errors_fixed, 'total_errors', m.total_errors,
          'incorrect_corrections', m.incorrect_corrections) end,
        'standing', case when m.score is null then null else jsonb_build_object(
          'rank', 1 + (select count(*) from field f
            where (-f.score, f.time_used_ms, f.assistance_used, f.completed_at, f.session_id)
                < (-m.score, m.time_used_ms, m.assistance_used, m.completed_at, m.session_id)),
          'participants', (select count(*) from field)) end)
      from mine m)
  )
  from c;
$$;

-- ---------------------------------------------------------------------------
-- Trusted functions (service role only)
-- ---------------------------------------------------------------------------

-- Today's challenges (and the player's attempts, if signed in) plus recent days.
create function public.get_daily_status(p_user_id uuid, p_history_days integer default 7) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'UTC')::date;
  days integer := least(greatest(coalesce(p_history_days, 7), 0), 30);
begin
  if p_user_id is not null and not exists (select 1 from public.profiles where user_id = p_user_id) then
    raise exception 'unknown_player';
  end if;
  perform public.ensure_daily_challenges(today);
  return jsonb_build_object(
    'db_now', now(),
    'date', today,
    'next_reset_at', (today + 1)::timestamp at time zone 'UTC',
    'today', (
      select coalesce(jsonb_agg(public.daily_challenge_entry(c.id, p_user_id) order by c.assignment_id), '[]'::jsonb)
      from public.daily_challenges c join public.daily_assignments a on a.id = c.assignment_id
      where c.challenge_date = today and a.is_active),
    'history', (
      select coalesce(jsonb_agg(public.daily_challenge_entry(c.id, p_user_id) order by c.challenge_date desc, c.assignment_id), '[]'::jsonb)
      from public.daily_challenges c
      where c.challenge_date < today and c.challenge_date >= today - days)
  );
end;
$$;

-- Reserves the player's single attempt at today's challenge and starts its session.
-- Returns {status: started | existing, session_id, challenge_id}. Idempotent per player and day.
create function public.start_daily_attempt(p_user_id uuid, p_assignment_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'UTC')::date;
  challenge public.daily_challenges;
  attempt public.daily_challenge_attempts;
  rules public.game_rules;
  session public.game_sessions;
  recent integer;
begin
  if not exists (select 1 from public.profiles where user_id = p_user_id) then raise exception 'unknown_player'; end if;
  if not exists (select 1 from public.daily_assignments where id = p_assignment_id and is_active) then
    raise exception 'unknown_daily_challenge';
  end if;

  -- Same per-player lock as create_game_session: one decision at a time per player.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  perform public.ensure_daily_challenges(today);
  select * into challenge from public.daily_challenges where assignment_id = p_assignment_id and challenge_date = today;
  if not found then raise exception 'unknown_daily_challenge'; end if;

  select * into attempt from public.daily_challenge_attempts where challenge_id = challenge.id and user_id = p_user_id;
  if found then
    return jsonb_build_object('status', 'existing', 'session_id', attempt.session_id, 'challenge_id', challenge.id);
  end if;

  if exists (select 1 from public.game_sessions s join public.daily_challenge_attempts a on a.session_id = s.id
             where s.user_id = p_user_id and s.status = 'active') then
    raise exception 'daily_in_progress';
  end if;

  -- The rules pinned when the challenge was created, even if newer rules exist now.
  select * into rules from public.game_rules where game_id = challenge.game_id and rules_version = challenge.rules_version;
  select count(*) into recent from public.game_sessions
    where user_id = p_user_id and started_at > now() - interval '1 minute';
  if recent >= rules.max_sessions_per_minute then raise exception 'rate_limited'; end if;

  -- Like any new round, this abandons an unfinished practice round.
  update public.game_sessions set status = 'abandoned' where user_id = p_user_id and status = 'active';

  insert into public.game_sessions (user_id, game_id, rules_version, seed, deadline_at)
  values (p_user_id, challenge.game_id, challenge.rules_version,
          'DS1-' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
          now() + rules.duration_ms * interval '1 millisecond')
  returning * into session;
  insert into public.daily_challenge_attempts (challenge_id, user_id, session_id) values (challenge.id, p_user_id, session.id);

  return jsonb_build_object('status', 'started', 'session_id', session.id, 'challenge_id', challenge.id);
end;
$$;

-- The player's unfinished daily round, if any (for settling expired rounds).
create function public.get_active_daily_session(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'session_id', s.id, 'game_id', s.game_id, 'challenge_id', a.challenge_id,
    'expired', now() > s.deadline_at + r.tolerance_ms * interval '1 millisecond')
  from public.daily_challenge_attempts a
  join public.game_sessions s on s.id = a.session_id
  join public.game_rules r on r.game_id = s.game_id and r.rules_version = s.rules_version
  where s.user_id = p_user_id and s.status = 'active'
  limit 1;
$$;

-- Ranked official results for one challenge. Order: score (desc), time used,
-- unassisted before assisted, earlier completion, session id. Test accounts
-- are excluded. Includes user ids for the server only; never send them as-is.
create function public.get_daily_leaderboard(p_challenge_id text, p_limit integer default 50) returns jsonb
language sql stable security definer set search_path = '' as $$
  with field as (
    select a.user_id, r.session_id, r.score, r.max_score, r.completion, r.time_used_ms, r.assistance_used, r.completed_at,
           row_number() over (order by r.score desc, r.time_used_ms, r.assistance_used, r.completed_at, r.session_id) as rank
    from public.daily_challenge_attempts a
    join public.game_results r on r.session_id = a.session_id
    join auth.users u on u.id = a.user_id
    where a.challenge_id = p_challenge_id and (u.raw_app_meta_data ->> 'test_account') is distinct from 'true')
  select jsonb_build_object(
    'challenge_id', p_challenge_id,
    'participants', (select count(*) from field),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', f.rank, 'user_id', f.user_id, 'score', f.score, 'max_score', f.max_score, 'completion', f.completion,
        'time_used_ms', f.time_used_ms, 'assistance_used', f.assistance_used, 'completed_at', f.completed_at) order by f.rank)
      from field f where f.rank <= least(greatest(coalesce(p_limit, 50), 1), 100)), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Existing functions, extended
-- ---------------------------------------------------------------------------

-- Unchanged, except that an unfinished daily round is never abandoned implicitly.
create or replace function public.create_game_session(p_user_id uuid, p_game_id text, p_seed text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  rules public.game_rules;
  session public.game_sessions;
  recent integer;
begin
  select * into rules from public.game_rules
    where game_id = p_game_id and is_active order by rules_version desc limit 1;
  if not found then raise exception 'unknown_game'; end if;
  if not exists (select 1 from public.profiles where user_id = p_user_id) then
    raise exception 'unknown_player';
  end if;

  -- Serialize per player so the rate limit and single-active-round rule hold under concurrency.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- A ranked daily round is never abandoned by starting another round.
  if exists (select 1 from public.game_sessions s join public.daily_challenge_attempts a on a.session_id = s.id
             where s.user_id = p_user_id and s.status = 'active') then
    raise exception 'daily_in_progress';
  end if;

  select count(*) into recent from public.game_sessions
    where user_id = p_user_id and started_at > now() - interval '1 minute';
  if recent >= rules.max_sessions_per_minute then raise exception 'rate_limited'; end if;

  -- Starting a new round abandons any unfinished one (no result, no XP).
  update public.game_sessions set status = 'abandoned'
    where user_id = p_user_id and status = 'active';

  insert into public.game_sessions (user_id, game_id, rules_version, seed, deadline_at)
  values (p_user_id, p_game_id, rules.rules_version, p_seed, now() + rules.duration_ms * interval '1 millisecond')
  returning * into session;

  return jsonb_build_object(
    'session_id', session.id,
    'game_id', session.game_id,
    'rules_version', session.rules_version,
    'started_at', session.started_at,
    'deadline_at', session.deadline_at,
    'duration_ms', rules.duration_ms,
    'tolerance_ms', rules.tolerance_ms,
    'db_now', now()
  );
end;
$$;

-- Adds puzzle_seed (the shared daily seed for daily rounds, otherwise the
-- session seed) and the daily link. Still returned to the trusted server only.
create or replace function public.get_game_session(p_session_id uuid, p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  session public.game_sessions;
  rules public.game_rules;
  result public.game_results;
  challenge public.daily_challenges;
begin
  select * into session from public.game_sessions where id = p_session_id and user_id = p_user_id;
  if not found then return null; end if;
  select * into rules from public.game_rules where game_id = session.game_id and rules_version = session.rules_version;
  select * into result from public.game_results where session_id = session.id;
  select c.* into challenge from public.daily_challenge_attempts a join public.daily_challenges c on c.id = a.challenge_id
    where a.session_id = session.id;
  return jsonb_build_object(
    'session_id', session.id,
    'game_id', session.game_id,
    'rules_version', session.rules_version,
    'seed', session.seed,
    'puzzle_seed', coalesce(challenge.seed, session.seed),
    'daily', case when challenge.id is null then null else jsonb_build_object(
      'challenge_id', challenge.id, 'assignment_id', challenge.assignment_id,
      'challenge_date', challenge.challenge_date, 'closes_at', challenge.closes_at) end,
    'status', session.status,
    'started_at', session.started_at,
    'deadline_at', session.deadline_at,
    'duration_ms', rules.duration_ms,
    'tolerance_ms', rules.tolerance_ms,
    'hint_error_id', session.hint_error_id,
    'hint_requested_at', session.hint_requested_at,
    'db_now', now(),
    'result', case when result.session_id is null then null else to_jsonb(result) end,
    'total_xp', (select coalesce(sum(amount), 0) from public.xp_ledger where user_id = p_user_id)
  );
end;
$$;

-- Adds the player's daily results ('dailies') for the Daily Grind achievement.
create or replace function public.get_achievement_facts(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where user_id = p_user_id) then raise exception 'unknown_player'; end if;
  return jsonb_build_object(
    'results', (
      select coalesce(jsonb_agg(to_jsonb(r) - 'submission' order by r.completed_at, r.session_id), '[]'::jsonb)
      from public.game_results r where r.user_id = p_user_id),
    'memberships', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'department_id', m.department_id, 'started_at', m.started_at, 'ended_at', m.ended_at,
        'start_reason', m.start_reason, 'end_reason', m.end_reason) order by m.started_at), '[]'::jsonb)
      from public.department_memberships m where m.user_id = p_user_id),
    'contributions', (
      select coalesce(jsonb_agg(jsonb_build_object('session_id', e.session_id, 'period_id', e.period_id, 'completed_at', e.completed_at)
        order by e.completed_at, e.session_id), '[]'::jsonb)
      from public.contribution_events e where e.user_id = p_user_id),
    'dailies', (
      select coalesce(jsonb_agg(jsonb_build_object('session_id', a.session_id, 'challenge_id', a.challenge_id,
        'challenge_date', c.challenge_date, 'completion', r.completion, 'completed_at', r.completed_at)
        order by r.completed_at, a.session_id), '[]'::jsonb)
      from public.daily_challenge_attempts a
      join public.daily_challenges c on c.id = a.challenge_id
      join public.game_results r on r.session_id = a.session_id
      where a.user_id = p_user_id),
    'unlocked', (
      select coalesce(jsonb_agg(jsonb_build_object('achievement_id', a.achievement_id, 'unlocked_at', a.unlocked_at)
        order by a.unlocked_at, a.achievement_id), '[]'::jsonb)
      from public.player_achievements a where a.user_id = p_user_id)
  );
end;
$$;

-- Adds daily checks: attempts must match their session, and daily rounds are never abandoned.
create or replace function public.check_progression_integrity() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'finalized_sessions_without_result', (
      select count(*) from public.game_sessions s
      where s.status = 'finalized' and not exists (select 1 from public.game_results r where r.session_id = s.id)),
    'results_without_xp', (
      select count(*) from public.game_results r
      where not exists (select 1 from public.xp_ledger x where x.source_type = 'game_result' and x.source_id = r.session_id)),
    'xp_without_result', (
      select count(*) from public.xp_ledger x
      where x.source_type = 'game_result' and not exists (select 1 from public.game_results r where r.session_id = x.source_id)),
    'xp_amount_mismatch', (
      select count(*) from public.xp_ledger x join public.game_results r on r.session_id = x.source_id
      where x.source_type = 'game_result' and (x.amount <> r.xp_awarded or x.user_id <> r.user_id)),
    'results_without_contribution', (
      select count(*) from public.game_results r
      where exists (select 1 from public.contribution_formulas f where f.game_id = r.game_id and f.is_active)
        and not exists (select 1 from public.contribution_events e where e.session_id = r.session_id)
        and not exists (select 1 from public.contribution_events e
                        where e.user_id = r.user_id and e.game_id = r.game_id and e.seed = r.seed)),
    'contributions_mismatching_result', (
      select count(*) from public.contribution_events e join public.game_results r on r.session_id = e.session_id
      where (e.user_id, e.game_id, e.seed, e.score, e.completed_at) is distinct from (r.user_id, r.game_id, r.seed, r.score, r.completed_at)),
    'profiles_department_mismatch', (
      select count(*) from public.profiles p
      where p.department_id is distinct from (
        select m.department_id from public.department_memberships m where m.user_id = p.user_id and m.ended_at is null)),
    'overlapping_memberships', (
      select count(*) from public.department_memberships a join public.department_memberships b
        on a.user_id = b.user_id and a.id < b.id
      where tstzrange(a.started_at, coalesce(a.ended_at, 'infinity')) && tstzrange(b.started_at, coalesce(b.ended_at, 'infinity'))),
    'daily_attempts_mismatching_session', (
      select count(*) from public.daily_challenge_attempts a
      join public.game_sessions s on s.id = a.session_id
      join public.daily_challenges c on c.id = a.challenge_id
      where (s.user_id, s.game_id, s.rules_version) is distinct from (a.user_id, c.game_id, c.rules_version)
         or s.started_at < c.opens_at or s.started_at >= c.closes_at),
    'daily_sessions_abandoned', (
      select count(*) from public.daily_challenge_attempts a
      join public.game_sessions s on s.id = a.session_id
      where s.status = 'abandoned')
  );
$$;

-- Daily Grind becomes available now that daily results exist.
update public.achievement_definitions set status = 'available' where id = 'daily-grind';

-- ---------------------------------------------------------------------------
-- Grants and Row Level Security
-- ---------------------------------------------------------------------------

alter table public.daily_assignments enable row level security;
alter table public.daily_challenges enable row level security;
alter table public.daily_challenge_attempts enable row level security;

revoke all on public.daily_assignments, public.daily_challenges, public.daily_challenge_attempts
  from public, anon, authenticated, service_role;
grant select on public.daily_assignments to anon, authenticated, service_role;
-- daily_challenges: no access for any API role (the seed); read through the functions above.
grant select on public.daily_challenge_attempts to authenticated, service_role;
create policy daily_assignments_read on public.daily_assignments for select to anon, authenticated using (true);
create policy daily_challenge_attempts_read_own on public.daily_challenge_attempts for select to authenticated using (user_id = auth.uid());

revoke execute on function public.guard_daily_challenges() from public, anon, authenticated, service_role;
revoke execute on function public.guard_daily_attempts() from public, anon, authenticated, service_role;
revoke execute on function public.guard_daily_assignments() from public, anon, authenticated, service_role;
revoke execute on function public.ensure_daily_challenges(date) from public, anon, authenticated, service_role;
revoke execute on function public.daily_challenge_entry(text, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.get_daily_status(uuid, integer) from public, anon, authenticated, service_role;
revoke execute on function public.start_daily_attempt(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.get_active_daily_session(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.get_daily_leaderboard(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.get_daily_status(uuid, integer) to service_role;
grant execute on function public.start_daily_attempt(uuid, text) to service_role;
grant execute on function public.get_active_daily_session(uuid) to service_role;
grant execute on function public.get_daily_leaderboard(text, integer) to service_role;
