-- ─────────────────────────────────────────────────────────────────────────────
-- Franchises — firm-level franchise entities carrying franchise-wide data
-- (corporate benchmark sets, corporate SCOA) shared by linked franchisee
-- workspaces (workspace.data.franchiseId, jsonb-only — no workspace DDL).
--
-- STRICTLY ADDITIVE: creates new objects only; alters nothing that exists.
-- The live app never reads this table until the franchise UI ships, so
-- applying it does not affect prod.
--
-- Security model (house patterns):
--   • SELECT: any active firm member (RLS via auth_firm_ids) — members need to
--     read benchmark sets/SCOA to render analysis in client workspaces.
--   • INSERT/UPDATE/DELETE: owner/admin only (auth_has_firm_role), matching
--     "franchise config is admin surface". All app writes go through server
--     actions, but the PostgREST surface is safe on its own.
--   • firm_id / created_by / created_at pinned immutable by trigger
--     (workspaces_pin_immutable_columns precedent).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.franchises (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references public.firms(id) on delete cascade,
  name                text not null check (char_length(btrim(name)) between 1 and 120),
  industry_profile_id text,
  config              jsonb not null default '{}'::jsonb,
  created_by          uuid not null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint franchises_firm_name_unique unique (firm_id, name)
);

comment on table public.franchises is
  'Firm-scoped franchise entities. config jsonb holds versioned corporate '
  'benchmark sets and the corporate SCOA. Client workspaces link via '
  'workspace.data.franchiseId. Reads: firm members. Writes: owner/admin.';

create index if not exists franchises_firm_id_idx
  on public.franchises (firm_id);

-- updated_at (house helper from the phase-2a migration)
drop trigger if exists franchises_set_updated_at on public.franchises;
create trigger franchises_set_updated_at
  before update on public.franchises
  for each row execute function public.set_updated_at();

-- Pin identity columns immutable (house pattern).
create or replace function public.franchises_pin_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.firm_id    := old.firm_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

revoke all on function public.franchises_pin_immutable_columns() from public, anon, authenticated;

drop trigger if exists franchises_pin_immutable on public.franchises;
create trigger franchises_pin_immutable
  before update on public.franchises
  for each row execute function public.franchises_pin_immutable_columns();

-- RLS
alter table public.franchises enable row level security;

drop policy if exists franchises_select on public.franchises;
create policy franchises_select on public.franchises
  for select to authenticated
  using (firm_id in (select public.auth_firm_ids()));

drop policy if exists franchises_insert on public.franchises;
create policy franchises_insert on public.franchises
  for insert to authenticated
  with check (
    public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[])
    and created_by = auth.uid()
  );

drop policy if exists franchises_update on public.franchises;
create policy franchises_update on public.franchises
  for update to authenticated
  using (public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]))
  with check (public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]));

drop policy if exists franchises_delete on public.franchises;
create policy franchises_delete on public.franchises
  for delete to authenticated
  using (public.auth_has_firm_role(firm_id, array['owner','admin']::public.membership_role[]));

-- Privilege layer (defense in depth; RLS only filters privileges a role holds).
revoke all on table public.franchises from public, anon, authenticated;
grant select, insert, update, delete on table public.franchises to authenticated;
revoke all on table public.franchises from anon;
