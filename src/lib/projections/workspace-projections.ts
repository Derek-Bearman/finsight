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

    const history = acctValues.map((v) => ({ period: v.period, amount: v.amount }));

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
      // Find the projected revenue points for this year and sum
      const yearRevRows = rolledUp.filter((r) => r.period.year === yr && r.revenueProjected !== null);
      const revLow = yearRevRows.reduce((s, r) => s + (r.revenueProjected?.lower80 ?? 0), 0);
      const revHigh = yearRevRows.reduce((s, r) => s + (r.revenueProjected?.upper80 ?? 0), 0);
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
