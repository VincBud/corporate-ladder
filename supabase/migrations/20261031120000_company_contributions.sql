-- Corporate Ladder · Verified Company Contributions v0.1
--
-- An append-only ledger of company contribution events, created only from
-- server-verified game results, in the same transaction that finalizes the
-- result and awards XP.
--
-- Security model
--   * Browsers (anon / authenticated) can read the canonical departments and
--     the published contribution formulas. They cannot read, write or derive
--     contribution events, and cannot call the functions that create them.
--   * The service role can read events and run the idempotent backfill, but
--     cannot insert, update or delete events directly. Events are created only
--     by SECURITY DEFINER functions from rows in public.game_results.
--   * Events and formula allocations are immutable (triggers). Events are
--     removed only when a player account is deleted (ON DELETE CASCADE).
--
-- What an event stores: the verified scoring inputs, pinned rules and formula
-- versions, and a UTC quarter derived from the database completion time.
-- Contribution points are NOT stored: they are recomputed from these inputs by
-- the versioned TypeScript formula (src/simulation/contribution.ts), so a new
-- formula version never requires rewriting history.

-- ---------------------------------------------------------------------------
-- Canonical departments
-- ---------------------------------------------------------------------------
-- Existing ids are kept so profiles.department_id never changes. Controlling
-- is added. "operating" departments have operational metrics in the company
-- simulation; "support" departments (legal, strategy) are valid for
-- membership but have no metrics yet. Membership is separate from
-- contribution attribution: a player's department never decides which
-- metrics a game feeds.

alter table public.departments
  add column kind text not null default 'support' check (kind in ('operating', 'support'));

insert into public.departments (id, name) values ('controlling', 'Controlling')
  on conflict (id) do nothing;

update public.departments set kind = 'operating'
  where id in ('finance', 'controlling', 'people', 'sales', 'operations', 'it', 'marketing');
update public.departments set name = 'Human Resources' where id = 'people';
update public.departments set name = 'Operations & Supply Chain' where id = 'operations';
update public.departments set name = 'IT & Engineering' where id = 'it';

-- ---------------------------------------------------------------------------
-- Fiscal calendar: UTC calendar quarters (Q1 Jan–Mar … Q4 Oct–Dec)
-- ---------------------------------------------------------------------------

create function public.utc_quarter(p_at timestamptz) returns text
language sql immutable strict parallel safe set search_path = '' as $$
  select lpad(extract(year from p_at at time zone 'UTC')::integer::text, 4, '0')
    || '-Q' || extract(quarter from p_at at time zone 'UTC')::integer::text
$$;

-- ---------------------------------------------------------------------------
-- Contribution formulas (versioned, immutable allocations)
-- ---------------------------------------------------------------------------

create table public.contribution_formulas (
  game_id text not null check (game_id ~ '^[a-z][a-z0-9-]{1,40}$'),
  formula_version integer not null check (formula_version > 0),
  -- The newest active version is used for new events. Only this flag may change.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (game_id, formula_version)
);

-- How a game's points split across metrics, in basis points (integers, sum 10000).
create table public.contribution_allocations (
  game_id text not null,
  formula_version integer not null,
  metric_id text not null check (metric_id ~ '^[a-z][a-z0-9-]{1,40}$'),
  department_id text not null references public.departments (id),
  weight_bp integer not null check (weight_bp between 1 and 10000),
  primary key (game_id, formula_version, metric_id),
  foreign key (game_id, formula_version) references public.contribution_formulas (game_id, formula_version)
);

insert into public.contribution_formulas (game_id, formula_version) values ('reconciliation-rush', 1);
insert into public.contribution_allocations (game_id, formula_version, metric_id, department_id, weight_bp) values
  ('reconciliation-rush', 1, 'ledger-integrity', 'controlling', 7000),
  ('reconciliation-rush', 1, 'close-quality', 'finance', 3000);

-- ---------------------------------------------------------------------------
-- Contribution events (append-only)
-- ---------------------------------------------------------------------------

