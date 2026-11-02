-- Corporate Ladder · Closed Alpha invitations
--
-- Invite-only registration, enforced inside the database for every way an
-- account can be created (the app's sign-up form, direct calls to the Auth
-- /signup endpoint, admin links). Additive only.
--
--   * alpha_invitations: one row per invitation, storing only the SHA-256 of
--     the normalized code. Single use: redeemed in the same transaction that
--     creates the auth user, so a failed sign-up never burns a code and two
--     simultaneous sign-ups can't both use one (row lock).
--   * alpha_access_settings: singleton switch. invite_required = false (the
--     default) keeps current behaviour; turn it on for the alpha project.
--   * enforce_alpha_invitation: BEFORE INSERT trigger on auth.users. Reads the
--     code from the sign-up metadata (alpha_invite), removes it from the
--     stored metadata, and rejects the insert when the code is missing,
--     unknown, expired, revoked or already used. Accounts created by the
--     service role with app_metadata test_account or alpha_exempt = true are
--     exempt (app_metadata can't be set through public sign-up).
--
-- Why a trigger and not the Before User Created Auth hook: the hook needs
-- dashboard configuration and runs outside the insert's transaction, so a
-- redemption there could be lost or burn a code when user creation fails
-- afterwards. The trigger is transactional and needs no Auth settings.

create table public.alpha_invitations (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  note text check (note is null or char_length(note) between 1 and 80),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  redeemed_at timestamptz,
  -- Checked at commit: the auth user is being inserted in the same transaction.
  redeemed_by uuid references auth.users (id) on delete set null deferrable initially deferred,
  check (expires_at > created_at),
  check (redeemed_by is null or redeemed_at is not null)
);

create index alpha_invitations_status_idx on public.alpha_invitations (created_at desc);

create table public.alpha_access_settings (
  id boolean primary key default true check (id),
  invite_required boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.alpha_access_settings (id) values (true);

-- Codes never change identity; a redemption or revocation is never undone.
create function public.guard_alpha_invitations() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'UPDATE' then raise exception 'alpha_invitations_append_only'; end if;
  if (new.id, new.code_hash, new.created_at, new.expires_at, new.note) is distinct from (old.id, old.code_hash, old.created_at, old.expires_at, old.note)
     or (old.redeemed_at is not null and new.redeemed_at is distinct from old.redeemed_at)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     -- redeemed_by may only be set at redemption, or cleared when that account is deleted.
     or (new.redeemed_by is distinct from old.redeemed_by and not (old.redeemed_by is null and old.redeemed_at is null) and new.redeemed_by is not null) then
    raise exception 'alpha_invitations_immutable';
  end if;
  return new;
end;
$$;

create trigger alpha_invitations_guard before update or delete on public.alpha_invitations
  for each row execute function public.guard_alpha_invitations();
create trigger alpha_invitations_no_truncate before truncate on public.alpha_invitations
  for each statement execute function public.guard_alpha_invitations();

-- Same rules as src/alpha/invite-code.ts: upper case, separators dropped,
-- optional "CL" prefix removed, look-alikes mapped (O→0, I/L→1).
create function public.normalize_alpha_invite_code(p_code text) returns text
language sql immutable set search_path = '' as $$
  select translate(
    case when char_length(c) = 14 and left(c, 2) = 'CL' then substr(c, 3) else c end,
    'OIL', '011')
  from (select upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')) as c) s;
$$;

create function public.alpha_invite_code_hash(p_code text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(public.normalize_alpha_invite_code(p_code), 'UTF8')), 'hex');
$$;

create function public.enforce_alpha_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  supplied text := new.raw_user_meta_data ->> 'alpha_invite';
  required boolean := coalesce((select invite_required from public.alpha_access_settings where id), false);
  invitation public.alpha_invitations;
begin
  -- The code is never kept in the account's metadata.
  if new.raw_user_meta_data is not null and new.raw_user_meta_data ? 'alpha_invite' then
    new.raw_user_meta_data := new.raw_user_meta_data - 'alpha_invite';
  end if;

  if supplied is null then
    if not required
       or coalesce(new.raw_app_meta_data ->> 'test_account', '') = 'true'
       or coalesce(new.raw_app_meta_data ->> 'alpha_exempt', '') = 'true' then
      return new;
    end if;
    raise exception 'alpha_invitation_required';
  end if;

  select * into invitation from public.alpha_invitations
    where code_hash = public.alpha_invite_code_hash(supplied)
    for update;
  if not found or invitation.revoked_at is not null or invitation.redeemed_at is not null or invitation.expires_at <= now() then
    raise exception 'alpha_invitation_invalid';
  end if;
  update public.alpha_invitations set redeemed_at = now(), redeemed_by = new.id where id = invitation.id;
  return new;
end;
$$;

create trigger enforce_alpha_invitation before insert on auth.users
  for each row execute function public.enforce_alpha_invitation();

-- ---------------------------------------------------------------------------
-- Trusted functions (service role only)
-- ---------------------------------------------------------------------------

-- Pre-check for the registration form. Doesn't redeem anything.
create function public.check_alpha_invitation(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.alpha_invitations
    where code_hash = public.alpha_invite_code_hash(p_code)
      and revoked_at is null and redeemed_at is null and expires_at > now());
$$;

create function public.get_alpha_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('invite_required', coalesce((select invite_required from public.alpha_access_settings where id), false));
$$;

create function public.set_alpha_invite_required(p_required boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.alpha_access_settings set invite_required = p_required, updated_at = now() where id;
  return public.get_alpha_access();
end;
$$;

-- Stores hashes produced by the CLI (codes are generated and shown only there).
-- p_code_hashes: JSON array of 1–100 SHA-256 hex strings.
create function public.create_alpha_invitations(p_code_hashes jsonb, p_expires_at timestamptz, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  created jsonb;
begin
  if jsonb_typeof(p_code_hashes) is distinct from 'array' or jsonb_array_length(p_code_hashes) not between 1 and 100 then
    raise exception 'invalid_request';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '180 days' then raise exception 'invalid_request'; end if;
  with inserted as (
    insert into public.alpha_invitations (code_hash, expires_at, note)
    select h, p_expires_at, nullif(btrim(p_note), '') from jsonb_array_elements_text(p_code_hashes) as h
    returning id, expires_at)
  select jsonb_agg(jsonb_build_object('id', id, 'expires_at', expires_at)) into created from inserted;
  return created;
end;
$$;

-- Revokes one unused invitation by id (or an unambiguous id prefix of at least 8 characters).
create function public.revoke_alpha_invitation(p_id_prefix text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  matches integer;
  target public.alpha_invitations;
begin
  if p_id_prefix is null or char_length(p_id_prefix) < 8 or p_id_prefix !~ '^[0-9a-f-]+$' then raise exception 'invalid_request'; end if;
  select count(*) into matches from public.alpha_invitations where id::text like p_id_prefix || '%';
  if matches <> 1 then raise exception 'invitation_not_found'; end if;
  select * into target from public.alpha_invitations where id::text like p_id_prefix || '%' for update;
  if target.redeemed_at is not null then raise exception 'invitation_already_redeemed'; end if;
  if target.revoked_at is null then
    update public.alpha_invitations set revoked_at = now() where id = target.id returning * into target;
  end if;
  return jsonb_build_object('id', target.id, 'revoked_at', target.revoked_at);
end;
$$;

-- Status of every invitation, without hashes or email addresses.
create function public.list_alpha_invitations() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'invite_required', coalesce((select invite_required from public.alpha_access_settings where id), false),
    'invitations', coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'note', i.note,
      'created_at', i.created_at,
      'expires_at', i.expires_at,
      'redeemed_at', i.redeemed_at,
      'revoked_at', i.revoked_at,
      'status', case
        when i.revoked_at is not null then 'revoked'
        when i.redeemed_at is not null and i.redeemed_by is null then 'redeemed (account deleted)'
        when i.redeemed_at is not null and u.email_confirmed_at is null then 'redeemed (awaiting email confirmation)'
        when i.redeemed_at is not null then 'redeemed (confirmed)'
        when i.expires_at <= now() then 'expired'
        else 'open' end) order by i.created_at), '[]'::jsonb))
  from public.alpha_invitations i
  left join auth.users u on u.id = i.redeemed_by;
$$;

-- ---------------------------------------------------------------------------
-- Grants and Row Level Security
-- ---------------------------------------------------------------------------

alter table public.alpha_invitations enable row level security;
alter table public.alpha_access_settings enable row level security;
-- No API role reads or writes these tables directly (not even the service role).
revoke all on public.alpha_invitations, public.alpha_access_settings from public, anon, authenticated, service_role;

revoke execute on function public.guard_alpha_invitations() from public, anon, authenticated, service_role;
revoke execute on function public.enforce_alpha_invitation() from public, anon, authenticated, service_role;
revoke execute on function public.normalize_alpha_invite_code(text) from public, anon, authenticated, service_role;
revoke execute on function public.alpha_invite_code_hash(text) from public, anon, authenticated, service_role;
revoke execute on function public.check_alpha_invitation(text) from public, anon, authenticated, service_role;
revoke execute on function public.get_alpha_access() from public, anon, authenticated, service_role;
revoke execute on function public.set_alpha_invite_required(boolean) from public, anon, authenticated, service_role;
revoke execute on function public.create_alpha_invitations(jsonb, timestamptz, text) from public, anon, authenticated, service_role;
revoke execute on function public.revoke_alpha_invitation(text) from public, anon, authenticated, service_role;
revoke execute on function public.list_alpha_invitations() from public, anon, authenticated, service_role;
grant execute on function public.check_alpha_invitation(text) to service_role;
grant execute on function public.get_alpha_access() to service_role;
grant execute on function public.set_alpha_invite_required(boolean) to service_role;
grant execute on function public.create_alpha_invitations(jsonb, timestamptz, text) to service_role;
grant execute on function public.revoke_alpha_invitation(text) to service_role;
grant execute on function public.list_alpha_invitations() to service_role;
