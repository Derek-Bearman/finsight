-- ============================================================================
-- FinSight — Phase 2a: RLS hardening (adversarial-review pass, 2026-07-03)
-- ============================================================================
-- Follow-up to 20260703155527_phase2a_multitenant_schema.sql. A multi-agent
-- adversarial RLS review found tables meant to be MUTATED ONLY BY SERVER-SIDE
-- CODE (Stripe webhooks in Phase 4; invite/accept + team-management RPCs in
-- Phase 3) still had live `authenticated` write paths via PostgREST. Deferring
-- the "no self-promote / keep >=1 owner / server-mediated invite" rules to
-- Phase 3 is only safe if `authenticated` has NO direct write path to those
-- tables. This migration closes those paths now, and pins tenant/attribution
-- columns that an RLS WITH CHECK cannot protect (it cannot reference OLD).
--
-- Net `authenticated` surface after this migration:
--   firms        SELECT only (own firm)                         [unchanged]
--   memberships  SELECT only (co-members); ALL writes -> service_role / RPC
--   invitations  SELECT only (owner/admin, own firm); writes -> service_role / RPC
--   workspaces   full CRUD (own firm); firm_id + created_by IMMUTABLE on UPDATE
--   audit_log    SELECT only (owner/admin); writes -> service_role / triggers
--
-- All tenant isolation still holds (re-proven with SQL). Idempotent.
-- ============================================================================

-- ---- BLOCKER 1: invitations_select trusted the raw JWT email claim ----------
-- The email-match branch authorized reads on an UNVERIFIED, user-influenced
-- `email` claim (no email_confirmed_at gate) — a config-dependent path to
-- reading other firms' pending-invite metadata (firm_id, role, inviter, expiry,
-- token_hash). Phase 2a does not need invitee self-visibility via RLS: Phase 3
-- serves an invitee their own invite through a SECURITY DEFINER RPC keyed on the
-- plaintext invite token (sha256(token) = token_hash). Restrict SELECT to the
-- firm's own owners/admins and drop the email branch entirely.
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations
  for select to authenticated
  using (public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]));

-- ---- BLOCKERS 2 & 4: memberships had live authenticated write paths ----------
-- `authenticated` could INSERT an arbitrary (user_id, role='owner'), self-promote
-- member/admin -> owner via UPDATE, and delete/revoke the last owner: full
-- intra-firm takeover, with the (insufficient) policies as the only guard.
-- Membership changes are ALWAYS server-mediated (signup owner-bootstrap =
-- service_role; invite acceptance = Phase 3 RPC). Remove the authenticated write
-- privilege AND policies (defense in depth); keep SELECT for co-member visibility.
drop policy if exists memberships_insert on public.memberships;
drop policy if exists memberships_update on public.memberships;
drop policy if exists memberships_delete on public.memberships;
revoke insert, update, delete on public.memberships from authenticated;

-- ---- invitations writes are server-mediated too: the invite token is generated
--      + hashed server-side, and the granted role must be capped by the accept
--      RPC. Remove authenticated write privilege + policies; keep the (now
--      owner/admin-only) SELECT above. --------------------------------------------
drop policy if exists invitations_insert on public.invitations;
drop policy if exists invitations_update on public.invitations;
drop policy if exists invitations_delete on public.invitations;
revoke insert, update, delete on public.invitations from authenticated;

-- ---- audit_log is written by trusted server code / triggers, never the client.
--      (A plain member could otherwise inject fabricated, unattributed rows into
--      an append-only trail owners rely on.) Keep the owner/admin SELECT. --------
drop policy if exists audit_log_insert on public.audit_log;
revoke insert on public.audit_log from authenticated;

-- ---- BLOCKER 3: workspaces_update let a dual-firm member move a workspace ------
-- (and its financial-PII `data` blob) across the tenant boundary: USING passed on
-- OLD.firm_id (a firm the caller is in) and WITH CHECK passed on NEW.firm_id
-- (another firm the caller is also in). RLS WITH CHECK cannot reference OLD, so
-- pin firm_id (and created_by attribution) with a BEFORE UPDATE trigger.
create or replace function public.workspaces_pin_immutable_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.firm_id is distinct from old.firm_id then
    raise exception 'workspaces.firm_id is immutable (attempted % -> %)', old.firm_id, new.firm_id
      using errcode = 'check_violation';
  end if;
  -- Preserve original authorship; ignore any client attempt to rewrite / null it.
  new.created_by := old.created_by;
  return new;
end;
$$;

drop trigger if exists workspaces_pin_immutable on public.workspaces;
create trigger workspaces_pin_immutable
  before update on public.workspaces
  for each row execute function public.workspaces_pin_immutable_columns();

-- ---- Low: make invitation email normalization a DB guarantee (not a caller
--      responsibility) so a mixed-case address can't hard-fail the
--      CHECK(email = lower(email)). Fires for service_role writes too. ----------
create or replace function public.invitations_normalize_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;

drop trigger if exists invitations_normalize_email on public.invitations;
create trigger invitations_normalize_email
  before insert or update on public.invitations
  for each row execute function public.invitations_normalize_email();
