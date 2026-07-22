-- ─────────────────────────────────────────────────────────────────────────────
-- QBO connections — one QuickBooks Online company linked to one client workspace
--
-- STRICTLY ADDITIVE: creates new objects only; alters nothing that exists.
-- The live app never reads this table, so applying it does not affect prod.
--
-- Security model (mirrors the firms billing-columns precedent):
--   • authenticated: COLUMN-LEVEL SELECT only — token ciphertext columns are
--     NOT granted, so no client/API path can ever read them, regardless of RLS.
--   • all writes: service_role only (server code), no authenticated policies.
--   • firm_id / workspace_id / realm_id pinned immutable by trigger.
-- Tokens are AES-256-GCM ciphertext (encrypted app-side with QBO_TOKEN_KEY);
-- the key never enters the database.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.qbo_connections (
  id                            uuid primary key default gen_random_uuid(),
  firm_id                       uuid not null references public.firms(id) on delete cascade,
  workspace_id                  uuid not null references public.workspaces(id) on delete cascade,
  realm_id                      text not null,
  company_name                  text,
  access_token_enc              text,
  access_token_expires_at       timestamptz,
  refresh_token_enc             text,
  refresh_token_expires_at      timestamptz, -- rolling 100-day expiry
  refresh_token_hard_expires_at timestamptz, -- Intuit 5-year hard cap
  status                        text not null default 'active'
                                  check (status in ('active','needs_reauth','revoked','error')),
  last_synced_at                timestamptz,
  last_sync_error               text,
  connected_by                  uuid,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint qbo_connections_workspace_unique unique (workspace_id),
  constraint qbo_connections_firm_realm_unique unique (firm_id, realm_id)
);

comment on table public.qbo_connections is
  'QuickBooks Online OAuth connections. One row = one QBO company (realmId) linked '
  'to one client workspace. Token columns hold AES-256-GCM ciphertext and are not '
  'granted to authenticated — server-only via service_role.';

create index if not exists qbo_connections_firm_id_idx
  on public.qbo_connections (firm_id);

-- updated_at (house helper from the phase-2a migration)
drop trigger if exists qbo_connections_set_updated_at on public.qbo_connections;
create trigger qbo_connections_set_updated_at
  before update on public.qbo_connections
  for each row execute function public.set_updated_at();

-- Pin identity columns immutable (house pattern: workspaces_pin_immutable_columns).
-- Changing the linked company = delete + reinsert by server code, never UPDATE.
create or replace function public.qbo_connections_pin_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.firm_id      := old.firm_id;
  new.workspace_id := old.workspace_id;
  new.realm_id     := old.realm_id;
  new.connected_by := old.connected_by;
  new.created_at   := old.created_at;
  return new;
end;
$$;

revoke all on function public.qbo_connections_pin_immutable_columns() from public, anon, authenticated;

drop trigger if exists qbo_connections_pin_immutable on public.qbo_connections;
create trigger qbo_connections_pin_immutable
  before update on public.qbo_connections
  for each row execute function public.qbo_connections_pin_immutable_columns();

-- RLS: firm-scoped SELECT only; no authenticated write policies (service_role bypasses).
alter table public.qbo_connections enable row level security;

drop policy if exists qbo_connections_select on public.qbo_connections;
create policy qbo_connections_select on public.qbo_connections
  for select to authenticated
  using (firm_id in (select public.auth_firm_ids()));

-- Privilege layer (defense in depth, mirrors RLS): revoke everything Supabase
-- default-granted, then grant back only the intended surface. Token ciphertext
-- columns are structurally invisible to authenticated.
revoke all on table public.qbo_connections from public, anon, authenticated;
grant select (
  id, firm_id, workspace_id, realm_id, company_name,
  access_token_expires_at, refresh_token_expires_at, refresh_token_hard_expires_at,
  status, last_synced_at, last_sync_error, connected_by, created_at, updated_at
) on public.qbo_connections to authenticated;
