-- ============================================================================
-- FinSight — Phase 3: server-mediated RPC layer (membership + invitations)
-- ============================================================================
-- Phase 2a hardening REVOKED direct authenticated writes on memberships,
-- invitations and audit_log. This migration provides the controlled,
-- invariant-enforcing SECURITY DEFINER RPCs that replace them. Every write here
-- runs as the function owner (postgres, BYPASSRLS) but re-derives authorization
-- from auth.uid() / the caller's verified email — so the client never gets a
-- raw write path, and the rules the adversarial review flagged are enforced:
--   * role cap        — only an owner may grant/allow the 'owner' or 'admin' role
--   * >= 1 owner       — the last active owner can't be demoted/removed
--   * no self-promote  — you can't change your own role
--   * verified accept  — invite acceptance requires the caller's CONFIRMED email
--                        to match the invite (replaces the deleted RLS email branch)
--
-- Grants: firm bootstrap is service_role-only (Stripe webhook / Phase-4 signup);
-- team + invite RPCs are authenticated. All revoked from anon/public.
-- search_path='' on every function (fully-qualified names only). Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- create_firm_with_owner — provision a firm + its first owner atomically.
-- SERVICE-ROLE ONLY. Called by the Stripe webhook (Phase 4) after a completed
-- checkout, or by a trusted server action. Never exposed to authenticated
-- clients, so a user cannot self-provision a firm and skip billing.
-- ----------------------------------------------------------------------------
create or replace function public.create_firm_with_owner(
  p_firm_name             text,
  p_owner_user_id         uuid,
  p_trial_days            int  default 7,
  p_stripe_customer_id    text default null,
  p_stripe_subscription_id text default null,
  p_plan_status           text default 'trialing'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_firm_id uuid;
begin
  if p_owner_user_id is null then
    raise exception 'owner user id is required' using errcode = 'null_value_not_allowed';
  end if;

  -- Idempotency for the webhook: if this Stripe customer already has a firm, return it.
  if p_stripe_customer_id is not null then
    select id into v_firm_id from public.firms where stripe_customer_id = p_stripe_customer_id;
    if v_firm_id is not null then
      return v_firm_id;
    end if;
  end if;

  insert into public.firms (name, plan_status, trial_ends_at, stripe_customer_id, stripe_subscription_id)
  values (
    p_firm_name,
    p_plan_status,
    case when p_plan_status = 'trialing' then now() + make_interval(days => p_trial_days) else null end,
    p_stripe_customer_id,
    p_stripe_subscription_id
  )
  returning id into v_firm_id;

  insert into public.memberships (firm_id, user_id, role, status)
  values (v_firm_id, p_owner_user_id, 'owner', 'active');

  insert into public.audit_log (firm_id, actor_user_id, action, target, metadata)
  values (v_firm_id, p_owner_user_id, 'firm.created', 'firm:' || v_firm_id,
          jsonb_build_object('plan_status', p_plan_status));

  return v_firm_id;
end;
$$;

comment on function public.create_firm_with_owner(text, uuid, int, text, text, text) is
  'SERVICE-ROLE ONLY. Atomically creates a firm + its owner membership + audit row. Called by the Stripe webhook / trusted signup server action. Idempotent on stripe_customer_id.';

-- ----------------------------------------------------------------------------
-- create_invitation — an owner/admin invites an email. Returns the PLAINTEXT
-- token (for the app to email); only its sha256 hash is stored. Role is capped:
-- only an owner may invite 'admin' or 'owner'.
-- ----------------------------------------------------------------------------
create or replace function public.create_invitation(
  p_firm_id uuid,
  p_email   text,
  p_role    public.membership_role default 'member'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller       uuid := (select auth.uid());
  v_caller_role  public.membership_role;
  v_email        text := lower(btrim(p_email));
  v_token        text;
  v_already      boolean;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select m.role into v_caller_role
  from public.memberships m
  where m.user_id = v_caller and m.firm_id = p_firm_id and m.status = 'active';

  if v_caller_role is null or v_caller_role not in ('owner','admin') then
    raise exception 'only an active owner or admin may invite' using errcode = 'insufficient_privilege';
  end if;

  -- Role cap: only an owner may grant a privileged role.
  if p_role <> 'member' and v_caller_role <> 'owner' then
    raise exception 'only an owner may invite role %', p_role using errcode = 'insufficient_privilege';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email address' using errcode = 'invalid_parameter_value';
  end if;

  -- Already an active member of this firm?
  select exists (
    select 1 from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.firm_id = p_firm_id and m.status = 'active' and lower(u.email) = v_email
  ) into v_already;
  if v_already then
    raise exception 'that email is already an active member of this firm' using errcode = 'unique_violation';
  end if;

  -- Replace any existing pending invite for this (firm, email).
  delete from public.invitations where firm_id = p_firm_id and email = v_email and accepted_at is null;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.invitations (firm_id, email, role, token_hash, invited_by)
  values (p_firm_id, v_email, p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_caller);

  insert into public.audit_log (firm_id, actor_user_id, action, target, metadata)
  values (p_firm_id, v_caller, 'invitation.created', 'email:' || v_email,
          jsonb_build_object('role', p_role));

  return v_token;
end;
$$;

comment on function public.create_invitation(uuid, text, public.membership_role) is
  'Owner/admin invites an email. Returns the PLAINTEXT invite token (email it); stores only the sha256 hash. Only an owner may invite admin/owner.';

-- ----------------------------------------------------------------------------
-- accept_invitation — the invitee redeems the plaintext token. Requires the
-- caller's CONFIRMED email to match the invitation (server-verified, not the
-- JWT claim). Creates/reactivates their membership. Returns the firm_id.
-- ----------------------------------------------------------------------------
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller        uuid := (select auth.uid());
  v_email         text;
  v_confirmed_at  timestamptz;
  v_hash          text;
  v_inv           public.invitations%rowtype;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed_at
  from auth.users u where u.id = v_caller;

  if v_confirmed_at is null then
    raise exception 'a confirmed email is required to accept an invitation' using errcode = 'insufficient_privilege';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_inv from public.invitations
  where token_hash = v_hash and accepted_at is null and expires_at > now();

  if v_inv.id is null then
    raise exception 'invalid or expired invitation' using errcode = 'no_data_found';
  end if;

  if v_inv.email <> v_email then
    raise exception 'this invitation was issued to a different email address' using errcode = 'insufficient_privilege';
  end if;

  insert into public.memberships (firm_id, user_id, role, status, invited_by)
  values (v_inv.firm_id, v_caller, v_inv.role, 'active', v_inv.invited_by)
  on conflict (firm_id, user_id)
    do update set status = 'active', role = excluded.role, updated_at = now();

  update public.invitations
    set accepted_at = now(), accepted_by = v_caller
  where id = v_inv.id;

  insert into public.audit_log (firm_id, actor_user_id, action, target, metadata)
  values (v_inv.firm_id, v_caller, 'invitation.accepted', 'invitation:' || v_inv.id,
          jsonb_build_object('role', v_inv.role));

  return v_inv.firm_id;
end;
$$;

comment on function public.accept_invitation(text) is
  'Invitee redeems the plaintext invite token. Requires the caller''s CONFIRMED email to match the invite (server-verified). Creates/reactivates their membership.';

-- ----------------------------------------------------------------------------
-- revoke_invitation — owner/admin cancels a pending invite.
-- ----------------------------------------------------------------------------
create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_firm   uuid;
begin
  select firm_id into v_firm from public.invitations where id = p_invitation_id and accepted_at is null;
  if v_firm is null then
    raise exception 'pending invitation not found' using errcode = 'no_data_found';
  end if;
  if not public.auth_has_firm_role(v_firm, array['owner','admin']::public.membership_role[]) then
    raise exception 'only an active owner or admin may revoke invitations' using errcode = 'insufficient_privilege';
  end if;

  delete from public.invitations where id = p_invitation_id;

  insert into public.audit_log (firm_id, actor_user_id, action, target)
  values (v_firm, v_caller, 'invitation.revoked', 'invitation:' || p_invitation_id);
end;
$$;

comment on function public.revoke_invitation(uuid) is 'Owner/admin cancels a pending (unaccepted) invitation.';

-- ----------------------------------------------------------------------------
-- set_membership_role — change a member's role, enforcing role-cap, no
-- self-change, owner-tier gating, and the >=1-owner invariant.
-- ----------------------------------------------------------------------------
create or replace function public.set_membership_role(
  p_membership_id uuid,
  p_new_role      public.membership_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller       uuid := (select auth.uid());
  v_caller_role  public.membership_role;
  v_t_firm       uuid;
  v_t_user       uuid;
  v_t_role       public.membership_role;
  v_t_status     public.membership_status;
  v_owner_count  int;
begin
  select firm_id, user_id, role, status into v_t_firm, v_t_user, v_t_role, v_t_status
  from public.memberships where id = p_membership_id;
  if v_t_firm is null then
    raise exception 'membership not found' using errcode = 'no_data_found';
  end if;

  select m.role into v_caller_role
  from public.memberships m
  where m.user_id = v_caller and m.firm_id = v_t_firm and m.status = 'active';
  if v_caller_role is null or v_caller_role not in ('owner','admin') then
    raise exception 'only an active owner or admin may change roles' using errcode = 'insufficient_privilege';
  end if;

  if v_t_user = v_caller then
    raise exception 'you cannot change your own role' using errcode = 'insufficient_privilege';
  end if;

  -- Owner-tier changes (granting or removing 'owner') require the caller be an owner.
  if (p_new_role = 'owner' or v_t_role = 'owner') and v_caller_role <> 'owner' then
    raise exception 'only an owner may change owner-tier roles' using errcode = 'insufficient_privilege';
  end if;

  -- Keep at least one active owner.
  if v_t_role = 'owner' and p_new_role <> 'owner' then
    select count(*) into v_owner_count from public.memberships
    where firm_id = v_t_firm and role = 'owner' and status = 'active';
    if v_owner_count <= 1 then
      raise exception 'cannot demote the last remaining owner' using errcode = 'check_violation';
    end if;
  end if;

  if p_new_role = v_t_role then
    return; -- no-op
  end if;

  update public.memberships set role = p_new_role where id = p_membership_id;

  insert into public.audit_log (firm_id, actor_user_id, action, target, metadata)
  values (v_t_firm, v_caller, 'membership.role_changed', 'user:' || v_t_user,
          jsonb_build_object('from', v_t_role, 'to', p_new_role));
end;
$$;

comment on function public.set_membership_role(uuid, public.membership_role) is
  'Change a member''s role. Enforces: no self-change, owner-tier changes are owner-only, and >=1 active owner always remains.';

-- ----------------------------------------------------------------------------
-- remove_membership — soft-remove (status='revoked') a member. Admins cannot
-- remove owners; the last owner and self-removal are blocked here.
-- ----------------------------------------------------------------------------
create or replace function public.remove_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller       uuid := (select auth.uid());
  v_caller_role  public.membership_role;
  v_t_firm       uuid;
  v_t_user       uuid;
  v_t_role       public.membership_role;
  v_owner_count  int;
begin
  select firm_id, user_id, role into v_t_firm, v_t_user, v_t_role
  from public.memberships where id = p_membership_id and status = 'active';
  if v_t_firm is null then
    raise exception 'active membership not found' using errcode = 'no_data_found';
  end if;

  select m.role into v_caller_role
  from public.memberships m
  where m.user_id = v_caller and m.firm_id = v_t_firm and m.status = 'active';
  if v_caller_role is null or v_caller_role not in ('owner','admin') then
    raise exception 'only an active owner or admin may remove members' using errcode = 'insufficient_privilege';
  end if;

  if v_t_user = v_caller then
    raise exception 'you cannot remove yourself; transfer ownership or leave the firm instead' using errcode = 'insufficient_privilege';
  end if;

  if v_t_role = 'owner' then
    if v_caller_role <> 'owner' then
      raise exception 'only an owner may remove another owner' using errcode = 'insufficient_privilege';
    end if;
    select count(*) into v_owner_count from public.memberships
    where firm_id = v_t_firm and role = 'owner' and status = 'active';
    if v_owner_count <= 1 then
      raise exception 'cannot remove the last remaining owner' using errcode = 'check_violation';
    end if;
  end if;

  update public.memberships set status = 'revoked' where id = p_membership_id;

  insert into public.audit_log (firm_id, actor_user_id, action, target, metadata)
  values (v_t_firm, v_caller, 'membership.removed', 'user:' || v_t_user,
          jsonb_build_object('role', v_t_role));
end;
$$;

comment on function public.remove_membership(uuid) is
  'Soft-remove (revoke) a member. Admins cannot remove owners; self-removal and removing the last owner are blocked.';

-- ----------------------------------------------------------------------------
-- Grants: lock down to the intended callers.
-- ----------------------------------------------------------------------------
revoke all on function public.create_firm_with_owner(text, uuid, int, text, text, text) from public, anon, authenticated;
grant  execute on function public.create_firm_with_owner(text, uuid, int, text, text, text) to service_role;

revoke all on function public.create_invitation(uuid, text, public.membership_role) from public, anon;
grant  execute on function public.create_invitation(uuid, text, public.membership_role) to authenticated, service_role;

revoke all on function public.accept_invitation(text) from public, anon;
grant  execute on function public.accept_invitation(text) to authenticated, service_role;

revoke all on function public.revoke_invitation(uuid) from public, anon;
grant  execute on function public.revoke_invitation(uuid) to authenticated, service_role;

revoke all on function public.set_membership_role(uuid, public.membership_role) from public, anon;
grant  execute on function public.set_membership_role(uuid, public.membership_role) to authenticated, service_role;

revoke all on function public.remove_membership(uuid) from public, anon;
grant  execute on function public.remove_membership(uuid) to authenticated, service_role;
