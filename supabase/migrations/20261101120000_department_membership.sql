-- Corporate Ladder · Department Selection & Career Paths v0.1
--
-- Department membership becomes a server-controlled, append-only history.
--
--   * department_memberships: one row per membership period. At most one
--     current (open) membership per player, no overlapping periods, and a
--     period can only be closed once. Rows are removed only with the
--     player's account (cascade).
--   * profiles.department_id stays the single "current department" field
--     every reader uses (Live Company, career, profile). A trigger allows it
--     to change only to the department of the player's open membership.
--   * select_department(): the only way to join or transfer. Runs as the
--     owner, locks the player's profile row (serializing concurrent
--     requests), enforces the 30-day transfer cooldown with database time,
--     and is idempotent per client request id.
--   * Players lose direct UPDATE on profiles.department_id (it bypassed any
--     rules); so does the service role.
--
-- Additive: no table or row is removed. Existing department assignments are
-- recorded as 'legacy' memberships.

-- "Strategy" is shown as "Corporate Strategy" (display name only; the id is unchanged).
update public.departments set name = 'Corporate Strategy' where id = 'strategy';

-- ---------------------------------------------------------------------------
-- Membership history
-- ---------------------------------------------------------------------------

create table public.department_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  department_id text not null references public.departments (id),
  -- Database time. Never client-supplied.
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_reason text not null check (start_reason in ('initial', 'transfer', 'legacy')),
  end_reason text check (end_reason in ('transfer')),
  -- Client idempotency key: a retried request returns the original result.
  request_id uuid unique,
  created_at timestamptz not null default now(),
  check ((ended_at is null) = (end_reason is null)),
  check (ended_at is null or ended_at >= started_at)
);

create unique index department_memberships_one_current on public.department_memberships (user_id) where ended_at is null;
create index department_memberships_user_idx on public.department_memberships (user_id, started_at);

create function public.guard_department_memberships() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- A new period may not overlap any earlier one (touching is fine).
    if exists (
      select 1 from public.department_memberships m
      where m.user_id = new.user_id and (m.ended_at is null or m.ended_at > new.started_at)
    ) then
      raise exception 'department_membership_overlap';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- Allowed only as a cascade from deleting the player's profile or account.
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'department_memberships_append_only';
  end if;
  if tg_op = 'TRUNCATE' then
    raise exception 'department_memberships_append_only';
  end if;
  -- UPDATE: only closing an open period, once, without changing anything else.
  if old.ended_at is null and new.ended_at is not null
     and (new.id, new.user_id, new.department_id, new.started_at, new.start_reason, new.request_id, new.created_at)
         is not distinct from (old.id, old.user_id, old.department_id, old.started_at, old.start_reason, old.request_id, old.created_at) then
    return new;
  end if;
  raise exception 'department_memberships_append_only';
end;
$$;

create trigger department_memberships_guard before insert or update or delete on public.department_memberships
  for each row execute function public.guard_department_memberships();
create trigger department_memberships_no_truncate before truncate on public.department_memberships
  for each statement execute function public.guard_department_memberships();

-- profiles.department_id must always be the department of the open membership.
create function public.guard_profile_department() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.department_id is distinct from old.department_id
     and (new.department_id is null or not exists (
       select 1 from public.department_memberships m
       where m.user_id = new.user_id and m.ended_at is null and m.department_id = new.department_id
     )) then
    raise exception 'department_change_requires_membership';
  end if;
  return new;
end;
$$;

create trigger profiles_department_matches_membership before update of department_id on public.profiles
  for each row execute function public.guard_profile_department();

-- Existing assignments become legacy memberships (staging had none).
insert into public.department_memberships (user_id, department_id, started_at, start_reason)
select user_id, department_id, updated_at, 'legacy' from public.profiles where department_id is not null;

-- ---------------------------------------------------------------------------
-- Joining and transferring
-- ---------------------------------------------------------------------------

-- Returns {status: joined | transferred | duplicate, membership, next_transfer_at, db_now}.
create function public.select_department(p_user_id uuid, p_department_id text, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cooldown constant interval := interval '30 days';
  active_membership public.department_memberships;
  earlier public.department_memberships;
  created public.department_memberships;
begin
  if p_request_id is null then raise exception 'invalid_request'; end if;

  -- Serializes all membership changes of this player.
  perform 1 from public.profiles where user_id = p_user_id for update;
  if not found then raise exception 'unknown_player'; end if;

  select * into active_membership from public.department_memberships where user_id = p_user_id and ended_at is null;

  -- A retried request returns what it did the first time.
  select * into earlier from public.department_memberships where request_id = p_request_id;
  if found then
    if earlier.user_id <> p_user_id then raise exception 'invalid_request'; end if;
    return jsonb_build_object(
      'status', 'duplicate',
      'membership', to_jsonb(earlier),
      'next_transfer_at', active_membership.started_at + cooldown,
      'db_now', now()
    );
  end if;

  if not exists (select 1 from public.departments where id = p_department_id) then
    raise exception 'unknown_department';
  end if;

  if active_membership.id is not null then
    if active_membership.department_id = p_department_id then raise exception 'already_member'; end if;
    if now() < active_membership.started_at + cooldown then raise exception 'transfer_cooldown'; end if;
    update public.department_memberships set ended_at = now(), end_reason = 'transfer' where id = active_membership.id;
  end if;

  insert into public.department_memberships (user_id, department_id, start_reason, request_id)
  values (p_user_id, p_department_id, case when active_membership.id is null then 'initial' else 'transfer' end, p_request_id)
  returning * into created;

  update public.profiles set department_id = p_department_id where user_id = p_user_id;

  return jsonb_build_object(
    'status', case when active_membership.id is null then 'joined' else 'transferred' end,
    'membership', to_jsonb(created),
    'next_transfer_at', created.started_at + cooldown,
    'db_now', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Integrity audit: adds membership checks (existing checks unchanged)
-- ---------------------------------------------------------------------------

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
      where tstzrange(a.started_at, coalesce(a.ended_at, 'infinity')) && tstzrange(b.started_at, coalesce(b.ended_at, 'infinity')))
  );
$$;

-- ---------------------------------------------------------------------------
-- Grants and Row Level Security
-- ---------------------------------------------------------------------------

-- Department changes go through select_department only.
revoke update (department_id) on public.profiles from authenticated, service_role;

alter table public.department_memberships enable row level security;
revoke all on public.department_memberships from public, anon, authenticated, service_role;
grant select on public.department_memberships to authenticated, service_role;
create policy department_memberships_read_own on public.department_memberships for select to authenticated
  using (user_id = auth.uid());

revoke execute on function public.guard_department_memberships() from public, anon, authenticated, service_role;
revoke execute on function public.guard_profile_department() from public, anon, authenticated, service_role;
revoke execute on function public.select_department(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.select_department(uuid, text, uuid) to service_role;
