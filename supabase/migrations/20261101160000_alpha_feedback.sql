-- Corporate Ladder · Closed Alpha Feedback v0.1
--
-- Private product research: the Employee Experience Survey. Additive only.
--
--   * feedback_responses: append-only. A deliberate correction is a new
--     revision of the same respondent; analysis uses each respondent's latest
--     revision, so corrections never count twice. request_id makes retries and
--     double-clicks idempotent.
--   * Respondents: 'user:<uuid>' for accounts, or 'guest:<sha256 of a random
--     browser token>' for guests (the token itself is never stored). No email,
--     IP address, location or fingerprint is stored.
--   * Nobody reads or writes the table directly, not even the service role.
--     The server submits through submit_feedback(); the developer reads
--     through get_feedback_report(); erasure goes through
--     delete_feedback_responses(). All three are service-role only.
--   * Guests: at most 5 revisions per browser token and a global cap of 60
--     guest submissions per hour (spam backstop; per-IP limits live in the
--     app server and are never stored).
--   * Feedback earns nothing: no XP, achievements or contribution.

create table public.feedback_responses (
  id uuid primary key default gen_random_uuid(),
  survey_version text not null check (survey_version in ('alpha-1')),
  respondent_key text not null check (respondent_key ~ '^(user:[0-9a-f-]{36}|guest:[0-9a-f]{64})$'),
  user_id uuid references public.profiles (user_id) on delete cascade,
  revision integer not null check (revision between 1 and 20),
  request_id uuid not null unique,
  gameplay_fun smallint not null check (gameplay_fun between 1 and 10),
  ease_of_understanding smallint not null check (ease_of_understanding between 1 and 10),
  playability smallint not null check (playability between 1 and 10),
  replay_appeal smallint not null check (replay_appeal between 1 and 10),
  enjoyed text check (enjoyed is null or char_length(enjoyed) between 1 and 1000),
  improve text check (improve is null or char_length(improve) between 1 and 1000),
  games_played text[] not null default '{}' check (games_played <@ array['reconciliation-rush', 'pipeline-panic']::text[]),
  completed_rounds integer not null check (completed_rounds between 0 and 100000),
  session_kind text not null check (session_kind in ('guest', 'authenticated')),
  device_category text not null check (device_category in ('desktop', 'tablet', 'mobile', 'unknown')),
  submitted_at timestamptz not null default now(),
  unique (respondent_key, survey_version, revision),
  check ((session_kind = 'authenticated') = (user_id is not null)),
  check ((user_id is null) or respondent_key = 'user:' || user_id::text)
);

create index feedback_responses_version_idx on public.feedback_responses (survey_version, respondent_key, revision desc);
create index feedback_responses_guest_recent_idx on public.feedback_responses (submitted_at) where session_kind = 'guest';

-- Append-only. Deletes only cascade from a deleted account, or through
-- delete_feedback_responses() (erasure on request, test cleanup).
create function public.guard_feedback_responses() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and (pg_trigger_depth() > 1 or current_setting('corporate_ladder.feedback_erasure', true) = 'on') then
    return old;
  end if;
  raise exception 'feedback_responses_append_only';
end;
$$;

create trigger feedback_responses_append_only before update or delete on public.feedback_responses
  for each row execute function public.guard_feedback_responses();
create trigger feedback_responses_no_truncate before truncate on public.feedback_responses
  for each statement execute function public.guard_feedback_responses();

-- ---------------------------------------------------------------------------
-- Trusted functions (service role only)
-- ---------------------------------------------------------------------------

