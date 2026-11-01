-- Corporate Ladder · Achievements v0.1
--
-- Server-authoritative achievements. Additive only.
--
--   * achievement_definitions: the registry's ids, categories, rarities and
--     status (available | future). Must match src/career/achievements.ts.
--   * player_achievements: one row per player and achievement (primary key),
--     append-only, removed only with the player's account (cascade).
--   * get_achievement_facts(): the authoritative facts the server evaluates
--     (verified results, memberships, contribution events, existing unlocks).
--   * award_achievements(): inserts unlocks computed by trusted server code.
--     Idempotent (ON CONFLICT DO NOTHING returns only newly created rows),
--     rejects future achievements, and checks that every cited source
--     (verified result, membership, contribution event) belongs to the player.
--   * Both functions are service-role only. Players can read their own
--     unlocks; nobody can write them directly.

create table public.achievement_definitions (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,40}$'),
  category text not null check (category in ('gameplay', 'career', 'department', 'company')),
  rarity text not null check (rarity in ('common', 'uncommon', 'rare', 'epic')),
  status text not null check (status in ('available', 'future')),
  created_at timestamptz not null default now()
);

insert into public.achievement_definitions (id, category, rarity, status) values
  ('first-assignment', 'gameplay', 'common', 'available'),
  ('clean-audit', 'gameplay', 'uncommon', 'available'),
  ('deal-maker', 'gameplay', 'common', 'available'),
  ('sales-excellence', 'gameplay', 'rare', 'available'),
  ('no-assistance-required', 'gameplay', 'rare', 'available'),
  ('ahead-of-schedule', 'gameplay', 'epic', 'available'),
  ('cross-functional', 'gameplay', 'uncommon', 'available'),
  ('welcome-aboard', 'career', 'common', 'available'),
  ('climbing-the-ladder', 'career', 'uncommon', 'available'),
  ('middle-management', 'career', 'rare', 'available'),
  ('getting-started', 'career', 'common', 'available'),
  ('corporate-veteran', 'career', 'epic', 'available'),
  ('reconciliation-specialist', 'department', 'uncommon', 'available'),
  ('quota-crusher', 'department', 'uncommon', 'available'),
  ('internal-mobility', 'department', 'uncommon', 'available'),
  ('team-player', 'company', 'common', 'available'),
  ('quarterly-contributor', 'company', 'rare', 'available'),
  ('perfect-quarter', 'career', 'epic', 'future'),
  ('daily-grind', 'gameplay', 'common', 'future');

create table public.player_achievements (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  achievement_id text not null references public.achievement_definitions (id),
  -- When the condition was first met (from the source's database timestamp), never in the future.
  unlocked_at timestamptz not null,
  source_type text check (source_type in ('game_result', 'department_membership', 'contribution_event')),
  source_id text check (source_id is null or char_length(source_id) <= 64),
  created_at timestamptz not null default now(),
  primary key (user_id, achievement_id),
  check ((source_type is null) = (source_id is null)),
  check (unlocked_at <= created_at)
);

create index player_achievements_user_idx on public.player_achievements (user_id, unlocked_at);

-- Unlocks are permanent; they disappear only with the player's account.
create function public.guard_player_achievements() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'player_achievements_append_only';
end;
$$;

create trigger player_achievements_append_only before update or delete on public.player_achievements
  for each row execute function public.guard_player_achievements();
create trigger player_achievements_no_truncate before truncate on public.player_achievements
  for each statement execute function public.guard_player_achievements();

-- Definitions: only the status may change (future → available when a mechanic ships).
create function public.guard_achievement_definitions() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.id, new.category, new.rarity, new.created_at) = (old.id, old.category, old.rarity, old.created_at) then
    return new;
  end if;
  raise exception 'achievement_definitions_immutable';
end;
$$;

create trigger achievement_definitions_immutable before update or delete on public.achievement_definitions
  for each row execute function public.guard_achievement_definitions();
create trigger achievement_definitions_no_truncate before truncate on public.achievement_definitions
  for each statement execute function public.guard_achievement_definitions();

