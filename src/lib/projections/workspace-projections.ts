/**
 * Build projections for an entire workspace — per account and rolled up to P&L totals.
 */

import type { Account, AccountValue, AccountProjection, ProjectionPoint, Period, ProjectionModel } from '@/types';
import { project } from './models';
import { getUniquePeriods } from '@/lib/calculations/period-aggregation';
import { addMonths } from '@/lib/utils/period';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface WorkspaceProjectionOptions {
  /** Projection model to use. If not set, falls back to profileDefaultModel then 'linear'. */
  model?: ProjectionModel;
  horizonMonths: number; // e.g. 12, 36, 60, 120
  growthRateOverride?: number;
  /**
   * BASELINE (unadjusted) history, used ONLY as the driver-mode cost/revenue
   * ratio denominator (trailing revenue). Pass this when `values` is a What-If
   * scenario-adjusted set: otherwise the projected driver AND the ratio
   * denominator both scale with a revenue scenario and cancel, leaving variable
   * costs flat. Defaults to `values` (no scenario → identical behavior).
   */
  baselineValues?: AccountValue[];
}

export interface WorkspaceProjectionResult {
  accountProjections: AccountProjection[];

  /** Rolled-up monthly series: historical + projected P&L totals */
  rolledUp: {
    period: Period;
    revenue: number;
    cogs: number;
    grossProfit: number;
    operatingExpenses: number;
    netIncome: number;
    revenueProjected: ProjectionPoint | null; // null for historical
    netIncomeProjected: ProjectionPoint | null;
    isProjected: boolean;
  }[];

  /** Annual summaries for long-horizon view */
  annualSummary: {
    year: number;
    revenue: number;
    netIncome: number;
    isProjected: boolean;
    revenuePoint?: ProjectionPoint;
  }[];

