-- Corporate Ladder · Live Company v0.1
--
-- One read-only, service-role-only function that returns everything the
-- server needs to compute the live company snapshot for a quarter, in one
-- consistent read. Additive only: no tables or existing objects change.
--
-- Employees are registered player profiles, excluding test accounts. A test
-- account is an auth user whose app_metadata has "test_account": true.
-- app_metadata can only be set with the service role (admin API), never by
-- the player, so the flag can't be used to hide or add real players.
--
-- The result contains player ids (needed for per-player caps). It never
-- leaves the server: GET /api/company publishes aggregates only.

create function public.get_company_quarter(p_period_id text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  period text := coalesce(p_period_id, public.utc_quarter(now()));
begin
  if period !~ '^[0-9]{4}-Q[1-4]$' then raise exception 'invalid_period'; end if;

  return (
    with employees as (
      select p.user_id, p.department_id
      from public.profiles p
      join auth.users u on u.id = p.user_id
      where (u.raw_app_meta_data ->> 'test_account') is distinct from 'true'
    ),
    events as (
      select e.*, emp.department_id
      from public.contribution_events e
      join employees emp on emp.user_id = e.user_id
      where e.period_id = period
    )
    select jsonb_build_object(
      'period_id', period,
      'current_period', public.utc_quarter(now()),
      'db_now', now(),
      'registered_employees', (select count(*) from employees),
      'membership', (
        select coalesce(jsonb_agg(jsonb_build_object('department_id', department_id, 'members', members) order by department_id nulls last), '[]'::jsonb)
        from (select department_id, count(*) as members from employees group by department_id) m
      ),
      'events', (
        select coalesce(jsonb_agg(to_jsonb(ev) order by ev.completed_at, ev.session_id), '[]'::jsonb) from events ev
      ),
      'allocations', (
        select coalesce(jsonb_agg(to_jsonb(a) order by a.game_id, a.formula_version, a.metric_id), '[]'::jsonb)
        from public.contribution_allocations a
      ),
      'last_contribution_at', (select max(created_at) from events)
    )
  );
end;
$$;

revoke execute on function public.get_company_quarter(text) from public, anon, authenticated, service_role;
grant execute on function public.get_company_quarter(text) to service_role;
