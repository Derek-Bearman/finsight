'use server';

/**
 * Co-franchisee peer comparison action (FRANCHISE_BENCHMARKS_PLAN.md §F3).
 *
 * Computes each sibling franchisee's comparable metrics SERVER-side so the
 * whole-workspace jsonb blobs never ship to the browser — the client gets
 * only names + computed numbers. Read-only: no version-guard or write-race
 * concerns. RLS scopes the workspace query to the caller's firm; any active
 * member may view (same visibility as the firm's client list).
 *
 * NOTE (Next 16 house gotcha): only async function exports in this module.
 * PeerSnapshot lives in lib/franchise/peer-metrics.
 */

import { resolveUserContext } from '@/lib/data/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getFranchise } from '@/lib/data/franchises';
import { computePeerSnapshot, type PeerSnapshot } from '@/lib/franchise/peer-metrics';
import type { Account, AccountValue, ClientWorkspace } from '@/types';

type PeersResult =
  | {
      ok: true;
      franchiseName: string;
      peers: PeerSnapshot[];
    }
  | { ok: false; error: string };

export async function getFranchisePeersAction(params: { franchiseId: string }): Promise<PeersResult> {
  try {
    const ctx = await resolveUserContext();
    if (ctx.state !== 'active') return { ok: false, error: 'Not signed in.' };

    // RLS-scoped: resolves only within the caller's firm.
    const franchise = await getFranchise(params.franchiseId);
    if (!franchise) return { ok: false, error: 'Franchise not found.' };

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('workspaces')
      .select('id, name, data')
      .eq('data->>franchiseId', params.franchiseId);
    if (error) return { ok: false, error: `Failed to load franchisees: ${error.message}` };

    const peers = (data ?? [])
      .map((row) => {
        const blob = (row.data ?? {}) as Partial<ClientWorkspace>;
        const ws: ClientWorkspace = {
          // Minimal shape the snapshot math needs; everything else defaulted.
          id: row.id,
          name: row.name,
          industryProfileId: blob.industryProfileId ?? 'generic-smb',
          accounts: (blob.accounts ?? []) as Account[],
          values: (blob.values ?? []) as AccountValue[],
          datasets: undefined,
          activeDatasetId: undefined,
          fiscalYearStart: blob.fiscalYearStart ?? 1,
          scenarios: [],
          operationalData: [],
          customMetrics: [],
          auditLog: [],
          createdAt: blob.createdAt ?? '',
          updatedAt: blob.updatedAt ?? '',
        };
        return computePeerSnapshot(ws);
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { ok: true, franchiseName: franchise.name, peers };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to load franchise peers.' };
  }
}