  options: WorkspaceProjectionOptions;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function periodToKey(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

function comparePeriods(a: Period, b: Period): number {
  return a.year * 100 + a.month - (b.year * 100 + b.month);
}

/**
 * Pad an account's (ascending) history with trailing $0 months up to `lastGlobal`
 * so EVERY account's projection anchors to the same last period and its projected
 * points align to the shared projected grid. Without this, an account that stops
 * reporting before the dataset end projects on its OWN earlier anchor and
 * mis-aligns in the roll-up (its tail projected months miss entirely → a spurious
 * drop-off). A blank P&L month is $0 activity, so trailing zeros are the correct fill.
 */
function densifyHistory(
  history: { period: Period; amount: number }[],
  lastGlobal: Period | undefined
): { period: Period; amount: number }[] {
  if (!lastGlobal || history.length === 0) return history;
  const last = history[history.length - 1]!.period;
  if (comparePeriods(last, lastGlobal) >= 0) return history;
  const padded = history.slice();
  let p = addMonths(last, 1);
  while (comparePeriods(p, lastGlobal) <= 0) {
    padded.push({ period: p, amount: 0 });
    p = addMonths(p, 1);
  }
  return padded;
}

// ─────────────────────────────────────────────
// projectWorkspace
// ─────────────────────────────────────────────

/**
 * Project every account individually, then roll up to P&L totals.
 * Historical months use actual values. Projected months use model output.
 */
export function projectWorkspace(
  accounts: Account[],
  values: AccountValue[],
  options: WorkspaceProjectionOptions,
  profileDefaultModel?: ProjectionModel
): WorkspaceProjectionResult {
  // Model selection: options.model → profileDefaultModel → 'linear'
  const model: ProjectionModel = options.model ?? profileDefaultModel ?? 'linear';
  const { horizonMonths, growthRateOverride } = options;

  // Excluded accounts (QBO summary rows, manual exclusions) are never
  // projected nor rolled up — their values would double-count every total.
  accounts = accounts.filter((a) => !a.isExcluded);

  // ── Per-account projections ──────────────────────────────────────────────────

  const accountProjections: AccountProjection[] = [];

  // Map of accountId → projected points
  const projectedByAccount = new Map<string, ProjectionPoint[]>();

  // Historical periods
  const historicalPeriods = getUniquePeriods(values).sort(comparePeriods);
  const lastHistoricalPeriod = historicalPeriods[historicalPeriods.length - 1];

  if (model === 'driver') {
    // ── Driver (cost-behavior-aware) path ──────────────────────────────────────
    // Growth drives total revenue; costs scale by their cost behavior. This
    // populates the SAME accountProjections + projectedByAccount structures the
    // per-account path fills, so the rollup/aggregation code below is shared and
    // unchanged. The linear/seasonal/yoy branch is left byte-identical.
    const driven = projectDriverAccounts({
      accounts,
      values,
      baselineValues: options.baselineValues ?? values,
      historicalPeriods,
      lastHistoricalPeriod,
      horizonMonths,
      growthRateOverride,
    });
    for (const ap of driven.accountProjections) accountProjections.push(ap);
    for (const [accountId, pts] of driven.projectedByAccount) projectedByAccount.set(accountId, pts);
  } else {
    for (const account of accounts) {
      // Get this account's historical values
      const acctValues = values
        .filter((v) => v.accountId === account.id)
        .sort((a, b) => comparePeriods(a.period, b.period));

      if (acctValues.length < 3) {
        // Not enough history — carry forward last known value
        const lastVal = acctValues[acctValues.length - 1];
        if (!lastVal || !lastHistoricalPeriod) continue;

        const pts: ProjectionPoint[] = [];
        for (let i = 1; i <= horizonMonths; i++) {
          const p = addMonths(lastHistoricalPeriod, i);
          pts.push({ period: p, value: lastVal.amount, lower80: lastVal.amount, upper80: lastVal.amount, isProjected: true });
        }
        accountProjections.push({ accountId: account.id, model, points: pts });
        projectedByAccount.set(account.id, pts);
        continue;
      }

      // Dense grid: pad trailing $0 up to the global last period so this
      // account's projection aligns with the shared projected grid in the roll-up.
      const history = densifyHistory(
        acctValues.map((v) => ({ period: v.period, amount: v.amount })),
        lastHistoricalPeriod
      );

      let result = project({ history, horizonMonths, model, growthRateOverride });

      // Sanity check: if the first projected month is more than 80% below the
      // average of the last 3 actual months, the model has gone badly wrong
      // (typically from extreme seasonal indices or a regression dominated by
      // old weak data). Fall back to linear in that case.
      if (result.model !== 'linear' && result.projected.length > 0 && history.length >= 3) {
        const lastThree = history.slice(-3);
        const last3Avg = lastThree.reduce((s, h) => s + h.amount, 0) / lastThree.length;
        const firstProjected = result.projected[0]!.value;
        if (last3Avg > 0 && firstProjected < last3Avg * 0.2) {
          // First projection is >80% below recent average — fall back to linear
          result = project({ history, horizonMonths, model: 'linear', growthRateOverride });
        }
      }

      accountProjections.push({ accountId: account.id, model: result.model, points: result.projected });
      projectedByAccount.set(account.id, result.projected);
    }
  }

  // ── Build lookup for projected values by accountId + periodKey ────────────────

  const projLookup = new Map<string, ProjectionPoint>();
  for (const [accountId, pts] of projectedByAccount) {
    for (const pt of pts) {
      projLookup.set(`${accountId}::${periodToKey(pt.period)}`, pt);
    }
  }

  // ── Determine projected periods ───────────────────────────────────────────────

  const projectedPeriods: Period[] = [];
  if (lastHistoricalPeriod) {
    for (let i = 1; i <= horizonMonths; i++) {
      projectedPeriods.push(addMonths(lastHistoricalPeriod, i));
    }
  }

  // ── Historical values by period ────────────────────────────────────────────────

  // Build a lookup: periodKey → { revenue, cogs, operatingExpenses }
  const historicalByPeriod = new Map<
    string,
    { period: Period; revenue: number; cogs: number; operatingExpenses: number }
  >();

  for (const v of values) {
    const key = periodToKey(v.period);
    if (!historicalByPeriod.has(key)) {
      historicalByPeriod.set(key, { period: v.period, revenue: 0, cogs: 0, operatingExpenses: 0 });
    }
    const row = historicalByPeriod.get(key)!;
    const acct = accounts.find((a) => a.id === v.accountId);
    if (!acct) continue;
    if (acct.type === 'revenue') row.revenue += v.amount;
    else if (acct.type === 'cogs') row.cogs += v.amount;
    else if (acct.type === 'expense') row.operatingExpenses += v.amount;
  }

  // ── Classify accounts ──────────────────────────────────────────────────────────

  const revenueAccountIds = new Set(accounts.filter((a) => a.type === 'revenue').map((a) => a.id));
  const cogsAccountIds = new Set(accounts.filter((a) => a.type === 'cogs').map((a) => a.id));
  const expenseAccountIds = new Set(accounts.filter((a) => a.type === 'expense').map((a) => a.id));

  // ── rolledUp ──────────────────────────────────────────────────────────────────

  const rolledUp: WorkspaceProjectionResult['rolledUp'] = [];

  // Historical periods
  for (const p of historicalPeriods) {
    const key = periodToKey(p);
    const row = historicalByPeriod.get(key) ?? { period: p, revenue: 0, cogs: 0, operatingExpenses: 0 };
    const grossProfit = row.revenue - row.cogs;
    const netIncome = grossProfit - row.operatingExpenses;
    rolledUp.push({
      period: p,
      revenue: row.revenue,
      cogs: row.cogs,
      grossProfit,
      operatingExpenses: row.operatingExpenses,
      netIncome,
      revenueProjected: null,
      netIncomeProjected: null,
      isProjected: false,
    });
  }

  // Projected periods
  for (const p of projectedPeriods) {
    const pKey = periodToKey(p);

    let revenue = 0;
    let revLower80 = 0;
    let revUpper80 = 0;
    let cogs = 0;
    let operatingExpenses = 0;

    for (const account of accounts) {
      const pt = projLookup.get(`${account.id}::${pKey}`);
      if (!pt) continue;
      if (revenueAccountIds.has(account.id)) {
        revenue += pt.value;
        revLower80 += pt.lower80;
        revUpper80 += pt.upper80;
      } else if (cogsAccountIds.has(account.id)) {
        cogs += pt.value;
      } else if (expenseAccountIds.has(account.id)) {
        operatingExpenses += pt.value;
      }
    }

    const grossProfit = revenue - cogs;
    const netIncome = grossProfit - operatingExpenses;

    const revenueProjected: ProjectionPoint = {
      period: p,
      value: revenue,
      lower80: revLower80,
      upper80: revUpper80,
      isProjected: true,
    };

    rolledUp.push({
      period: p,
      revenue,
      cogs,
      grossProfit,
      operatingExpenses,
      netIncome,
      revenueProjected,
      netIncomeProjected: {
        period: p,
        value: netIncome,
        lower80: netIncome - (revUpper80 - revLower80) / 2,
        upper80: netIncome + (revUpper80 - revLower80) / 2,
        isProjected: true,
      },
      isProjected: true,
    });
  }

  rolledUp.sort((a, b) => comparePeriods(a.period, b.period));

  // ── annualSummary ─────────────────────────────────────────────────────────────

  const annualMap = new Map<
    number,
    {
      year: number;
      revenue: number;
      netIncome: number;
      isProjected: boolean;
      revenuePoint?: ProjectionPoint;
    }
  >();

  for (const row of rolledUp) {
    const yr = row.period.year;
    if (!annualMap.has(yr)) {
      annualMap.set(yr, {
        year: yr,
        revenue: 0,
        netIncome: 0,
        isProjected: row.isProjected,
        revenuePoint: undefined,
      });
    }
    const entry = annualMap.get(yr)!;
    entry.revenue += row.revenue;
    entry.netIncome += row.netIncome;
    // Mark as projected if any month in this year is projected
    if (row.isProjected) entry.isProjected = true;
  }

  // Build annual revenuePoint for projected years
  for (const [yr, entry] of annualMap) {
    if (entry.isProjected) {
      // A partial transition year mixes ACTUAL months (no uncertainty) with
      // projected months. entry.revenue (value) spans all 12; the band must
      // span the same months, so add the certain actual portion to BOTH bounds —
      // otherwise value (full year) exceeds upper80 (projected months only) and
      // the point plots above its own confidence band.
      const yearRows = rolledUp.filter((r) => r.period.year === yr);
      const actualPortion = yearRows
        .filter((r) => r.revenueProjected === null)
        .reduce((s, r) => s + r.revenue, 0);
      const revLow = actualPortion + yearRows.reduce((s, r) => s + (r.revenueProjected?.lower80 ?? 0), 0);
      const revHigh = actualPortion + yearRows.reduce((s, r) => s + (r.revenueProjected?.upper80 ?? 0), 0);
      entry.revenuePoint = {
        period: { year: yr, month: 1 },
        value: entry.revenue,
        lower80: revLow,
        upper80: revHigh,
        isProjected: true,
      };
    }
  }

  const annualSummary = Array.from(annualMap.values()).sort((a, b) => a.year - b.year);

  return {
    accountProjections,
    rolledUp,
    annualSummary,
    options: { ...options, model },
  };
}

// ─────────────────────────────────────────────
// Driver projection (cost-behavior-aware)
// ─────────────────────────────────────────────

interface DriverAccountsInput {
  /** Already filtered to !isExcluded by the caller. */
  accounts: Account[];
  values: AccountValue[];
  /** Baseline (unadjusted) history for the cost/revenue ratio denominator. */
  baselineValues: AccountValue[];
  /** Unique historical periods, sorted ascending. */
  historicalPeriods: Period[];
  lastHistoricalPeriod: Period | undefined;
  horizonMonths: number;
  growthRateOverride?: number;
}

/**
 * Cost-behavior-aware ("driver") projection of every account.
 *
 * The growth rate drives REVENUE; costs then follow their classified behavior:
 *   - variable      → projected[p] = (trailingAcct / trailingRev) * driver[p]
 *   - fixed         → projected[p] = trailingAvg                       (flat)
 *   - mixed(f)      → projected[p] = f*trailingAvg
 *                                    + ((1 - f) * trailingAcct / trailingRev) * driver[p]
 *   - unclassified  → projected[p] = trailingAvg                       (flat, safest)
 * where, over the trailing window W = min(12, #historical periods):
 *   trailingRev  = Σ total revenue over the last W periods
 *   trailingAcct = Σ this account over the last W periods
 *   trailingAvg  = trailingAcct / W
 *   driver[p]    = Σ projected revenue-account values at period p
 *   f            = account.mixedFixedPercent ?? 0.5
 *
 * Revenue accounts are projected with the linear model (honoring
 * growthRateOverride) so the revenue breakdown persists; the DRIVER used for
 * costs is the sum of those projected revenue accounts, keeping costs
 * consistent with the revenue shown. If trailingRev is 0 every cost is treated
 * as flat (trailingAvg) to avoid divide-by-zero. Balance-sheet accounts, and
 * any account with < 3 historical points, carry their last actual value forward
 * flat (matching the per-account path's fallback). Driver projections carry no
 * confidence band: lower80 = upper80 = value throughout.
 *
 * Returns the same accountProjections + projectedByAccount structures the
 * per-account path fills so the caller's rollup/aggregation code is shared.
 */
function projectDriverAccounts(input: DriverAccountsInput): {
  accountProjections: AccountProjection[];
  projectedByAccount: Map<string, ProjectionPoint[]>;
} {
  const { accounts, values, baselineValues, historicalPeriods, lastHistoricalPeriod, horizonMonths, growthRateOverride } = input;

  const accountProjections: AccountProjection[] = [];
  const projectedByAccount = new Map<string, ProjectionPoint[]>();

  // No anchor period → nothing to project (matches the per-account fallback).
  if (!lastHistoricalPeriod || historicalPeriods.length === 0) {
    return { accountProjections, projectedByAccount };
  }

  // Future periods — identical to the caller's projectedPeriods derivation.
  const futurePeriods: Period[] = [];
  for (let i = 1; i <= horizonMonths; i++) {
    futurePeriods.push(addMonths(lastHistoricalPeriod, i));
  }

  // Sorted history per account, computed once.
  const valuesByAccount = new Map<string, AccountValue[]>();
  for (const v of values) {
    if (!valuesByAccount.has(v.accountId)) valuesByAccount.set(v.accountId, []);
    valuesByAccount.get(v.accountId)!.push(v);
  }
  for (const list of valuesByAccount.values()) {
    list.sort((a, b) => comparePeriods(a.period, b.period));
  }

  // Flat carry-forward of an account's last actual value (no floor, no band —
  // mirrors the per-account path's < 3-points fallback).
  const carryForward = (accountId: string): ProjectionPoint[] => {
    const vals = valuesByAccount.get(accountId);
    const lastVal = vals && vals.length > 0 ? vals[vals.length - 1] : undefined;
    if (!lastVal) return [];
    return futurePeriods.map((p) => ({
      period: p,
      value: lastVal.amount,
      lower80: lastVal.amount,
      upper80: lastVal.amount,
      isProjected: true,
    }));
  };

  // ── Trailing window ──
  const W = Math.min(12, historicalPeriods.length);
  const windowKeys = new Set(historicalPeriods.slice(-W).map(periodToKey));

  const revenueAccountIds = new Set(accounts.filter((a) => a.type === 'revenue').map((a) => a.id));

  // Per-account trailing sums from the (possibly scenario-adjusted) values, so a
  // cost scenario flows into projected costs.
  const acctWindowSum = new Map<string, number>();
  for (const v of values) {
    if (!windowKeys.has(periodToKey(v.period))) continue;
    acctWindowSum.set(v.accountId, (acctWindowSum.get(v.accountId) ?? 0) + v.amount);
  }
  // Trailing revenue for the cost/revenue RATIO denominator comes from the
  // BASELINE history: under a What-If revenue scenario the projected driver
  // scales with revenue, and if this denominator scaled too they would cancel,
  // leaving variable costs flat. Defaults to `values` when no baseline supplied.
  let trailingRev = 0;
  for (const v of baselineValues) {
    if (!windowKeys.has(periodToKey(v.period))) continue;
    if (revenueAccountIds.has(v.accountId)) trailingRev += v.amount;
  }
  const hasRev = trailingRev > 0;

  // ── Pass 1: revenue accounts (these define the driver) ──
  for (const account of accounts) {
    if (account.type !== 'revenue') continue;
    const vals = valuesByAccount.get(account.id) ?? [];

    let pts: ProjectionPoint[];
    if (vals.length < 3) {
      pts = carryForward(account.id);
      if (pts.length === 0) continue;
    } else {
      const history = densifyHistory(
        vals.map((v) => ({ period: v.period, amount: v.amount })),
        lastHistoricalPeriod
      );
      const out = project({ history, horizonMonths, model: 'linear', growthRateOverride });
      // Linear already floors revenue at 0; strip its band for driver mode.
      pts = out.projected.map((pt) => ({
        period: pt.period,
        value: pt.value,
        lower80: pt.value,
        upper80: pt.value,
        isProjected: true,
      }));
    }
    accountProjections.push({ accountId: account.id, model: 'driver', points: pts });
    projectedByAccount.set(account.id, pts);
  }

  // Driver series: Σ projected revenue-account values at each future period.
  const driverByKey = new Map<string, number>();
  for (const p of futurePeriods) driverByKey.set(periodToKey(p), 0);
  for (const id of revenueAccountIds) {
    const pts = projectedByAccount.get(id);
    if (!pts) continue;
    for (const pt of pts) {
      const key = periodToKey(pt.period);
      driverByKey.set(key, (driverByKey.get(key) ?? 0) + pt.value);
    }
  }

  // ── Pass 2: cost + balance-sheet accounts ──
  for (const account of accounts) {
    if (account.type === 'revenue') continue;
    const vals = valuesByAccount.get(account.id) ?? [];

    // Balance-sheet accounts carry the last actual value forward flat.
    if (account.type === 'asset' || account.type === 'liability' || account.type === 'equity') {
      const pts = carryForward(account.id);
      if (pts.length === 0) continue;
      accountProjections.push({ accountId: account.id, model: 'driver', points: pts });
      projectedByAccount.set(account.id, pts);
      continue;
    }

    // Cost accounts (cogs | expense). Too little history → carry forward.
    if (vals.length < 3) {
      const pts = carryForward(account.id);
      if (pts.length === 0) continue;
      accountProjections.push({ accountId: account.id, model: 'driver', points: pts });
      projectedByAccount.set(account.id, pts);
      continue;
    }

    const trailingAcct = acctWindowSum.get(account.id) ?? 0;
    const trailingAvg = trailingAcct / W;
    const behavior = account.costBehavior ?? 'unclassified';

    const pts: ProjectionPoint[] = futurePeriods.map((p) => {
      const driver = driverByKey.get(periodToKey(p)) ?? 0;
      let value: number;
      if (!hasRev) {
        // No trailing revenue → treat every cost as flat (no divide-by-zero).
        value = trailingAvg;
      } else if (behavior === 'variable') {
        value = (trailingAcct / trailingRev) * driver;
      } else if (behavior === 'fixed') {
        value = trailingAvg;
      } else if (behavior === 'mixed') {
        const f = account.mixedFixedPercent ?? 0.5;
        value = f * trailingAvg + ((1 - f) * trailingAcct / trailingRev) * driver;
      } else {
        // 'unclassified' → flat (safest default).
        value = trailingAvg;
      }
      // Floor computed costs at 0 (as the linear model floors); keep finite.
      value = Math.max(0, value);
      if (!Number.isFinite(value)) value = 0;
      return { period: p, value, lower80: value, upper80: value, isProjected: true };
    });

    accountProjections.push({ accountId: account.id, model: 'driver', points: pts });
    projectedByAccount.set(account.id, pts);
  }

  return { accountProjections, projectedByAccount };
}
