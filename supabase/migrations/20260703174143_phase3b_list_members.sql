-- ============================================================================
-- FinSight — Phase 3b: list_firm_members RPC (team roster with emails)
-- ============================================================================
-- memberships RLS lets an active member see co-member rows, but emails live in
-- auth.users (not PostgREST-exposed). This SECURITY DEFINER function returns the
-- firm's active/invited roster WITH emails to any ACTIVE member of that firm —
-- so the team UI can render names without granting broad auth.users access or
-- routing member reads through service_role. Idempotent.
-- ============================================================================

create or replace function public.list_firm_members(p_firm_id uuid)
returns table (
  membership_id uuid,
  user_id       uuid,
  email         text,
  role          public.membership_role,
  status        public.membership_status,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.user_id, u.email::text, m.role, m.status, m.created_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.firm_id = p_firm_id
    and exists (
      select 1 from public.memberships me
      where me.firm_id = p_firm_id and me.user_id = (select auth.uid()) and me.status = 'active'
    )
  order by m.created_at asc;
$$;

comment on function public.list_firm_members(uuid) is
  'Returns a firm''s membership roster (incl. emails from auth.users) to any ACTIVE member of that firm. SECURITY DEFINER; re-checks caller membership.';

revoke all on function public.list_firm_members(uuid) from public, anon;
grant  execute on function public.list_firm_members(uuid) to authenticated, service_role;
