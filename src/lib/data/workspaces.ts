/**
 * Workspace persistence (Phase 2b) — the localStorage ClientWorkspace moves
 * into Postgres. All reads/writes go through the request-scoped, RLS-enforced
 * server client, so a caller only ever touches their own firm's workspaces
 * (the firm boundary is proven in the Phase-2a isolation tests). firm_id is
 * pinned immutable by a DB trigger, so a workspace can never be moved across
 * firms via an update.
 *
 * Storage shape: the full ClientWorkspace JSON lives in `data`; `name` and
 * `industry_profile` are denormalized columns so lists/metadata don't parse the
 * blob. `source_local_id` records the original "ws-..." localStorage id so a
 * re-import is idempotent (partial unique index on (firm_id, source_local_id)).
 */

// Server-only by construction (imports next/headers via ./server).
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ClientWorkspace } from '@/types';
import type { Tables, Json } from '@/lib/supabase/database.types';

type WorkspaceRow = Tables<'workspaces'>;

function rowToWorkspace(row: WorkspaceRow): ClientWorkspace {
  const data = (row.data ?? {}) as Partial<ClientWorkspace>;
  return {
    // Full workspace body from the jsonb blob, with the DB-authoritative
    // identity/labels layered on top.
    accounts: [],
    values: [],
    scenarios: [],
    operationalData: [],
    customMetrics: [],
    auditLog: [],
    fiscalYearStart: 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...data,
    id: row.id,
    name: row.name,
    industryProfileId: row.industry_profile,
    // Always the column value — the copy inside the blob is stale by one save.
    cloudVersion: row.version,
  };
}

/** List the current firm's workspaces (RLS-scoped). */
export async function listWorkspaces(): Promise<ClientWorkspace[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToWorkspace);
}

export async function getWorkspace(id: string): Promise<ClientWorkspace | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('workspaces').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToWorkspace(data) : null;
}

/** Create a workspace in the given firm. Returns the stored ClientWorkspace
 *  with its DB-assigned uuid id. `sourceLocalId` links an imported localStorage
 *  workspace for idempotency. */
export async function createWorkspace(
  firmId: string,
  userId: string,
  ws: ClientWorkspace,
  sourceLocalId?: string
): Promise<ClientWorkspace> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('workspaces')
    .insert({
      firm_id: firmId,
      name: ws.name,
      industry_profile: ws.industryProfileId,
      data: ws as unknown as Json,
      created_by: userId,
      source_local_id: sourceLocalId ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToWorkspace(data);
}

export type UpdateWorkspaceResult =
  | { ok: true; workspace: ClientWorkspace }
  | { ok: false; reason: 'conflict' };

/** Overwrite an existing workspace (by its DB uuid). firm_id/created_by are
 *  ignored by the DB trigger even if present, so tenant + authorship are safe.
 *
 *  Optimistic concurrency: the UPDATE is guarded on the version the caller
 *  hydrated (`cloudVersion`); the DB trigger increments `version` on every
 *  write. Zero matched rows = a teammate saved first (or deleted the
 *  workspace) — reported as a conflict, never silently overwritten. */
export async function updateWorkspace(ws: ClientWorkspace): Promise<UpdateWorkspaceResult> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from('workspaces')
    .update({
      name: ws.name,
      industry_profile: ws.industryProfileId,
      data: ws as unknown as Json,
    })
    .eq('id', ws.id);
  // Legacy sessions hydrated before the version column shipped save
  // unconditionally (pre-fix behavior) until their next full hydrate.
  if (typeof ws.cloudVersion === 'number') {
    query = query.eq('version', ws.cloudVersion);
  }
  const { data, error } = await query.select('*').maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, reason: 'conflict' };
  return { ok: true, workspace: rowToWorkspace(data) };
}

export async function deleteWorkspace(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('workspaces').delete().eq('id', id);
  if (error) throw error;
}

export interface ImportItem {
  localId: string;
  workspace: ClientWorkspace;
}
export interface ImportResult {
  imported: number;
  skipped: number;
}

/** Import selected localStorage workspaces into the firm. Idempotent: a
 *  workspace whose source_local_id already exists for this firm is skipped
 *  (the partial unique index enforces it; we pre-filter to report counts). */
export async function importLocalWorkspaces(
  firmId: string,
  userId: string,
  items: ImportItem[]
): Promise<ImportResult> {
  if (items.length === 0) return { imported: 0, skipped: 0 };
  const supabase = await createSupabaseServerClient();

  const { data: existing, error: exErr } = await supabase
    .from('workspaces')
    .select('source_local_id')
    .not('source_local_id', 'is', null);
  if (exErr) throw exErr;
  const already = new Set((existing ?? []).map((r) => r.source_local_id));

  const rows = items
    .filter((it) => !already.has(it.localId))
    .map((it) => ({
      firm_id: firmId,
      name: it.workspace.name,
      industry_profile: it.workspace.industryProfileId,
      data: it.workspace as unknown as Json,
      created_by: userId,
      source_local_id: it.localId,
    }));

  if (rows.length > 0) {
    const { error } = await supabase.from('workspaces').insert(rows);
    if (error) throw error;
  }
  return { imported: rows.length, skipped: items.length - rows.length };
}
