/**
 * Franchise persistence (FRANCHISE_BENCHMARKS_PLAN.md) — firm-level franchise
 * entities carrying franchise-wide data: versioned corporate benchmark sets
 * and the corporate SCOA. Client workspaces link via workspace.data.franchiseId
 * (jsonb-only), so linking/unlinking rides the existing workspace save path.
 *
 * All reads/writes go through the request-scoped, RLS-enforced server client:
 * SELECT is firm-member scoped, writes are owner/admin-only AT THE DATABASE
 * (franchises_insert/update/delete policies), and firm_id/created_by are
 * pinned immutable by trigger — proven by the 10-point impersonation suite run
 * on 2026-07-23 before any of this UI existed.
 */

// Server-only by construction (imports next/headers via ./server).
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Tables, Json } from '@/lib/supabase/database.types';
import type { FranchiseConfig } from '@/types';

type FranchiseRow = Tables<'franchises'>;

// Config shapes (FranchiseConfig / FranchiseBenchmarkSet / FranchiseScoa …)
// live in @/types so CLIENT code can import them without pulling in this
// server-only module. Re-exported here for server-side convenience.
export type {
  FranchiseBenchmarkMetric,
  FranchiseBenchmarkSet,
  FranchiseScoaAccount,
  FranchiseScoa,
  FranchiseConfig,
} from '@/types';

/** Serializable franchise snapshot the client UI consumes. */
export interface Franchise {
  id: string;
  firmId: string;
  name: string;
  industryProfileId: string | null;
  config: FranchiseConfig;
  createdAt: string;
  updatedAt: string;
}

function rowToFranchise(row: FranchiseRow): Franchise {
  return {
    id: row.id,
    firmId: row.firm_id,
    name: row.name,
    industryProfileId: row.industry_profile_id,
    config: (row.config ?? {}) as FranchiseConfig,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─────────────────────────────────────────────
// CRUD (RLS-enforced; role gates also re-checked in franchise-actions)
// ─────────────────────────────────────────────

export async function listFranchises(): Promise<Franchise[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('franchises')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw new Error(`Failed to load franchises: ${error.message}`);
  return (data ?? []).map(rowToFranchise);
}

export async function getFranchise(id: string): Promise<Franchise | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('franchises')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load franchise: ${error.message}`);
  return data ? rowToFranchise(data) : null;
}

export async function insertFranchise(params: {
  firmId: string;
  name: string;
  industryProfileId?: string | null;
}): Promise<Franchise> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('franchises')
    .insert({
      firm_id: params.firmId,
      name: params.name.trim(),
      industry_profile_id: params.industryProfileId ?? null,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new Error('A franchise with that name already exists in your firm.');
    }
    throw new Error(`Failed to create franchise: ${error.message}`);
  }
  return rowToFranchise(data);
}

/**
 * Optimistic concurrency: pass `expectedUpdatedAt` (the updated_at from the
 * read that produced the patch) to make the UPDATE match only if the row is
 * unchanged. updated_at is trigger-maintained (set_updated_at), so every
 * successful write bumps it — a null return with the row still readable means
 * someone else wrote in between (conflict), not an RLS denial.
 */
export async function updateFranchiseRow(
  id: string,
  patch: { name?: string; industryProfileId?: string | null; config?: FranchiseConfig },
  expectedUpdatedAt?: string
): Promise<Franchise | null> {
  const supabase = await createSupabaseServerClient();
  const update: {
    name?: string;
    industry_profile_id?: string | null;
    config?: Json;
  } = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.industryProfileId !== undefined) update.industry_profile_id = patch.industryProfileId;
  if (patch.config !== undefined) update.config = patch.config as unknown as Json;
  let query = supabase.from('franchises').update(update).eq('id', id);
  if (expectedUpdatedAt !== undefined) query = query.eq('updated_at', expectedUpdatedAt);
  const { data, error } = await query.select('*').maybeSingle();
  if (error) {
    if (error.code === '23505') {
      throw new Error('A franchise with that name already exists in your firm.');
    }
    throw new Error(`Failed to update franchise: ${error.message}`);
  }
  // null = RLS filtered it out (not this firm, or caller lacks owner/admin),
  // or the expectedUpdatedAt guard missed (concurrent write).
  return data ? rowToFranchise(data) : null;
}

export async function deleteFranchiseRow(id: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('franchises')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`Failed to delete franchise: ${error.message}`);
  return Boolean(data);
}

/**
 * Count firm workspaces linked to each franchise (franchiseId lives inside the
 * workspace jsonb). RLS scopes the rows to the caller's firm automatically.
 * Returns a map franchiseId -> linked workspace count.
 */
export async function countLinkedWorkspaces(): Promise<Record<string, number>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('workspaces')
    .select('data->>franchiseId');
  if (error) throw new Error(`Failed to count franchise links: ${error.message}`);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<Record<string, string | null>>) {
    const fid = row.franchiseId;
    if (fid) counts[fid] = (counts[fid] ?? 0) + 1;
  }
  return counts;
}