-- p_payload: { ratings: {gameplay_fun, ease_of_understanding, playability, replay_appeal},
--              enjoyed?, improve?, games_played, completed_rounds, device_category }
-- For accounts, games played and completed rounds come from verified results, not the client.
-- Returns {status: created | duplicate, id, revision, submitted_at}.
create function public.submit_feedback(p_survey_version text, p_respondent_key text, p_user_id uuid, p_request_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  existing public.feedback_responses;
  stored public.feedback_responses;
  next_revision integer;
  guest boolean := p_user_id is null;
  games text[];
  rounds integer;
begin
  if jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 8192 then raise exception 'invalid_feedback'; end if;
  if guest <> (p_respondent_key like 'guest:%') or (not guest and p_respondent_key <> 'user:' || p_user_id::text) then
    raise exception 'invalid_feedback';
  end if;
  if not guest and not exists (select 1 from public.profiles where user_id = p_user_id) then raise exception 'unknown_player'; end if;

  -- One decision at a time per respondent (revision numbering, idempotency).
  perform pg_advisory_xact_lock(hashtextextended('feedback:' || p_respondent_key, 0));

  select * into existing from public.feedback_responses where request_id = p_request_id;
  if found then
    if existing.respondent_key <> p_respondent_key then raise exception 'invalid_feedback'; end if;
    return jsonb_build_object('status', 'duplicate', 'id', existing.id, 'revision', existing.revision, 'submitted_at', existing.submitted_at);
  end if;

  select coalesce(max(revision), 0) + 1 into next_revision from public.feedback_responses
    where respondent_key = p_respondent_key and survey_version = p_survey_version;
  if next_revision > (case when guest then 5 else 20 end) then raise exception 'feedback_limit'; end if;
  if guest and (select count(*) from public.feedback_responses
                where session_kind = 'guest' and submitted_at > now() - interval '1 hour') >= 60 then
    raise exception 'rate_limited';
  end if;

  if guest then
    select coalesce(array_agg(distinct g order by g), '{}') into games
      from jsonb_array_elements_text(coalesce(p_payload -> 'games_played', '[]'::jsonb)) as g;
    rounds := (p_payload ->> 'completed_rounds')::integer;
  else
    select coalesce(array_agg(distinct r.game_id order by r.game_id), '{}'), count(*) into games, rounds
      from public.game_results r where r.user_id = p_user_id;
  end if;

  insert into public.feedback_responses (
    survey_version, respondent_key, user_id, revision, request_id,
    gameplay_fun, ease_of_understanding, playability, replay_appeal, enjoyed, improve,
    games_played, completed_rounds, session_kind, device_category
  ) values (
    p_survey_version, p_respondent_key, p_user_id, next_revision, p_request_id,
    (p_payload -> 'ratings' ->> 'gameplay_fun')::smallint,
    (p_payload -> 'ratings' ->> 'ease_of_understanding')::smallint,
    (p_payload -> 'ratings' ->> 'playability')::smallint,
    (p_payload -> 'ratings' ->> 'replay_appeal')::smallint,
    nullif(p_payload ->> 'enjoyed', ''), nullif(p_payload ->> 'improve', ''),
    games, coalesce(rounds, 0), case when guest then 'guest' else 'authenticated' end,
    coalesce(p_payload ->> 'device_category', 'unknown')
  ) returning * into stored;

  return jsonb_build_object('status', 'created', 'id', stored.id, 'revision', stored.revision, 'submitted_at', stored.submitted_at);
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then
    raise exception 'invalid_feedback';
end;
$$;

-- Whether this respondent has submitted (used to stop prompting accounts on any device).
create function public.get_feedback_status(p_survey_version text, p_respondent_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('submitted', true, 'revision', f.revision, 'submitted_at', f.submitted_at)
       from public.feedback_responses f
       where f.respondent_key = p_respondent_key and f.survey_version = p_survey_version
       order by f.revision desc limit 1),
    jsonb_build_object('submitted', false));
$$;

-- Developer report: latest revision per respondent, without respondent keys or user ids.
create function public.get_feedback_report(p_survey_version text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with latest as (
    select distinct on (f.respondent_key) f.*
    from public.feedback_responses f
    where f.survey_version = p_survey_version
    order by f.respondent_key, f.revision desc)
  select jsonb_build_object(
    'survey_version', p_survey_version,
    'generated_at', now(),
    'total_submissions', (select count(*) from public.feedback_responses where survey_version = p_survey_version),
    'responses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', substr(md5(l.respondent_key), 1, 8),
        'revision', l.revision,
        'session_kind', l.session_kind,
        'device_category', l.device_category,
        'games_played', to_jsonb(l.games_played),
        'completed_rounds', l.completed_rounds,
        'ratings', jsonb_build_object('gameplay_fun', l.gameplay_fun, 'ease_of_understanding', l.ease_of_understanding,
                                      'playability', l.playability, 'replay_appeal', l.replay_appeal),
        'enjoyed', l.enjoyed,
        'improve', l.improve,
        'submitted_at', l.submitted_at) order by l.submitted_at)
      from latest l), '[]'::jsonb)
  );
$$;

-- Erasure: removes every revision of one respondent (on request, or test cleanup).
create function public.delete_feedback_responses(p_respondent_key text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  removed integer;
begin
  perform set_config('corporate_ladder.feedback_erasure', 'on', true);
  delete from public.feedback_responses where respondent_key = p_respondent_key;
  get diagnostics removed = row_count;
  perform set_config('corporate_ladder.feedback_erasure', 'off', true);
  return removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and Row Level Security
-- ---------------------------------------------------------------------------

alter table public.feedback_responses enable row level security;
-- No policies and no grants: no API role can read or write the table directly.
revoke all on public.feedback_responses from public, anon, authenticated, service_role;

revoke execute on function public.guard_feedback_responses() from public, anon, authenticated, service_role;
revoke execute on function public.submit_feedback(text, text, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.get_feedback_status(text, text) from public, anon, authenticated, service_role;
revoke execute on function public.get_feedback_report(text) from public, anon, authenticated, service_role;
revoke execute on function public.delete_feedback_responses(text) from public, anon, authenticated, service_role;
grant execute on function public.submit_feedback(text, text, uuid, uuid, jsonb) to service_role;
grant execute on function public.get_feedback_status(text, text) to service_role;
grant execute on function public.get_feedback_report(text) to service_role;
grant execute on function public.delete_feedback_responses(text) to service_role;