create table public.contribution_events (
  id uuid primary key default gen_random_uuid(),
  -- One event per verified round.
  session_id uuid not null unique references public.game_results (session_id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  game_id text not null,
  rules_version integer not null,
  seed text not null,
  formula_version integer not null,
  -- Database time when the result was finalized. Never client-supplied.
  completed_at timestamptz not null,
  period_id text not null generated always as (public.utc_quarter(completed_at)) stored,
  -- Verified scoring inputs, copied from the result.
  difficulty text not null check (char_length(difficulty) between 1 and 40),
  completion text not null check (completion in ('submitted', 'timedOut')),
  assisted boolean not null,
  score integer not null check (score >= 0),
  max_score integer not null check (max_score > 0 and score <= max_score),
  objectives_completed integer not null check (objectives_completed >= 0),
  objectives_total integer not null check (objectives_total > 0 and objectives_completed <= objectives_total),
  mistakes integer not null check (mistakes >= 0),
  -- finalize: created with the result · recovery: on a retried submission · backfill: by the backfill job
  source text not null check (source in ('finalize', 'recovery', 'backfill')),
  created_at timestamptz not null default now(),
  -- A player contributes once per seed, in any quarter (no replay farming).
  unique (user_id, game_id, seed),
  foreign key (game_id, rules_version) references public.game_rules (game_id, rules_version),
  foreign key (game_id, formula_version) references public.contribution_formulas (game_id, formula_version)
);

create index contribution_events_period_idx on public.contribution_events (period_id, completed_at, session_id);

-- ---------------------------------------------------------------------------
-- Immutability guards
-- ---------------------------------------------------------------------------

create function public.guard_contribution_events() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Allowed only as a cascade from deleting the player's account or result.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'contribution_events_append_only';
end;
$$;

create trigger contribution_events_immutable before update or delete on public.contribution_events
  for each row execute function public.guard_contribution_events();
create trigger contribution_events_no_truncate before truncate on public.contribution_events
  for each statement execute function public.guard_contribution_events();

create function public.guard_contribution_formulas() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Nested on purpose: each branch only touches the columns of its own table.
  if tg_table_name = 'contribution_formulas' and tg_op = 'UPDATE' then
    if (new.game_id, new.formula_version, new.created_at) = (old.game_id, old.formula_version, old.created_at) then
      return new; -- toggling is_active
    end if;
  elsif tg_table_name = 'contribution_allocations' and tg_op = 'INSERT' then
    if exists (select 1 from public.contribution_events
               where game_id = new.game_id and formula_version = new.formula_version) then
      raise exception 'contribution_formula_in_use';
    end if;
    return new;
  end if;
  raise exception 'contribution_formulas_immutable';
end;
$$;

create trigger contribution_formulas_immutable before update or delete on public.contribution_formulas
  for each row execute function public.guard_contribution_formulas();
create trigger contribution_formulas_no_truncate before truncate on public.contribution_formulas
  for each statement execute function public.guard_contribution_formulas();
create trigger contribution_allocations_immutable before insert or update or delete on public.contribution_allocations
  for each row execute function public.guard_contribution_formulas();
create trigger contribution_allocations_no_truncate before truncate on public.contribution_allocations
  for each statement execute function public.guard_contribution_formulas();

-- ---------------------------------------------------------------------------
-- Trusted event creation
-- ---------------------------------------------------------------------------

-- Creates the contribution event for one verified result. Idempotent.
-- Returns {status: created | duplicate | seed_replay | not_applicable, event_id}.
create function public.record_contribution_event(p_session_id uuid, p_source text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  result public.game_results;
  formula public.contribution_formulas;
  allocated integer;
  event_id uuid;
begin
  if p_source is null or p_source not in ('finalize', 'recovery', 'backfill') then
    raise exception 'invalid_contribution_source';
  end if;

  select * into result from public.game_results where session_id = p_session_id;
  if not found then raise exception 'result_not_found'; end if;

  select id into event_id from public.contribution_events where session_id = p_session_id;
  if found then return jsonb_build_object('status', 'duplicate', 'event_id', event_id); end if;

  select * into formula from public.contribution_formulas
    where game_id = result.game_id and is_active
    order by formula_version desc limit 1;
  if not found then return jsonb_build_object('status', 'not_applicable', 'event_id', null); end if;

  select coalesce(sum(weight_bp), 0) into allocated from public.contribution_allocations
    where game_id = formula.game_id and formula_version = formula.formula_version;
  if allocated <> 10000 then raise exception 'invalid_contribution_formula'; end if;

  insert into public.contribution_events (
    session_id, user_id, game_id, rules_version, seed, formula_version, completed_at,
    difficulty, completion, assisted, score, max_score, objectives_completed, objectives_total, mistakes, source
  ) values (
    result.session_id, result.user_id, result.game_id, result.rules_version, result.seed, formula.formula_version,
    result.completed_at, result.difficulty, result.completion, result.assistance_used, result.score, result.max_score,
    result.errors_fixed, result.total_errors, result.incorrect_corrections, p_source
  )
  on conflict do nothing
  returning id into event_id;

  if event_id is null then
    -- Another transaction recorded this round first, or the seed was already used by this player.
    select id into event_id from public.contribution_events where session_id = p_session_id;
    if found then return jsonb_build_object('status', 'duplicate', 'event_id', event_id); end if;
    return jsonb_build_object('status', 'seed_replay', 'event_id', null);
  end if;
  return jsonb_build_object('status', 'created', 'event_id', event_id);
end;
$$;

-- Same as Backend Foundation v0.1, plus the contribution event in the same
-- transaction. A retried submission of an already-finalized round also
-- records a missing event (recovery). Any failure rolls back everything:
-- result, XP and contribution exist together or not at all.
create or replace function public.finalize_game_session(p_session_id uuid, p_user_id uuid, p_result jsonb, p_submission jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  session public.game_sessions;
  rules public.game_rules;
  stored public.game_results;
  replay boolean;
  xp integer;
  contribution jsonb;
  score integer := (p_result ->> 'score')::integer;
begin
  select * into session from public.game_sessions where id = p_session_id for update;
  if not found or session.user_id <> p_user_id then raise exception 'session_not_found'; end if;

  if session.status = 'finalized' then
    select * into stored from public.game_results where session_id = p_session_id;
    contribution := public.record_contribution_event(p_session_id, 'recovery');
    return jsonb_build_object('result', to_jsonb(stored), 'created', false, 'contribution', contribution, 'total_xp',
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

  contribution := public.record_contribution_event(session.id, 'finalize');

  update public.game_sessions set status = 'finalized', finalized_at = now() where id = session.id;

  return jsonb_build_object('result', to_jsonb(stored), 'created', true, 'contribution', contribution, 'total_xp',
    (select coalesce(sum(amount), 0) from public.xp_ledger where user_id = p_user_id));
end;
$$;

-- Records events for verified results that have none (results finalized
-- before this migration, or while a game had no active formula). Oldest
-- first, so the first completion of a seed wins, as in the simulation.
-- Idempotent and safe to run any time. Never reads legacy guest imports.
create function public.backfill_contribution_events(p_limit integer default 500) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pending record;
  outcome jsonb;
  scanned integer := 0;
  created integer := 0;
  replays integer := 0;
  not_applicable integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then raise exception 'invalid_limit'; end if;

  for pending in
    select g.session_id from public.game_results g
    where not exists (select 1 from public.contribution_events e where e.session_id = g.session_id)
    order by g.completed_at, g.session_id
    limit p_limit
  loop
    scanned := scanned + 1;
    outcome := public.record_contribution_event(pending.session_id, 'backfill');
    case outcome ->> 'status'
      when 'created' then created := created + 1;
      when 'seed_replay' then replays := replays + 1;
      when 'not_applicable' then not_applicable := not_applicable + 1;
      else null;
    end case;
  end loop;

  return jsonb_build_object(
    'scanned', scanned,
    'created', created,
    'seed_replays', replays,
    'not_applicable', not_applicable,
    'without_event', (select count(*) from public.game_results g
                      where not exists (select 1 from public.contribution_events e where e.session_id = g.session_id))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and Row Level Security
-- ---------------------------------------------------------------------------

alter table public.contribution_formulas enable row level security;
alter table public.contribution_allocations enable row level security;
alter table public.contribution_events enable row level security;

-- Replace Supabase's default privileges on the new objects with explicit ones.
revoke all on public.contribution_formulas, public.contribution_allocations, public.contribution_events
  from public, anon, authenticated, service_role;
revoke execute on function public.utc_quarter(timestamptz) from public, anon, authenticated, service_role;
revoke execute on function public.record_contribution_event(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.backfill_contribution_events(integer) from public, anon, authenticated, service_role;
revoke execute on function public.guard_contribution_events() from public, anon, authenticated, service_role;
revoke execute on function public.guard_contribution_formulas() from public, anon, authenticated, service_role;

-- Formulas are public configuration.
grant select on public.contribution_formulas, public.contribution_allocations to anon, authenticated, service_role;
create policy contribution_formulas_read on public.contribution_formulas for select to anon, authenticated using (true);
create policy contribution_allocations_read on public.contribution_allocations for select to anon, authenticated using (true);

-- Events: server read access only. No client privileges and no client policies.
grant select on public.contribution_events to service_role;

grant execute on function public.utc_quarter(timestamptz) to service_role;
grant execute on function public.backfill_contribution_events(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Backfill results verified before this migration
-- ---------------------------------------------------------------------------

select public.backfill_contribution_events(5000);
