/**
 * Co-franchisee peer snapshot (FRANCHISE_BENCHMARKS_PLAN.md §F3).
 *
 * One franchisee workspace → the comparable numbers the franchise comparison
 * table renders: the 7 registry ratios at the workspace's latest computable
 * period, plus trailing-12 revenue and net income. Pure — runs server-side in
 * the peers action (whole-workspace blobs stay off the wire) and is unit-
 * checked in benchmarks.check.ts's sibling suite.
 *
 * Ratio semantics match the workspace Reports tab exactly: monthly series
 * from the same calculation modules, latest entry wins (BS ratios are
 * month-end stocks; margin ratios are that month's flows).
 */

import type { ClientWorkspace } from '@/types';
import type { RatioKey } from '@/lib/targets';
import { computePnL } from '@/lib/calculations/pnl';
import { getTrailingPeriods } from '@/lib/calculations/period-aggregation';
import { computeBalanceSheetSeries } from '@/lib/calculations/balance-sheet';
import { computeProfitabilitySeries } from '@/lib/calculations/profitability';
import { computeHealthSeries } from '@/lib/calculations/health';

export interface PeerSnapshot {
  workspaceId: string;
  name: string;
  /** Registry ratio values at the latest computable month (null = n/a). */
  ratios: Partial<Record<RatioKey, number | null>>;
  trailing12Revenue: number | null;
  trailing12NetIncome: number | null;
  /** Label of the newest month with any data, e.g. "Jun 2026". */
  latestPeriodLabel: string | null;
  /** Months of data available (comparison honesty signal). */
  monthCount: number;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function computePeerSnapshot(ws: ClientWorkspace): PeerSnapshot {
  const hasData = ws.accounts.length > 0 && ws.values.length > 0;

  const empty: PeerSnapshot = {
    workspaceId: ws.id,
    name: ws.name,
    ratios: {},
    trailing12Revenue: null,
    trailing12NetIncome: null,
    latestPeriodLabel: null,
    monthCount: 0,
  };
  if (!hasData) return empty;

  const bs = computeBalanceSheetSeries(ws.accounts, ws.values, 'monthly');
  const prof = computeProfitabilitySeries(ws.accounts, ws.values, 'monthly');
  const health = computeHealthSeries(ws.accounts, ws.values, 'monthly');
  const latestBS = bs.length ? bs[bs.length - 1] : null;
  const latestProf = prof.length ? prof[prof.length - 1] : null;
  const latestHealth = health.length ? health[health.length - 1] : null;

  const trailing = getTrailingPeriods(ws.values, 12);
  const t12 = trailing.length ? computePnL(ws.accounts, ws.values, trailing) : null;

  const latest = trailing.length ? trailing[trailing.length - 1] : null;
  // Margin ratios come from the latest month's P&L (same numbers the
  // Reports tab derives); zero-revenue months yield 0% margins from
  // computePnL, so guard them to null for honest comparison cells.
  const latestPnL = latest ? computePnL(ws.accounts, ws.values, latest) : null;
  const hasRevenue = (latestPnL?.revenue ?? 0) !== 0;
  const latestPeriodLabel = latest
    ? `${MONTH_NAMES[(latest.month ?? 1) - 1]} ${latest.year}`
    : null;

  return {
    workspaceId: ws.id,
    name: ws.name,
    ratios: {
      gross_margin: hasRevenue ? latestPnL!.grossMarginPct : null,
      net_margin: hasRevenue ? latestPnL!.netMarginPct : null,
      contribution_margin: hasRevenue ? latestPnL!.contributionMarginPct : null,
      current_ratio: latestBS?.currentRatio ?? null,
      debt_to_equity: latestBS?.debtToEquity ?? null,
      roe: latestProf?.roe ?? null,
      altman_z: latestHealth?.altmanZScore ?? null,
    },
    trailing12Revenue: t12 ? t12.revenue : null,
    trailing12NetIncome: t12 ? t12.netIncome : null,
    latestPeriodLabel,
    monthCount: new Set(ws.values.map((v) => `${v.period.year}-${v.period.month}`)).size,
  };
}

/** Median of the non-null values, or null. */
export function median(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
}
