'use server';

/**
 * Corporate-line comparison action (SCOA_ROLLUP_PLAN.md, Phase 2).
 *
 * For each corporate SCOA line, rolls THIS franchisee's accounts up by
 * scoaNumber and compares its trailing-12 total + % of revenue against the
 * median of the other linked franchisees. Runs SERVER-side (peers'
 * whole-workspace jsonb blobs never reach the browser — only names/numbers
 * leave). Read-only; RLS scopes the query to the caller's firm.
 *
 * NOTE (Next 16 house gotcha): only async function exports in this module.
 * ScoaComparisonLine lives in lib/franchise/scoa-rollup.
 */

import { resolveUserContext } from '@/lib/data/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getFranchise } from '@/lib/data/franchises';
import { scoaLineSnapshot, buildScoaComparisonLines, type ScoaComparisonLine } from '@/lib/franchise/scoa-rollup';
import { getTrailingPeriods } from '@/lib/calculations/period-aggregation';
import type { Account, AccountValue, ClientWorkspace } from '@/types';

type ScoaComparisonResult =
  | {
      ok: true;
      franchiseName: string;
      /** Corporate SCOA uploaded? If false, `lines` is empty. */
      hasScoa: boolean;
      /** Number of OTHER franchisees compared against. */
      peerCount: number;
      lines: ScoaComparisonLine[];
    }
  | { ok: false; error: string };

export async function getFranchiseScoaComparisonAction(params: {
  franchiseId: string;
  workspaceId: string;
}): Promise<ScoaComparisonResult> {
  try {
    const ctx = await resolveUserContext();
    if (ctx.state !== 'active') return { ok: false, error: 'Not signed in.' };

    const franchise = await getFranchise(params.franchiseId);
    if (!franchise) return { ok: false, error: 'Franchise not found.' };

    const scoa = franchise.config.scoa;
    if (!scoa || scoa.accounts.length === 0) {
      return { ok: true, franchiseName: franchise.name, hasScoa: false, peerCount: 0, lines: [] };
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('workspaces')
      .select('id, name, data')
      .eq('data->>franchiseId', params.franchiseId);
    if (error) return { ok: false, error: `Failed to load franchisees: ${error.message}` };

    // One line-snapshot per workspace, each over its OWN trailing 12 months.
    let thisSnap: ReturnType<typeof scoaLineSnapshot> | null = null;
    const peerSnaps: Array<ReturnType<typeof scoaLineSnapshot>> = [];
    for (const row of data ?? []) {
      const blob = (row.data ?? {}) as Partial<ClientWorkspace>;
      const accounts = (blob.accounts ?? []) as Account[];
      const values = (blob.values ?? []) as AccountValue[];
      const snap = scoaLineSnapshot(scoa.accounts, accounts, values, getTrailingPeriods(values, 12));
      if (row.id === params.workspaceId) thisSnap = snap;
      else peerSnaps.push(snap);
    }

    const lines = buildScoaComparisonLines(scoa.accounts, thisSnap, peerSnaps);

    return { ok: true, franchiseName: franchise.name, hasScoa: true, peerCount: peerSnaps.length, lines };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to load the corporate-line comparison.',
    };
  }
}
