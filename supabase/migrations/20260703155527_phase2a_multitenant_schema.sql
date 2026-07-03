-- ============================================================================
-- FinSight — Phase 2a: multi-tenant schema + RLS + tenancy helpers
-- ============================================================================
-- Converts FinSight from a single-user localStorage tool into a multi-tenant
-- SaaS foundation. This migration is SCHEMA-ONLY (no UI, no billing logic yet).
--
-- Tenant model: pool model. Every tenant row carries firm_id; Row-Level
-- Security scopes all reads/writes to the caller's firm(s) via the
-- SECURITY DEFINER helper auth_firm_ids(). One wrong policy leaks a firm's
-- financial PII to another firm, so tenant isolation is SQL-tested before any
-- UI is built on top (see the isolation test run separately).
--
-- Roles that touch these tables:
--   anon          -> no access (revoked below).
--   authenticated -> RLS-scoped to their firm(s).
--   service_role  -> BYPASSRLS; used by server-side billing/admin/invite code.
--
-- Idempotent by design (safe to re-apply during Phase 2a iteration):
--   enums guarded, tables use IF NOT EXISTS, policies DROP-then-CREATE,
--   functions CREATE OR REPLACE, triggers DROP-then-CREATE.
-- ============================================================================

-- Built-in gen_random_uuid() lives in pgcrypto on this project.
create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.membership_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  -- 'active'  = has access; 'invited' = pre-provisioned, not yet accepted;
  -- 'revoked' = soft-removed (kept for audit; loses access because it is not 'active').
  create type public.membership_status as enum ('active', 'invited', 'revoked');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- updated_at trigger helper
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- firms — tenant root. One row per customer firm/account.
-- ----------------------------------------------------------------------------
create table if not exists public.firms (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (char_length(btrim(name)) between 1 and 200),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  -- Superset of Stripe subscription.status so a webhook never fails to persist
  -- a status. App access-gating (Phase 4) maps these -> allowed/read-only/locked.
  plan_status            text not null default 'trialing'
                           check (plan_status in (
                             'trialing', 'active', 'past_due', 'canceled',
                             'incomplete', 'incomplete_expired', 'unpaid', 'paused'
                           )),
  trial_ends_at          timestamptz,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.firms is
  'Tenant root. Billing columns (stripe_*, plan_status, *_at/_end) are written ONLY by the service role (Stripe webhooks / server actions); authenticated users have SELECT only.';

-- ----------------------------------------------------------------------------
-- memberships — user <-> firm join table (NOT users.firm_id, so invites and
-- future multi-firm membership work cleanly). A user has <=1 row per firm.
-- ----------------------------------------------------------------------------
create table if not exists public.memberships (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.membership_role   not null default 'member',
  status     public.membership_status not null default 'active',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, user_id)
);

-- auth_firm_ids() filters memberships by user_id + status on every RLS check.
create index if not exists memberships_user_active_idx
  on public.memberships (user_id) where status = 'active';
create index if not exists memberships_firm_idx
  on public.memberships (firm_id);

comment on table public.memberships is
  'User<->firm join table with role. auth_firm_ids() reads this. RLS write policies gate to owner/admin; finer escalation rules (no self-promote, keep >=1 owner) are enforced server-side in Phase 3.';

-- ----------------------------------------------------------------------------
-- invitations — pending team invites, keyed by EMAIL (invitee may have no
-- auth account yet). Only a HASH of the invite token is stored.
-- ----------------------------------------------------------------------------
create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id) on delete cascade,
  email       text not null check (email = lower(email)),  -- stored normalized
  role        public.membership_role not null default 'member',
  token_hash  text not null,                                -- sha256 of the emailed token; plaintext never stored
  invited_by  uuid references auth.users(id) on delete set null,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- At most one OUTSTANDING invite per (firm, email); accepted ones don't block re-invite.
