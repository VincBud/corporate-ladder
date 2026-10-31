-- Corporate Ladder · Authoritative data hardening
--
-- Findings (staging, before this migration):
--   * Supabase's default privileges grant ALL (arwdDxtm) on every new public
--     table to anon, authenticated and service_role. Earlier migrations
--     revoked them from anon/authenticated only, so service_role (which also
--     bypasses RLS) could INSERT, UPDATE, DELETE, TRUNCATE and create
--     TRIGGERs/REFERENCES on verified results, the XP ledger, sessions,
--     profiles, imports and reference data.
--   * Deleting a result (or session) cascaded to its contribution event but
--     left its XP row behind (xp_ledger.source_id has no foreign key).
--   * The table owner (postgres, used by migrations and the dashboard) can
--     modify anything regardless of grants.
--
-- Fix (additive):
--   1. Grants: service_role becomes read-only on authoritative data, with two
--      narrow column grants (see below). All writes go through the existing
--      SECURITY DEFINER functions, which run as the table owner.
--   2. Triggers, which apply to every role including the owner: verified
--      results and XP are append-only; sessions can't be deleted directly
--      and are frozen once closed. Cascades from deleting a player's profile
--      or auth user still work, so account deletion removes a player's data
--      completely and consistently.
--   3. check_progression_integrity(): read-only audit for orphaned or
--      contradictory records (service role).
--
-- Not changed: finalization, recovery, backfill, account deletion, RLS for
-- players, and any table structure or data.

-- ---------------------------------------------------------------------------
-- 1. Grants
-- ---------------------------------------------------------------------------

revoke all on
  public.game_results, public.xp_ledger, public.game_sessions, public.legacy_practice_results,
  public.profiles, public.game_rules, public.departments
from service_role;

grant select on
  public.game_results, public.xp_ledger, public.game_sessions, public.legacy_practice_results,
  public.profiles, public.game_rules, public.departments
to service_role;

-- Moving the clock of an *active* round (used by the live deadline tests).
-- The session guard below rejects it for closed rounds.
grant update (started_at, deadline_at) on public.game_sessions to service_role;
-- The same profile fields players can edit themselves (support tooling).
grant update (display_name, department_id) on public.profiles to service_role;

revoke all on sequence public.employee_number_seq, public.xp_ledger_id_seq from service_role;

-- Trigger functions are never called directly.
revoke execute on function public.handle_new_user(), public.touch_updated_at() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Owner-level guards
-- ---------------------------------------------------------------------------

-- Verified results and XP rows are written once by finalize_game_session.
create function public.guard_verified_history() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Allowed only as a cascade from deleting the player's profile, auth user or session.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '%_append_only', tg_table_name;
end;
$$;

create trigger game_results_append_only before update or delete on public.game_results
  for each row execute function public.guard_verified_history();
create trigger game_results_no_truncate before truncate on public.game_results
  for each statement execute function public.guard_verified_history();
create trigger xp_ledger_append_only before update or delete on public.xp_ledger
  for each row execute function public.guard_verified_history();
create trigger xp_ledger_no_truncate before truncate on public.xp_ledger
  for each statement execute function public.guard_verified_history();

-- Sessions change only while active (hint, abandon, finalize, clock moves),
-- never change identity, and are deleted only with the player's account.
create function public.guard_game_sessions() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'game_sessions_delete_forbidden';
  end if;
  if tg_op = 'TRUNCATE' then
    raise exception 'game_sessions_delete_forbidden';
  end if;
  if old.status <> 'active' then
    raise exception 'game_session_closed';
  end if;
  if (new.id, new.user_id, new.game_id, new.rules_version, new.seed)
     is distinct from (old.id, old.user_id, old.game_id, old.rules_version, old.seed) then
    raise exception 'game_session_identity_immutable';
  end if;
  return new;
end;
$$;

create trigger game_sessions_guard before update or delete on public.game_sessions
  for each row execute function public.guard_game_sessions();
create trigger game_sessions_no_truncate before truncate on public.game_sessions
  for each statement execute function public.guard_game_sessions();

-- ---------------------------------------------------------------------------
-- 3. Integrity audit (read-only)
-- ---------------------------------------------------------------------------

-- Every count should be 0. Seed replays (no event by design) are not counted.
create function public.check_progression_integrity() returns jsonb
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
      where (e.user_id, e.game_id, e.seed, e.score, e.completed_at) is distinct from (r.user_id, r.game_id, r.seed, r.score, r.completed_at))
  );
$$;

revoke execute on function public.guard_verified_history() from public, anon, authenticated, service_role;
revoke execute on function public.guard_game_sessions() from public, anon, authenticated, service_role;
revoke execute on function public.check_progression_integrity() from public, anon, authenticated, service_role;
grant execute on function public.check_progression_integrity() to service_role;
