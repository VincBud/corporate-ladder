-- Corporate Ladder · Closed Alpha invitations: no exemptions
--
-- Correction to 20261102120000. Its trigger exempted accounts whose
-- app_metadata had test_account or alpha_exempt = true. Testing against real
-- Supabase Auth showed that admin-created users get custom app_metadata
-- only after the insert, so the trigger never sees it: the exemption could
-- never apply (and was untestable). It is removed rather than left as dead
-- code.
--
-- While invitations are required, every new account needs one, whichever way
-- it is created (sign-up form, Auth API, admin API, dashboard). Admin tooling
-- passes the code as user metadata (alpha_invite), like the sign-up form, or
-- switches invite_required off for the moment (npm run alpha:invites -- require off).

create or replace function public.enforce_alpha_invitation() returns trigger
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
    if not required then return new; end if;
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

revoke execute on function public.enforce_alpha_invitation() from public, anon, authenticated, service_role;
