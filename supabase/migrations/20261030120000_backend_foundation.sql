-- Corporate Ladder · Backend Foundation v0.1
--
-- Security model
--   * Browsers (roles anon / authenticated) can READ their own profile,
--     verified results, XP ledger and legacy imports, plus public reference
--     tables. They can UPDATE only their display name and department.
--   * Browsers cannot read game sessions at all: a session holds the secret
--     seed that regenerates every answer.
--   * Every privileged write (sessions, hints, results, XP, imports) goes
--     through SECURITY DEFINER functions that only the server's service role
--     may execute. Scores are computed by trusted server code; XP is derived
--     here from the score, never accepted from a client.
--   * Exactly-once XP: one result per session (primary key), one ledger entry
--     per result (unique source), all inside one transaction with a row lock.

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table public.departments (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,30}$'),
  name text not null check (char_length(name) between 2 and 60),
  created_at timestamptz not null default now()
);

insert into public.departments (id, name) values
  ('finance', 'Finance'),
  ('sales', 'Sales'),
  ('marketing', 'Marketing'),
  ('it', 'IT'),
  ('operations', 'Operations'),
  ('people', 'People & Culture'),
  ('legal', 'Legal'),
  ('strategy', 'Strategy');

-- Pinned rules per game version. Sessions reference the version they were
-- created with, so rule changes never re-score old rounds.
create table public.game_rules (
  game_id text not null check (game_id ~ '^[a-z][a-z0-9-]{1,40}$'),
  rules_version integer not null check (rules_version > 0),
  duration_ms integer not null check (duration_ms between 10000 and 3600000),
  -- Network allowance after the deadline for submissions sent in time.
  tolerance_ms integer not null check (tolerance_ms between 0 and 30000),
  -- Corporate XP = floor(score / xp_score_divisor). 20 = "1 XP per 20 points".
  xp_score_divisor integer not null default 20 check (xp_score_divisor > 0),
  max_sessions_per_minute integer not null default 12 check (max_sessions_per_minute > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (game_id, rules_version)
);

insert into public.game_rules (game_id, rules_version, duration_ms, tolerance_ms, xp_score_divisor, max_sessions_per_minute)
values ('reconciliation-rush', 1, 90000, 3000, 20, 12);

-- ---------------------------------------------------------------------------
-- Player profiles
-- ---------------------------------------------------------------------------

create sequence public.employee_number_seq start with 1000;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Display only. Never used for authorization (user_id is).
  employee_number text not null unique
    default ('CL-' || lpad(nextval('public.employee_number_seq')::text, 6, '0')),
  display_name text not null
    check (char_length(btrim(display_name)) between 2 and 40 and display_name !~ '[[:cntrl:]]'),
  department_id text references public.departments (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Every new auth user gets a profile.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  requested text := btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'display_name', ''), '[[:cntrl:]]', '', 'g'));
begin
  if char_length(requested) < 2 then
    requested := 'New Hire';
  end if;
  insert into public.profiles (user_id, display_name) values (new.id, left(requested, 40));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Gameplay
-- ---------------------------------------------------------------------------

create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  game_id text not null,
  rules_version integer not null,
  -- Secret until the session is finalized: it regenerates the answer key.
  seed text not null unique check (char_length(seed) between 16 and 128),
  status text not null default 'active' check (status in ('active', 'finalized', 'abandoned')),
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  hint_error_id text check (hint_error_id is null or char_length(hint_error_id) <= 40),
  hint_requested_at timestamptz,
  finalized_at timestamptz,
  foreign key (game_id, rules_version) references public.game_rules (game_id, rules_version),
  check (deadline_at > started_at),
  check ((hint_error_id is null) = (hint_requested_at is null)),
  check ((status = 'finalized') = (finalized_at is not null))
);

-- At most one active round per player.
create unique index game_sessions_one_active_per_user on public.game_sessions (user_id) where status = 'active';
create index game_sessions_user_started_idx on public.game_sessions (user_id, started_at desc);