-- ---------------------------------------------------------------------------
-- Trusted functions (service role only)
-- ---------------------------------------------------------------------------

create function public.get_achievement_facts(p_user_id uuid) returns jsonb
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
    'unlocked', (
      select coalesce(jsonb_agg(jsonb_build_object('achievement_id', a.achievement_id, 'unlocked_at', a.unlocked_at)
        order by a.unlocked_at, a.achievement_id), '[]'::jsonb)
      from public.player_achievements a where a.user_id = p_user_id)
  );
end;
$$;

-- p_awards: [{ achievement_id, achieved_at?, source_type?, source_id? }]
-- Returns { created: [...newly inserted], unlocked: [...all] }.
create function public.award_achievements(p_user_id uuid, p_awards jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  award jsonb;
  achievement text;
  source_kind text;
  source_ref text;
  achieved timestamptz;
  inserted record;
  created jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.profiles where user_id = p_user_id) then raise exception 'unknown_player'; end if;
  if jsonb_typeof(p_awards) <> 'array' or jsonb_array_length(p_awards) > 50 then raise exception 'invalid_achievement_award'; end if;

  for award in select value from jsonb_array_elements(p_awards) loop
    achievement := award ->> 'achievement_id';
    source_kind := award ->> 'source_type';
    source_ref := award ->> 'source_id';
    if not exists (select 1 from public.achievement_definitions where id = achievement and status = 'available') then
      raise exception 'invalid_achievement_award';
    end if;
    if (source_kind is null) <> (source_ref is null) then raise exception 'invalid_achievement_award'; end if;
    -- The cited source must be the player's own authoritative record.
    if source_kind is not null and not (
      (source_kind = 'game_result' and source_ref ~ '^[0-9a-f-]{36}$'
        and exists (select 1 from public.game_results where session_id = source_ref::uuid and user_id = p_user_id))
      or (source_kind = 'department_membership' and source_ref ~ '^[0-9a-f-]{36}$'
        and exists (select 1 from public.department_memberships where id = source_ref::uuid and user_id = p_user_id))
      or (source_kind = 'contribution_event' and source_ref ~ '^[0-9a-f-]{36}$'
        and exists (select 1 from public.contribution_events where session_id = source_ref::uuid and user_id = p_user_id))
    ) then
      raise exception 'invalid_achievement_award';
    end if;
    achieved := least(coalesce((award ->> 'achieved_at')::timestamptz, now()), now());

    insert into public.player_achievements (user_id, achievement_id, unlocked_at, source_type, source_id)
    values (p_user_id, achievement, achieved, source_kind, source_ref)
    on conflict (user_id, achievement_id) do nothing
    returning achievement_id, unlocked_at into inserted;
    if found then
      created := created || jsonb_build_array(jsonb_build_object('achievement_id', inserted.achievement_id, 'unlocked_at', inserted.unlocked_at));
    end if;
  end loop;

  return jsonb_build_object(
    'created', created,
    'unlocked', (
      select coalesce(jsonb_agg(jsonb_build_object('achievement_id', a.achievement_id, 'unlocked_at', a.unlocked_at)
        order by a.unlocked_at, a.achievement_id), '[]'::jsonb)
      from public.player_achievements a where a.user_id = p_user_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and Row Level Security
-- ---------------------------------------------------------------------------

alter table public.achievement_definitions enable row level security;
alter table public.player_achievements enable row level security;

revoke all on public.achievement_definitions, public.player_achievements from public, anon, authenticated, service_role;
grant select on public.achievement_definitions to anon, authenticated, service_role;
grant select on public.player_achievements to authenticated, service_role;
create policy achievement_definitions_read on public.achievement_definitions for select to anon, authenticated using (true);
create policy player_achievements_read_own on public.player_achievements for select to authenticated using (user_id = auth.uid());

revoke execute on function public.guard_player_achievements() from public, anon, authenticated, service_role;
revoke execute on function public.guard_achievement_definitions() from public, anon, authenticated, service_role;
revoke execute on function public.get_achievement_facts(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.award_achievements(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.get_achievement_facts(uuid) to service_role;
grant execute on function public.award_achievements(uuid, jsonb) to service_role;
