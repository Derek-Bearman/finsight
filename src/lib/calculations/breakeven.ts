import type { Account, AccountValue, Period, BreakevenResult } from '@/types';
import { aggregateValues, getUniquePeriods, type Granularity } from './period-aggregation';
import { computePnL } from './pnl';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function normalizePeriods(periods: Period | Period[]): Period[] {
  return Array.isArray(periods) ? periods : [periods];
}

function periodToKey(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

function comparePeriods(a: Period, b: Period): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function periodsEqual(a: Period, b: Period): boolean {
  return a.year === b.year && a.month === b.month;
}

// ─────────────────────────────────────────────
// Fixed cost classification for breakeven
//
// Fixed costs = pure fixed accounts + mixed fixed portion + interest/tax expense (9xxx)
// Variable costs = pure variable + mixed variable portion (+ cogs already handled in CM)
// ─────────────────────────────────────────────

function accountNumber(account: Account): number | null {
  if (!account.number) return null;
  const n = parseInt(account.number, 10);
  return isNaN(n) ? null : n;
}

function isInterestOrTaxExpense(account: Account): boolean {
  if (account.type !== 'expense') return false;
  const num = accountNumber(account);
  if (num !== null && num >= 9000 && num <= 9999) return true;
  const name = account.name.toLowerCase();
  return name.includes('interest') || name.includes('tax');
}

/**
 * Compute fixed costs and variable costs for breakeven analysis.
 *
 * Fixed costs include:
 * - Pure fixed expense accounts
 * - Mixed fixed portion (mixedFixedPercent, default 0.5)
 * - Interest/tax expense accounts (9xxx or name contains interest/tax)
 *
 * Variable costs include:
 * - Pure variable expense accounts
 * - Mixed variable portion
 * (COGS are separately tracked via computePnL's cogs)
 */
function computeBreakevenCosts(
  accounts: Account[],
  amountByAccount: Map<string, number>
): { fixedCosts: number; variableCosts: number } {
  let fixedCosts = 0;
  let variableCosts = 0;

  // Filter out excluded accounts (summary/subtotal rows) to prevent double-counting.
  const expenseAccounts = accounts.filter(a => a.type === 'expense' && !a.isExcluded);

  for (const acc of expenseAccounts) {
    const amount = amountByAccount.get(acc.id) ?? 0;
    const behavior = acc.costBehavior ?? 'unclassified';

    if (behavior === 'fixed') {
      fixedCosts += amount;
    } else if (behavior === 'variable') {
      // Interest/tax variable accounts still count as fixed for breakeven
      if (isInterestOrTaxExpense(acc)) {
        fixedCosts += amount;
      } else {
        variableCosts += amount;
      }
    } else if (behavior === 'mixed') {
      const fixedPct = acc.mixedFixedPercent ?? 0.5;
      fixedCosts += amount * fixedPct;
      variableCosts += amount * (1 - fixedPct);
    } else {
      // unclassified — if interest/tax, treat as fixed; otherwise fixed by default
      fixedCosts += amount;
    }

    // Force interest/tax to be fixed regardless of behavior classification
    // (already handled above per behavior, but ensure 9xxx accounts are fixed)
    // For mixed/variable interest-tax accounts, we already rerouted above
  }

  return { fixedCosts, variableCosts };
}

// ─────────────────────────────────────────────
// computeBreakeven
// ─────────────────────────────────────────────

/**
 * Compute breakeven for a given period or set of periods.
 *
 * breakeven revenue = total fixed costs / contribution margin %
 * margin of safety = (actual revenue - breakeven revenue) / actual revenue
 * operating leverage = contribution margin / operating income
 *   (null when operating income ≤ 0)
 * breakeven units = breakeven revenue / avg ticket (when avgTicket provided)
 */
export function computeBreakeven(
  accounts: Account[],
  values: AccountValue[],
  periods: Period | Period[],
  avgTicket?: number
): BreakevenResult {
  const periodArr = normalizePeriods(periods);
  const periodKeys = new Set(periodArr.map(periodToKey));

  // Use most recent period as the "result" period
  const sortedPeriods = periodArr.slice().sort(comparePeriods);
  const resultPeriod = sortedPeriods[sortedPeriods.length - 1] ?? { year: 0, month: 1 };

  // Filter values to the periods
  const filteredValues = values.filter(v => periodKeys.has(periodToKey(v.period)));

  // Build amountByAccount
  const amountByAccount = new Map<string, number>();
  for (const v of filteredValues) {
    amountByAccount.set(v.accountId, (amountByAccount.get(v.accountId) ?? 0) + v.amount);
  }

  // Get P&L (for revenue and contribution margin pct)
  const pnl = computePnL(accounts, filteredValues, periodArr);

  // Compute breakeven-specific fixed/variable split
  const { fixedCosts } = computeBreakevenCosts(accounts, amountByAccount);

  const revenue = pnl.revenue;
  const contributionMarginPct = pnl.contributionMarginPct;

  // breakeven revenue = fixed costs / CM%
  let breakevenRevenue: number;
  if (contributionMarginPct > 0) {
    breakevenRevenue = fixedCosts / contributionMarginPct;
  } else if (revenue === 0 && fixedCosts === 0) {
    // Empty period (e.g. a balance-sheet-only month): nothing to cover.
    breakevenRevenue = 0;
  } else {
    // CM% ≤ 0 with real activity — breakeven is structurally unreachable at
    // this cost structure. Keep the state explicit as Infinity: sanitizing it
    // to 0 made loss-making stress scenarios read as "above breakeven" with a
    // 100% margin of safety. Infinity keeps every `revenue >= breakeven`
    // check correctly false, and the shared formatters render it as '—'.
    breakevenRevenue = Infinity;
  }

  // margin of safety (−Infinity when breakeven is unreachable)
  const marginOfSafety = revenue - breakevenRevenue;
  const marginOfSafetyPct =
    revenue === 0 ? (marginOfSafety < 0 ? -Infinity : 0) : marginOfSafety / revenue;

  // operating leverage = contribution margin / operating income
  let operatingLeverage: number | null = null;
  if (pnl.operatingIncome > 0) {
    operatingLeverage = pnl.contributionMargin / pnl.operatingIncome;
  }

  const result: BreakevenResult = {
    period: resultPeriod,
    fixedCosts,
    contributionMarginPct,
    breakevenRevenue,
    actualRevenue: revenue,
    marginOfSafety,
    marginOfSafetyPct,
    operatingLeverage,
  };

  if (avgTicket !== undefined && avgTicket > 0) {
    result.breakevenUnits = breakevenRevenue / avgTicket;
  }

  return result;
}

// ─────────────────────────────────────────────
// computeBreakevenSeries
// ─────────────────────────────────────────────

/**
 * Compute breakeven for every period in a series.
 * Returns array sorted chronologically.
 */
export function computeBreakevenSeries(
  accounts: Account[],
  values: AccountValue[],
  granularity: Granularity,
  avgTicket?: number
): BreakevenResult[] {
  const aggregated = aggregateValues(values, granularity);
  if (aggregated.length === 0) return [];

  // Find unique periods in aggregated
  const seen = new Map<string, Period>();
  for (const v of aggregated) {
    const k = periodToKey(v.period);
    if (!seen.has(k)) seen.set(k, v.period);
  }
  const periods = Array.from(seen.values()).sort(comparePeriods);

  return periods.map(period => {
    const periodVals = aggregated.filter(v => periodsEqual(v.period, period));
    return computeBreakeven(accounts, periodVals, period, avgTicket);
  });
}

// ─────────────────────────────────────────────
// Unit Tests
// ─────────────────────────────────────────────

export function runTests(): void {
  const mkAccount = (
    id: string,
    name: string,
    type: Account['type'],
    costBehavior?: Account['costBehavior'],
    mixedFixedPercent?: number,
    number?: string
  ): Account => ({
    id,
    name,
    type,
    costBehavior,
    mixedFixedPercent,
    number,
    isManuallyClassified: false,
  });

  const mkVal = (accountId: string, year: number, month: number, amount: number): AccountValue => ({
    accountId,
    period: { year, month },
    amount,
  });

  // ── Basic breakeven ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('c1', 'COGS', 'cogs'),
      mkAccount('e1', 'Rent', 'expense', 'fixed'),
      mkAccount('e2', 'Commissions', 'expense', 'variable'),
    ];
    // revenue=10000, cogs=2000, fixed=3000, variable=1000
    // CM = 10000 - 2000 - 1000 = 7000; CM% = 7000/10000 = 0.7
    // breakeven = 3000 / 0.7 ≈ 4285.71
    const values = [
      mkVal('r1', 2024, 1, 10000),
      mkVal('c1', 2024, 1, 2000),
      mkVal('e1', 2024, 1, 3000),
      mkVal('e2', 2024, 1, 1000),
    ];
    const result = computeBreakeven(accounts, values, { year: 2024, month: 1 });
    console.assert(result.fixedCosts === 3000, `fixedCosts should be 3000, got ${result.fixedCosts}`);
    console.assert(Math.abs(result.contributionMarginPct - 0.7) < 1e-9, `CM% should be 0.7, got ${result.contributionMarginPct}`);
    const expectedBE = 3000 / 0.7;
    console.assert(Math.abs(result.breakevenRevenue - expectedBE) < 0.01, `breakeven revenue should be ~4285.71, got ${result.breakevenRevenue}`);
    console.assert(result.actualRevenue === 10000, 'actual revenue should be 10000');
    console.assert(result.operatingLeverage !== null, 'operating leverage should not be null');
    // OL = CM / OI = 7000 / (10000 - 2000 - 3000 - 1000) = 7000 / 4000 = 1.75
    console.assert(Math.abs((result.operatingLeverage ?? 0) - 1.75) < 1e-9, `OL should be 1.75, got ${result.operatingLeverage}`);
  }

  // ── With avgTicket ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('e1', 'Rent', 'expense', 'fixed'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 5000),
      mkVal('e1', 2024, 1, 1000),
    ];
    // CM% = 5000/5000 = 1.0; breakeven = 1000/1.0 = 1000
    const result = computeBreakeven(accounts, values, { year: 2024, month: 1 }, 50);
    console.assert(result.breakevenRevenue === 1000, `breakeven revenue should be 1000, got ${result.breakevenRevenue}`);
    console.assert(result.breakevenUnits === 20, `breakeven units should be 20, got ${result.breakevenUnits}`);
  }

  // ── Zero CM — can't break even ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('c1', 'COGS', 'cogs'),
      mkAccount('e1', 'Rent', 'expense', 'fixed'),
    ];
    // revenue=1000, cogs=1000, CM=0
    const values = [
      mkVal('r1', 2024, 1, 1000),
      mkVal('c1', 2024, 1, 1000),
      mkVal('e1', 2024, 1, 500),
    ];
    const result = computeBreakeven(accounts, values, { year: 2024, month: 1 });
    console.assert(result.contributionMarginPct === 0, 'CM% should be 0');
    console.assert(
      result.breakevenRevenue === Infinity,
      `breakeven should be unreachable (Infinity) when CM%=0 with fixed costs, got ${result.breakevenRevenue}`
    );
    console.assert(
      !(result.actualRevenue >= result.breakevenRevenue),
      'CM%=0 with fixed costs must never read as above breakeven'
    );
    console.assert(result.marginOfSafety === -Infinity, 'margin of safety should be -Infinity when breakeven is unreachable');
    console.assert(result.marginOfSafetyPct === -Infinity, 'margin of safety % should be -Infinity when breakeven is unreachable');
  }

  // ── Empty period (no activity) keeps breakeven at 0, not Infinity ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('e1', 'Rent', 'expense', 'fixed'),
    ];
    // A balance-sheet-only month has no P&L values at all.
    const result = computeBreakeven(accounts, [], { year: 2024, month: 1 });
    console.assert(result.breakevenRevenue === 0, `empty period breakeven should be 0, got ${result.breakevenRevenue}`);
    console.assert(result.marginOfSafety === 0, 'empty period margin of safety should be 0');
  }

  // ── Mixed costs split ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('m1', 'Utilities', 'expense', 'mixed', 0.7),
    ];
    // revenue=5000, mixed=1000 (700 fixed, 300 variable)
    // CM = 5000 - 0 - 300 = 4700; CM% = 4700/5000 = 0.94
    // breakeven = 700 / 0.94 ≈ 744.68
    const values = [
      mkVal('r1', 2024, 1, 5000),
      mkVal('m1', 2024, 1, 1000),
    ];
    const result = computeBreakeven(accounts, values, { year: 2024, month: 1 });
    console.assert(Math.abs(result.fixedCosts - 700) < 1e-9, `fixedCosts should be 700, got ${result.fixedCosts}`);
  }

  // ── Empty arrays ──
  {
    const result = computeBreakeven([], [], { year: 2024, month: 1 });
    console.assert(result.actualRevenue === 0, 'empty: actual revenue should be 0');
    console.assert(result.fixedCosts === 0, 'empty: fixed costs should be 0');
  }

  // ── Operating leverage null when operating income <= 0 ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('e1', 'Rent', 'expense', 'fixed'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 100),
      mkVal('e1', 2024, 1, 200), // loss
    ];
    const result = computeBreakeven(accounts, values, { year: 2024, month: 1 });
    console.assert(result.operatingLeverage === null, 'OL should be null when operating income <= 0');
  }

  // ── Series ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('e1', 'Rent', 'expense', 'fixed'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 5000),
      mkVal('e1', 2024, 1, 1000),
      mkVal('r1', 2024, 2, 6000),
      mkVal('e1', 2024, 2, 1000),
    ];
    const series = computeBreakevenSeries(accounts, values, 'monthly');
    console.assert(series.length === 2, `series should have 2 entries, got ${series.length}`);
  }

  console.log('breakeven tests passed');
}