create table public.game_results (
  session_id uuid primary key references public.game_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  game_id text not null,
  rules_version integer not null,
  seed text not null,
  department text not null check (char_length(department) between 1 and 60),
  difficulty text not null check (char_length(difficulty) between 1 and 40),
  completion text not null check (completion in ('submitted', 'timedOut')),
  score integer not null check (score >= 0),
  max_score integer not null check (max_score > 0 and score <= max_score),
  grade text not null check (char_length(grade) between 1 and 60),
  errors_fixed integer not null check (errors_fixed >= 0),
  total_errors integer not null check (total_errors > 0 and errors_fixed <= total_errors),
  incorrect_corrections integer not null check (incorrect_corrections >= 0),
  accuracy numeric(5, 4) check (accuracy is null or accuracy between 0 and 1),
  time_used_ms integer not null check (time_used_ms >= 0),
  time_remaining_ms integer not null check (time_remaining_ms >= 0),
  assistance_used boolean not null,
  xp_awarded integer not null check (xp_awarded >= 0),
  -- The committed cells that were scored (for audit and re-display).
  submission jsonb not null default '{}'::jsonb
    check (jsonb_typeof(submission) = 'object' and pg_column_size(submission) <= 16384),
  completed_at timestamptz not null default now(),
  foreign key (game_id, rules_version) references public.game_rules (game_id, rules_version)
);

create index game_results_user_completed_idx on public.game_results (user_id, completed_at desc);
create index game_results_user_seed_idx on public.game_results (user_id, game_id, seed);

-- Authoritative Corporate XP ledger. Career XP is the sum of a player's rows.
create table public.xp_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  source_type text not null check (source_type in ('game_result')),
  source_id uuid not null,
  amount integer not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index xp_ledger_user_idx on public.xp_ledger (user_id);

-- Guest history imported from a browser. Untrusted: never earns XP or ranks.
create table public.legacy_practice_results (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  local_id text not null check (char_length(local_id) between 1 and 100),
  game_id text not null check (char_length(game_id) between 1 and 60),
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 4096),
  played_at timestamptz,
  imported_at timestamptz not null default now(),
  primary key (user_id, local_id)
);

-- ---------------------------------------------------------------------------
-- Trusted server functions (service role only)
-- ---------------------------------------------------------------------------

create function public.create_game_session(p_user_id uuid, p_game_id text, p_seed text) returns jsonb
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

