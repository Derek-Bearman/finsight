-- ============================================================================
-- Optimistic concurrency for workspace saves (audit fix 3a-1).
--
-- Two teammates editing the same client used to silently clobber each other:
-- updateWorkspace was an unconditional last-write-wins over the whole `data`
-- jsonb blob. This adds an integer `version` that the DB itself increments on
-- every UPDATE (client-supplied values are overwritten by the trigger, so the
-- counter cannot be forged or skipped). The app guards its UPDATE with
-- `.eq('version', <version it hydrated>)` and treats zero rows as a conflict.
--
-- Idempotent + additive: safe to run against the live DB while old app code
-- (which ignores `version`) is still deployed.
-- ============================================================================

alter table public.workspaces
  add column if not exists version integer not null default 1;

create or replace function public.bump_workspace_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

drop trigger if exists workspaces_bump_version on public.workspaces;
create trigger workspaces_bump_version before update on public.workspaces
  for each row execute function public.bump_workspace_version();

comment on column public.workspaces.version is
  'Optimistic-concurrency counter. Incremented by trigger on every UPDATE; app updates must guard on the version they read and surface a conflict when 0 rows match.';
