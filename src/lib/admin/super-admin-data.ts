/**
 * Super-admin metadata console data layer (Phase 5). SERVER-ONLY.
 *
 * Every export is gated by requireSuperAdmin() — it verifies the CURRENT
 * signed-in user's email is on the SUPER_ADMIN_EMAILS allowlist before using
 * the service-role client. By construction this module queries ONLY firms,
 * membership counts, and the PII-safe `workspaces_metadata` view; it NEVER
 * selects public.workspaces (the `data` financial-PII blob). Keep it that way.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isSuperAdmin } from '@/lib/auth/super-admin';

/** Throws unless the current request's user is an allowlisted super-admin.
 *  Returns a service-role client for metadata-only queries. */
async function requireSuperAdmin() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isSuperAdmin(user.email)) {
    throw new Error('Not authorized: super-admin only.');
  }
  return createSupabaseServiceClient();
}

export interface AdminFirmSummary {
  id: string;
  name: string;
  planStatus: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  createdAt: string;
  memberCount: number;
  workspaceCount: number;
}

/** All firms with member + workspace counts. No financial PII. */
export async function listAllFirms(): Promise<AdminFirmSummary[]> {
  const service = await requireSuperAdmin();

  const { data: firms, error } = await service
    .from('firms')
    .select('id, name, plan_status, trial_ends_at, current_period_end, grace_ends_at, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;

  // Counts, resolved from metadata-safe tables/views only.
  const [{ data: members }, { data: meta }] = await Promise.all([
    service.from('memberships').select('firm_id').eq('status', 'active'),
    service.from('workspaces_metadata').select('firm_id'),
  ]);

  const memberBy = new Map<string, number>();
  for (const m of members ?? []) memberBy.set(m.firm_id, (memberBy.get(m.firm_id) ?? 0) + 1);
  const wsBy = new Map<string, number>();
  for (const w of meta ?? []) if (w.firm_id) wsBy.set(w.firm_id, (wsBy.get(w.firm_id) ?? 0) + 1);

  return (firms ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    planStatus: f.plan_status,
    trialEndsAt: f.trial_ends_at,
    currentPeriodEnd: f.current_period_end,
    graceEndsAt: f.grace_ends_at,
    createdAt: f.created_at,
    memberCount: memberBy.get(f.id) ?? 0,
    workspaceCount: wsBy.get(f.id) ?? 0,
  }));
}

export interface AdminWorkspaceMeta {
  id: string;
  name: string;
  industryProfile: string;
  accountCount: number;
  valueCount: number;
  updatedAt: string;
}

/** A firm's workspace METADATA (names + counts, never the data blob). */
export async function listFirmWorkspaceMetadata(firmId: string): Promise<AdminWorkspaceMeta[]> {
  const service = await requireSuperAdmin();
  const { data, error } = await service
    .from('workspaces_metadata')
    .select('id, name, industry_profile, account_count, value_count, updated_at')
    .eq('firm_id', firmId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((w) => ({
    id: w.id ?? '',
    name: w.name ?? '',
    industryProfile: w.industry_profile ?? '',
    accountCount: w.account_count ?? 0,
    valueCount: w.value_count ?? 0,
    updatedAt: w.updated_at ?? '',
  }));
}