-- Returns the session (with its seed and any result) only to its owner; null otherwise.
create function public.get_game_session(p_session_id uuid, p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  session public.game_sessions;
  rules public.game_rules;
  result public.game_results;
begin
  select * into session from public.game_sessions where id = p_session_id and user_id = p_user_id;
  if not found then return null; end if;
  select * into rules from public.game_rules where game_id = session.game_id and rules_version = session.rules_version;
  select * into result from public.game_results where session_id = session.id;
  return jsonb_build_object(
    'session_id', session.id,
    'game_id', session.game_id,
    'rules_version', session.rules_version,
    'seed', session.seed,
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

-- Records the round's single hint. Idempotent: a repeat call returns the stored hint.
create function public.record_game_hint(p_session_id uuid, p_user_id uuid, p_error_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  session public.game_sessions;
  rules public.game_rules;
begin
  select * into session from public.game_sessions where id = p_session_id and user_id = p_user_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if session.hint_requested_at is not null then
    return jsonb_build_object('hint_error_id', session.hint_error_id, 'hint_requested_at', session.hint_requested_at, 'created', false);
  end if;
  select * into rules from public.game_rules where game_id = session.game_id and rules_version = session.rules_version;
  if session.status <> 'active' or now() > session.deadline_at + rules.tolerance_ms * interval '1 millisecond' then
    raise exception 'session_closed';
  end if;
  update public.game_sessions set hint_error_id = p_error_id, hint_requested_at = now()
    where id = p_session_id returning * into session;
  return jsonb_build_object('hint_error_id', session.hint_error_id, 'hint_requested_at', session.hint_requested_at, 'created', true);
end;
$$;

-- Finalizes a session exactly once and awards XP from the verified score.
-- A repeat call returns the stored result unchanged and awards nothing.
create function public.finalize_game_session(p_session_id uuid, p_user_id uuid, p_result jsonb, p_submission jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  session public.game_sessions;
  rules public.game_rules;
  stored public.game_results;
  replay boolean;
  xp integer;
  score integer := (p_result ->> 'score')::integer;
begin
  select * into session from public.game_sessions where id = p_session_id for update;
  if not found or session.user_id <> p_user_id then raise exception 'session_not_found'; end if;

  if session.status = 'finalized' then
    select * into stored from public.game_results where session_id = p_session_id;
    return jsonb_build_object('result', to_jsonb(stored), 'created', false, 'total_xp',
      (select coalesce(sum(amount), 0) from public.xp_ledger where user_id = p_user_id));
  end if;
  if session.status <> 'active' then raise exception 'session_closed'; end if;

  select * into rules from public.game_rules where game_id = session.game_id and rules_version = session.rules_version;

  -- Defense in depth: the server decides completion from database time; a
  -- "submitted" result can't be finalized well past the deadline.
  if p_result ->> 'completion' = 'submitted'
     and now() > session.deadline_at + rules.tolerance_ms * interval '1 millisecond' then
    raise exception 'deadline_passed';
  end if;

  -- Replaying a seed this player already completed earns no XP.
  replay := exists (
    select 1 from public.game_results
    where user_id = p_user_id and game_id = session.game_id and seed = session.seed
  );
  xp := case when replay then 0 else floor(greatest(score, 0)::numeric / rules.xp_score_divisor)::integer end;

  insert into public.game_results (
    session_id, user_id, game_id, rules_version, seed, department, difficulty, completion,
    score, max_score, grade, errors_fixed, total_errors, incorrect_corrections, accuracy,
    time_used_ms, time_remaining_ms, assistance_used, xp_awarded, submission
  ) values (
    session.id, p_user_id, session.game_id, session.rules_version, session.seed,
    p_result ->> 'department', p_result ->> 'difficulty', p_result ->> 'completion',
    score, (p_result ->> 'max_score')::integer, p_result ->> 'grade',
    (p_result ->> 'errors_fixed')::integer, (p_result ->> 'total_errors')::integer,
    (p_result ->> 'incorrect_corrections')::integer, (p_result ->> 'accuracy')::numeric,
    (p_result ->> 'time_used_ms')::integer, (p_result ->> 'time_remaining_ms')::integer,
    session.hint_requested_at is not null, xp, coalesce(p_submission, '{}'::jsonb)
  ) returning * into stored;

  insert into public.xp_ledger (user_id, source_type, source_id, amount)
  values (p_user_id, 'game_result', session.id, xp);

  update public.game_sessions set status = 'finalized', finalized_at = now() where id = session.id;

  return jsonb_build_object('result', to_jsonb(stored), 'created', true, 'total_xp',
    (select coalesce(sum(amount), 0) from public.xp_ledger where user_id = p_user_id));
end;
$$;

-- Imports validated guest summaries as legacy practice history (no XP). Idempotent.
create function public.import_legacy_results(p_user_id uuid, p_records jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  inserted integer;
begin
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 200 then
    raise exception 'invalid_import';
  end if;
  insert into public.legacy_practice_results (user_id, local_id, game_id, summary, played_at)
  select p_user_id, r ->> 'id', r ->> 'gameId', r, (r ->> 'completedAt')::timestamptz
  from jsonb_array_elements(p_records) as r
  on conflict (user_id, local_id) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- Callable by signed-in players; RLS limits the sum to their own ledger rows.
create function public.get_my_career_xp() returns integer
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(amount), 0)::integer from public.xp_ledger where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Grants and Row Level Security
-- ---------------------------------------------------------------------------

alter table public.departments enable row level security;
alter table public.game_rules enable row level security;
alter table public.profiles enable row level security;
alter table public.game_sessions enable row level security;
alter table public.game_results enable row level security;
alter table public.xp_ledger enable row level security;
alter table public.legacy_practice_results enable row level security;

-- Supabase grants broad default privileges; replace them with explicit ones.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on public.departments, public.game_rules to anon, authenticated;
grant select on public.profiles, public.game_results, public.xp_ledger, public.legacy_practice_results to authenticated;
grant update (display_name, department_id) on public.profiles to authenticated;
-- No client privileges at all on game_sessions.

create policy departments_read on public.departments for select to anon, authenticated using (true);
create policy game_rules_read on public.game_rules for select to anon, authenticated using (true);
create policy profiles_read_own on public.profiles for select to authenticated using (user_id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy game_results_read_own on public.game_results for select to authenticated using (user_id = auth.uid());
create policy xp_ledger_read_own on public.xp_ledger for select to authenticated using (user_id = auth.uid());
create policy legacy_read_own on public.legacy_practice_results for select to authenticated using (user_id = auth.uid());

grant execute on function public.create_game_session(uuid, text, text) to service_role;
grant execute on function public.get_game_session(uuid, uuid) to service_role;
grant execute on function public.record_game_hint(uuid, uuid, text) to service_role;
grant execute on function public.finalize_game_session(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.import_legacy_results(uuid, jsonb) to service_role;
grant execute on function public.get_my_career_xp() to authenticated;
