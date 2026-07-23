'use client';

/**
 * useEffectiveTargets — the one hook every targets-consuming surface calls to
 * get the benchmarks a workspace ACTUALLY renders against
 * (FRANCHISE_BENCHMARKS_PLAN.md §F2).
 *
 * Composition (in lib/targets/composeEffectiveTargets):
 *   per-client target > franchise corporate set > industry pack (opt-in)
 * with everything absent falling through to FinSight defaults downstream.
 *
 * Franchise configs are fetched once per session via getFranchiseState() and
 * cached module-level (they are firm-scoped and small); pack resolution is
 * pure and derived from the workspace itself. For a workspace with no
 * franchise link and the industry toggle off, the returned targets are the
 * workspace's own targets object semantics, byte-for-byte — non-franchise
 * behavior must not change (regression-checked in benchmarks.check.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import type { ClientWorkspace, WorkspaceTargets } from '@/types';
import type { Franchise } from '@/lib/data/franchises';
import { getFranchiseState } from '@/lib/data/franchise-actions';
import {
  activeBenchmarkSet,
  composeEffectiveTargets,
} from '@/lib/targets';
import {
  resolvePack,
  type BenchmarkRegion,
  type PackResolution,
} from '@/lib/benchmarks/packs';
import { getProfile } from '@/lib/profiles';
import { computePnL } from '@/lib/calculations/pnl';
import { getTrailingPeriods } from '@/lib/calculations/period-aggregation';

// ─────────────────────────────────────────────
// Module-level franchise cache (per browser session)
// ─────────────────────────────────────────────

let franchiseCache: Franchise[] | null = null;
let franchiseFetch: Promise<Franchise[]> | null = null;
const subscribers = new Set<() => void>();

async function loadFranchises(): Promise<Franchise[]> {
  if (franchiseCache) return franchiseCache;
  if (!franchiseFetch) {
    franchiseFetch = getFranchiseState()
      .then((res) => {
        franchiseCache = res.ok ? res.franchises : [];
        subscribers.forEach((fn) => fn());
        return franchiseCache;
      })
      .catch(() => {
        franchiseFetch = null; // allow retry on next mount
        return franchiseCache ?? [];
      });
  }
  return franchiseFetch;
}

/** Invalidate after benchmark-set uploads/edits so open workspaces refresh. */
export function invalidateFranchiseCache(): void {
  franchiseCache = null;
  franchiseFetch = null;
  subscribers.forEach((fn) => fn());
}

// ─────────────────────────────────────────────
// Trailing-12 revenue (pack size-band input)
// ─────────────────────────────────────────────

function trailing12Revenue(ws: ClientWorkspace): number | null {
  if (!ws.values.length) return null;
  const periods = getTrailingPeriods(ws.values, 12);
  if (!periods.length) return null;
  return computePnL(ws.accounts, ws.values, periods).revenue;
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export interface EffectiveTargetsResult {
  /** Composed targets — pass anywhere workspace.targets used to go. */
  targets: WorkspaceTargets;
  /** Linked franchise (from the cached firm list), when any. */
  franchise: Franchise | null;
  /** Label of the active corporate set, when one applies. */
  corporateSetLabel: string | null;
  /** Pack resolution when the industry toggle is on (drives captions +
   *  the asterisk/disclaimer), else null. */
  pack: PackResolution | null;
  /** False until the franchise list has loaded once (surfaces can render
   *  with base targets meanwhile — never block on this). */
  loaded: boolean;
}

export function useEffectiveTargets(ws: ClientWorkspace | null | undefined): EffectiveTargetsResult {
  const [, bump] = useState(0);

  useEffect(() => {
    const rerender = () => bump((n) => n + 1);
    subscribers.add(rerender);
    // Kick the fetch only when it can matter: linked workspace or toggle on.
    if (ws && (ws.franchiseId || ws.industryBenchmarksEnabled)) void loadFranchises();
    return () => {
      subscribers.delete(rerender);
    };
  }, [ws, ws?.franchiseId, ws?.industryBenchmarksEnabled]);

  return useMemo<EffectiveTargetsResult>(() => {
    const base = ws?.targets;
    const empty: WorkspaceTargets = { ratios: {}, metrics: {} };
    if (!ws) {
      return { targets: base ?? empty, franchise: null, corporateSetLabel: null, pack: null, loaded: true };
    }

    const franchise = ws.franchiseId
      ? (franchiseCache ?? []).find((f) => f.id === ws.franchiseId) ?? null
      : null;
    const set = activeBenchmarkSet(franchise?.config ?? null);

    let pack: PackResolution | null = null;
    if (ws.industryBenchmarksEnabled) {
      const profile = getProfile(ws.industryProfileId);
      pack = resolvePack({
        profileId: ws.industryProfileId,
        profileLabel: profile?.name ?? ws.industryProfileId,
        trailing12Revenue: trailing12Revenue(ws),
        region: (ws.benchmarkRegion as BenchmarkRegion | undefined) ?? undefined,
      });
    }

    // Fast path: nothing franchise/pack-related — return base semantics
    // untouched so non-franchise workspaces are provably unchanged.
    if (!set && !pack) {
      return {
        targets: base ?? empty,
        franchise,
        corporateSetLabel: null,
        pack: null,
        loaded: franchiseCache !== null || !ws.franchiseId,
      };
    }

    return {
      targets: composeEffectiveTargets(
        base,
        set ? { setLabel: set.label, metrics: set.metrics } : null,
        pack?.ratios ?? null
      ),
      franchise,
      corporateSetLabel: set?.label ?? null,
      pack,
      loaded: franchiseCache !== null,
    };
  }, [ws, ws?.targets, ws?.franchiseId, ws?.industryBenchmarksEnabled, ws?.benchmarkRegion, franchiseCache]);
}
