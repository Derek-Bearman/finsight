-- ============================================================================
-- workspaces_metadata is a read-only metadata projection for the super-admin
-- console. Supabase default privileges auto-granted ALL DML to `authenticated`
-- when the view was created (20260703173132 only revoked anon). The view is
-- security_invoker, so writes through it were merely equivalent to already-
-- permitted RLS-scoped base-table writes — but a metadata view should not be
-- writable at all (defense in depth). Strip everything but SELECT.
-- ============================================================================

revoke all on public.workspaces_metadata from authenticated;
grant select on public.workspaces_metadata to authenticated;
