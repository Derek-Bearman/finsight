-- ============================================================================
-- FinSight — Phase 5 groundwork: metadata-admin PII boundary
-- ============================================================================
-- The "metadata-only super-admin must NEVER read workspaces.data" invariant was
-- only a comment (service_role has BYPASSRLS + grant all on workspaces, so it
-- CAN select the financial-PII blob). This adds the STRUCTURAL surface the
-- super-admin console (Phase 5) is meant to query instead of the base table: a
-- view that by construction cannot return `data`, exposing only safe metadata
-- + non-sensitive counts (how many accounts/values, not their amounts).
--
-- `security_invoker = true` => the view runs with the CALLER's rights, so RLS on
-- public.workspaces still applies: an authenticated firm user sees only their
-- own firm's rows through it; service_role (BYPASSRLS) sees all firms' metadata
-- for the admin console. Idempotent.
--
-- Phase-5 rule (enforced in app code, see src/lib/auth/super-admin.ts): the
-- super-admin data-access module must query firms / memberships /
-- workspaces_metadata ONLY, never public.workspaces (the `data` column). A
-- stronger structural option for later is a dedicated non-BYPASSRLS
-- `finsight_metadata` DB role the console connects as; deferred until the
-- console + its connection credential exist.
-- ============================================================================

drop view if exists public.workspaces_metadata;
create view public.workspaces_metadata
with (security_invoker = true) as
select
  w.id,
  w.firm_id,
  w.name,
  w.industry_profile,
  w.source_local_id,
  w.created_by,
  w.created_at,
  w.updated_at,
  case when jsonb_typeof(w.data -> 'accounts') = 'array'
       then jsonb_array_length(w.data -> 'accounts') else 0 end as account_count,
  case when jsonb_typeof(w.data -> 'values') = 'array'
       then jsonb_array_length(w.data -> 'values') else 0 end as value_count,
  (w.data ? 'accounts') as has_data
from public.workspaces w;

comment on view public.workspaces_metadata is
  'PII-safe projection of workspaces (NO data column). security_invoker => RLS-scoped for authenticated; the Phase-5 super-admin console queries this (via service_role) instead of public.workspaces so it never touches financial PII.';

revoke all on public.workspaces_metadata from anon;
grant select on public.workspaces_metadata to authenticated, service_role;