create unique index if not exists invitations_pending_unique_idx
  on public.invitations (firm_id, email) where accepted_at is null;
create index if not exists invitations_email_idx on public.invitations (email);
create index if not exists invitations_token_hash_idx on public.invitations (token_hash);
create index if not exists invitations_firm_idx on public.invitations (firm_id);

comment on table public.invitations is
  'Pending team invites keyed by email. Acceptance (set accepted_at + create membership) is mediated server-side (service role / SECURITY DEFINER RPC) in Phase 3 — an invitee is not yet owner/admin, so they cannot self-write here; they may only SELECT their own pending invite by email.';

-- ----------------------------------------------------------------------------
-- workspaces — a firm's client workspaces. The localStorage ClientWorkspace
-- JSON moves into data. name + industry_profile are denormalized top-level
-- columns so lists/admin can render WITHOUT reading the financial-PII blob.
-- ----------------------------------------------------------------------------
create table if not exists public.workspaces (
  id               uuid primary key default gen_random_uuid(),
  firm_id          uuid not null references public.firms(id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 200),
  industry_profile text not null,                    -- ClientWorkspace.industryProfileId
  data             jsonb not null default '{}'::jsonb, -- full ClientWorkspace JSON (financial PII)
  source_local_id  text,                             -- original localStorage "ws-..." id, for idempotent Phase 2b import
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists workspaces_firm_idx on public.workspaces (firm_id);
-- Prevent double-importing the same localStorage workspace (Phase 2b).
create unique index if not exists workspaces_firm_source_local_idx
  on public.workspaces (firm_id, source_local_id) where source_local_id is not null;

comment on table public.workspaces is
  'A firm''s client workspaces. data jsonb holds the full ClientWorkspace JSON (financial PII). The super-admin metadata console must NEVER select the data column.';
comment on column public.workspaces.data is
  'Financial PII (accounts, values, scenarios, operational data). Never exposed to the metadata-only super-admin console.';

-- ----------------------------------------------------------------------------
-- audit_log — append-only per-firm activity trail.
-- ----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action        text not null,
  target        text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_log_firm_created_idx
  on public.audit_log (firm_id, created_at desc);

comment on table public.audit_log is
  'Append-only firm activity trail. No UPDATE/DELETE policy for authenticated (immutable). SELECT is owner/admin oversight only.';

-- updated_at triggers
drop trigger if exists firms_set_updated_at on public.firms;
create trigger firms_set_updated_at before update on public.firms
  for each row execute function public.set_updated_at();

drop trigger if exists memberships_set_updated_at on public.memberships;
create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Tenancy helpers (SECURITY DEFINER)
-- ============================================================================
-- SECURITY DEFINER + owned by postgres => the function body reads memberships
-- with the OWNER's rights, which BYPASS RLS. This is what lets the memberships
-- RLS policy reference auth_firm_ids() WITHOUT infinite recursion. auth.uid()
-- still reflects the CALLER's JWT (it reads a session GUC, not the role).
-- search_path = '' forces fully-qualified names (no search_path injection).
-- ----------------------------------------------------------------------------
create or replace function public.auth_firm_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.firm_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.status = 'active';
$$;

comment on function public.auth_firm_ids() is
  'SECURITY DEFINER. firm_ids where the current auth.uid() has an ACTIVE membership. Basis of every tenant-isolation policy. Bypasses memberships RLS (owner rights) to avoid recursive RLS.';

create or replace function public.auth_has_firm_role(
  target_firm   uuid,
  allowed_roles public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = (select auth.uid())
      and m.firm_id = target_firm
      and m.status  = 'active'
      and m.role    = any(allowed_roles)
  );
$$;

comment on function public.auth_has_firm_role(uuid, public.membership_role[]) is
  'SECURITY DEFINER. True if the current user has an active membership in target_firm with one of allowed_roles. Used to role-gate writes.';

-- Lock these SECURITY DEFINER helpers down to signed-in users + service role.
-- Supabase's default privileges grant EXECUTE to anon DIRECTLY (not via PUBLIC),
-- so revoking from PUBLIC alone leaves anon able to call them over /rest/v1/rpc.
-- (authenticated MUST keep EXECUTE — RLS policies reference these functions, so
--  the querying role needs it. They only ever return the CALLER's own firm_ids /
--  role booleans, so direct RPC exposure to a signed-in user leaks nothing.)
revoke all on function public.auth_firm_ids() from public, anon;
revoke all on function public.auth_has_firm_role(uuid, public.membership_role[]) from public, anon;
grant execute on function public.auth_firm_ids() to authenticated, service_role;
grant execute on function public.auth_has_firm_role(uuid, public.membership_role[]) to authenticated, service_role;

-- ============================================================================
-- Table privileges (RLS only filters privileges a role already holds)
-- ============================================================================
-- Supabase's default privileges pre-grant ALL DML on new public tables to
-- anon + authenticated. Revoke first, then grant back EXACTLY the intended
-- surface so the PRIVILEGE layer matches the RLS layer (defense in depth):
-- firms is SELECT-only and audit_log is append-only at BOTH layers, so a
-- future mis-added policy still can't open a write path.
revoke all on public.firms, public.memberships, public.invitations,
  public.workspaces, public.audit_log from anon, authenticated;

grant all on public.firms, public.memberships, public.invitations,
  public.workspaces, public.audit_log to service_role;

-- firms: SELECT only for authenticated; all writes are service-role (billing).
grant select on public.firms to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.invitations to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert on public.audit_log to authenticated;  -- append-only (no update/delete)

-- ============================================================================
-- Row-Level Security
-- ============================================================================
alter table public.firms       enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.workspaces  enable row level security;
alter table public.audit_log   enable row level security;

-- ---- firms -----------------------------------------------------------------
drop policy if exists firms_select on public.firms;
create policy firms_select on public.firms
  for select to authenticated
  using (id in (select public.auth_firm_ids()));
-- (no insert/update/delete policy => authenticated cannot write firms; the
--  service role provisions firms + writes billing state.)

-- ---- memberships -----------------------------------------------------------
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select to authenticated
  using (firm_id in (select public.auth_firm_ids()));

drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]));

drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships
  for update to authenticated
  using (public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]))
  with check (public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]));

drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships
  for delete to authenticated
  using (public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]));

-- ---- invitations -----------------------------------------------------------
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations
  for select to authenticated
  using (
    firm_id in (select public.auth_firm_ids())               -- firm members/admins see their firm's invites
    or email = lower((select auth.jwt() ->> 'email'))        -- an invitee sees their own pending invite
  );

drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]));

drop policy if exists invitations_update on public.invitations;
create policy invitations_update on public.invitations
  for update to authenticated
  using (public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]))
  with check (public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]));

drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations
  for delete to authenticated
  using (public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]));

-- ---- workspaces ------------------------------------------------------------
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select to authenticated
  using (firm_id in (select public.auth_firm_ids()));

drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces
  for insert to authenticated
  with check (
    firm_id in (select public.auth_firm_ids())
    and (created_by = (select auth.uid()) or created_by is null)
  );

drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces
  for update to authenticated
  using (firm_id in (select public.auth_firm_ids()))
  with check (firm_id in (select public.auth_firm_ids()));

-- All active members may delete a workspace (roles matrix: "member = work in
-- clients"). If Derek wants delete to be admin-only, swap the USING below to
-- auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]).
drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces
  for delete to authenticated
  using (firm_id in (select public.auth_firm_ids()));

-- ---- audit_log (append-only) ----------------------------------------------
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]));

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (
    firm_id in (select public.auth_firm_ids())
    and (actor_user_id = (select auth.uid()) or actor_user_id is null)
  );
-- (no update/delete policy => immutable for authenticated.)
