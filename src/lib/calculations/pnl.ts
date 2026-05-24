import type { Account, AccountValue, Period, PeriodAggregation, FinancialSummary } from '@/types';
import { aggregateValues, getUniquePeriods, type Granularity } from './period-aggregation';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function normalizePeriods(periods: Period | Period[]): Period[] {
  return Array.isArray(periods) ? periods : [periods];
}

function periodsEqual(a: Period, b: Period): boolean {
  return a.year === b.year && a.month === b.month;
}

function periodToKey(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

function comparePeriods(a: Period, b: Period): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function getQuarter(month: number): number {
  return Math.ceil(month / 3);
}

function quarterLabel(period: Period): string {
  return `Q${getQuarter(period.month)} ${period.year}`;
}

function monthLabel(period: Period): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[period.month - 1]} ${period.year}`;
}

/** Filter values to only those matching the given period keys */
function filterValues(values: AccountValue[], periodKeys: Set<string>): AccountValue[] {
  return values.filter(v => periodKeys.has(periodToKey(v.period)));
}

/** Filter values to only those whose accountId is in the given set */
function filterByAccounts(values: AccountValue[], accountIds: Set<string>): AccountValue[] {
  return values.filter(v => accountIds.has(v.accountId));
}

/** Sum all amounts in the given values (already filtered) */
function sumAmounts(values: AccountValue[]): number {
  return values.reduce((acc, v) => acc + v.amount, 0);
}

function safeDivide(num: number, denom: number): number | null {
  if (denom === 0) return null;
  return num / denom;
}

function safeNumber(n: number | null): number {
  return n ?? 0;
}

// ─────────────────────────────────────────────
// Account helpers
// ─────────────────────────────────────────────

function nameContains(account: Account, ...keywords: string[]): boolean {
  const name = account.name.toLowerCase();
  return keywords.some(kw => name.includes(kw.toLowerCase()));
}

function isInterestOrTax(account: Account): boolean {
  return account.type === 'expense' && nameContains(account, 'interest', 'tax');
}

function isMarketing(account: Account): boolean {
  return nameContains(account, 'marketing', 'advertising');
}

// ─────────────────────────────────────────────
// sumByType
// ─────────────────────────────────────────────

/**
 * Sum all amounts for accounts of the given types in the given period(s).
 * Accounts with isExcluded=true are always filtered out to prevent double-counting
 * summary rows (e.g. "Net Income", "Gross Profit") exported by QBO.
 */
export function sumByType(
  accounts: Account[],
  values: AccountValue[],
  types: Account['type'][],
  periods: Period | Period[]
): number {
  const periodArr = normalizePeriods(periods);
  const periodKeys = new Set(periodArr.map(periodToKey));
  const typeSet = new Set(types);
  const accountIds = new Set(
    accounts.filter(a => typeSet.has(a.type) && !a.isExcluded).map(a => a.id)
  );

  const filtered = filterValues(filterByAccounts(values, accountIds), periodKeys);
  return sumAmounts(filtered);
}

// ─────────────────────────────────────────────
// computePnL
// ─────────────────────────────────────────────

/**
 * Compute the full P&L breakdown for a given period or set of periods.
 */
export function computePnL(
  accounts: Account[],
  values: AccountValue[],
  periods: Period | Period[]
): {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  totalFixedCosts: number;
  totalVariableCosts: number;
  totalMixedCosts: number;
  operatingExpenses: number;
  operatingIncome: number;
  operatingMarginPct: number;
  netIncome: number;
  netMarginPct: number;
  contributionMargin: number;
  contributionMarginPct: number;
  marketingSpend: number;
} {
  const periodArr = normalizePeriods(periods);
  const periodKeys = new Set(periodArr.map(periodToKey));
  const filteredValues = filterValues(values, periodKeys);

  // Build a map for quick lookup: accountId -> amount (summed across all periods)
  const amountByAccount = new Map<string, number>();
  for (const v of filteredValues) {
    amountByAccount.set(v.accountId, (amountByAccount.get(v.accountId) ?? 0) + v.amount);
  }

  function accountTotal(acc: Account): number {
    return amountByAccount.get(acc.id) ?? 0;
  }

  // Revenue
  const revenueAccounts = accounts.filter(a => a.type === 'revenue');
  const revenue = revenueAccounts.reduce((s, a) => s + accountTotal(a), 0);

  // COGS
  const cogsAccounts = accounts.filter(a => a.type === 'cogs');
  const cogs = cogsAccounts.reduce((s, a) => s + accountTotal(a), 0);

  const grossProfit = revenue - cogs;
  const grossMarginPct = revenue === 0 ? 0 : grossProfit / revenue;

  // Expense accounts (operating expenses)
  const expenseAccounts = accounts.filter(a => a.type === 'expense');

  let totalFixedCosts = 0;
  let totalVariableCosts = 0;
  let totalMixedCosts = 0;

  for (const acc of expenseAccounts) {
    const amount = accountTotal(acc);
    const behavior = acc.costBehavior ?? 'unclassified';

    if (behavior === 'fixed') {
      totalFixedCosts += amount;
    } else if (behavior === 'variable') {
      totalVariableCosts += amount;
    } else if (behavior === 'mixed') {
      totalMixedCosts += amount;
      // Split mixed costs
      const fixedPct = acc.mixedFixedPercent ?? 0.5;
      totalFixedCosts += amount * fixedPct;
      totalVariableCosts += amount * (1 - fixedPct);
      // We'll subtract from totalMixedCosts to avoid double-counting
      // Actually totalMixedCosts is the raw mixed total; fixed/variable portions are tracked separately
    } else {
      // unclassified — treat as fixed by default for operating expense calculation
      totalFixedCosts += amount;
    }
  }

  // Recalculate: totalMixedCosts is the sum of mixed expense accounts (gross)
  // totalFixedCosts and totalVariableCosts already include mixed splits
  // For clarity: separate pure fixed/variable from mixed splits
  let pureFixed = 0;
  let pureVariable = 0;
  let mixedFixed = 0;
  let mixedVariable = 0;
  let mixedTotal = 0;

  for (const acc of expenseAccounts) {
    const amount = accountTotal(acc);
    const behavior = acc.costBehavior ?? 'unclassified';

    if (behavior === 'fixed') {
      pureFixed += amount;
    } else if (behavior === 'variable') {
      pureVariable += amount;
    } else if (behavior === 'mixed') {
      const fixedPct = acc.mixedFixedPercent ?? 0.5;
      mixedFixed += amount * fixedPct;
      mixedVariable += amount * (1 - fixedPct);
      mixedTotal += amount;
    } else {
      pureFixed += amount;
    }
  }

  totalFixedCosts = pureFixed + mixedFixed;
  totalVariableCosts = pureVariable + mixedVariable;
  totalMixedCosts = mixedTotal;

  // Total operating expenses = sum of all expense accounts
  const operatingExpenses = expenseAccounts.reduce((s, a) => s + accountTotal(a), 0);

  // Operating income = gross profit - operating expenses
  const operatingIncome = grossProfit - operatingExpenses;
  const operatingMarginPct = revenue === 0 ? 0 : operatingIncome / revenue;

  // Net income (same as operating income in this model — no separate tax/interest line)
  const netIncome = operatingIncome;
  const netMarginPct = revenue === 0 ? 0 : netIncome / revenue;

  // Contribution margin = revenue - variable costs (including variable portion of COGS)
  // COGS are typically variable; variable expense accounts also reduce CM
  const contributionMargin = revenue - cogs - totalVariableCosts;
  const contributionMarginPct = revenue === 0 ? 0 : contributionMargin / revenue;

  // Marketing spend
  const marketingAccounts = accounts.filter(a => a.type === 'expense' && isMarketing(a));
  const marketingSpend = marketingAccounts.reduce((s, a) => s + accountTotal(a), 0);

  return {
    revenue,
    cogs,
    grossProfit,
    grossMarginPct,
    totalFixedCosts,
    totalVariableCosts,
    totalMixedCosts,
    operatingExpenses,
    operatingIncome,
    operatingMarginPct,
    netIncome,
    netMarginPct,
    contributionMargin,
    contributionMarginPct,
    marketingSpend,
  };
}

// ─────────────────────────────────────────────
// toFinancialSummary
// ─────────────────────────────────────────────

/**
 * Convert computePnL result to a FinancialSummary.
 */
export function toFinancialSummary(
  pnl: ReturnType<typeof computePnL>,
  period?: Period
): FinancialSummary {
  return {
    revenue: pnl.revenue,
    cogs: pnl.cogs,
    grossProfit: pnl.grossProfit,
    grossMargin: pnl.grossMarginPct,
    totalFixedCosts: pnl.totalFixedCosts,
    totalVariableCosts: pnl.totalVariableCosts,
    operatingExpenses: pnl.operatingExpenses,
    operatingIncome: pnl.operatingIncome,
    netIncome: pnl.netIncome,
    contributionMargin: pnl.contributionMargin,
    contributionMarginPct: pnl.contributionMarginPct,
    marketingSpend: pnl.marketingSpend,
    period,
  };
}

// ─────────────────────────────────────────────
// buildPeriodAggregations
// ─────────────────────────────────────────────

/**
 * Build a PeriodAggregation for each period in the list.
 * granularity label: monthly="Jan 2024", quarterly="Q1 2024", annual="FY2024", ttm="TTM"
 */
export function buildPeriodAggregations(
  accounts: Account[],
  values: AccountValue[],
  granularity: Granularity,
  _fiscalYearStart?: number
): PeriodAggregation[] {
  // Aggregate values to requested granularity
  const aggregated = aggregateValues(values, granularity);
  if (aggregated.length === 0) return [];

  // Find all unique periods in the aggregated data
  const periodKeys = new Set(aggregated.map(v => periodToKey(v.period)));
  const uniquePeriods: Period[] = [];
  const seenKeys = new Set<string>();
  for (const v of aggregated) {
    const k = periodToKey(v.period);
    if (!seenKeys.has(k)) {
      seenKeys.add(k);
      uniquePeriods.push(v.period);
    }
  }
  uniquePeriods.sort(comparePeriods);

  return uniquePeriods.map(period => {
    // Get aggregated values for this period only
    const periodAggValues = aggregated.filter(v => periodsEqual(v.period, period));

    const pnl = computePnL(accounts, periodAggValues, period);

    let label: string;
    if (granularity === 'monthly') {
      label = monthLabel(period);
    } else if (granularity === 'quarterly') {
      label = quarterLabel(period);
    } else if (granularity === 'annual') {
      label = `FY${period.year}`;
    } else {
      label = 'TTM';
    }

    return {
      period,
      label,
      granularity,
      revenue: pnl.revenue,
      cogs: pnl.cogs,
      grossProfit: pnl.grossProfit,
      grossMarginPct: pnl.grossMarginPct,
      totalFixedCosts: pnl.totalFixedCosts,
      totalVariableCosts: pnl.totalVariableCosts,
      operatingExpenses: pnl.operatingExpenses,
      operatingIncome: pnl.operatingIncome,
      operatingMarginPct: pnl.operatingMarginPct,
      netIncome: pnl.netIncome,
      netMarginPct: pnl.netMarginPct,
      contributionMargin: pnl.contributionMargin,
      contributionMarginPct: pnl.contributionMarginPct,
    };
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
    mixedFixedPercent?: number
  ): Account => ({
    id,
    name,
    type,
    costBehavior,
    mixedFixedPercent,
    isManuallyClassified: false,
  });

  const mkVal = (accountId: string, year: number, month: number, amount: number): AccountValue => ({
    accountId,
    period: { year, month },
    amount,
  });

  // ── sumByType: basic ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('e1', 'Expense', 'expense'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 1000),
      mkVal('e1', 2024, 1, 300),
      mkVal('r1', 2024, 2, 500),
    ];
    const sum = sumByType(accounts, values, ['revenue'], { year: 2024, month: 1 });
    console.assert(sum === 1000, `sumByType single period should be 1000, got ${sum}`);

    const sumMulti = sumByType(accounts, values, ['revenue'], [{ year: 2024, month: 1 }, { year: 2024, month: 2 }]);
    console.assert(sumMulti === 1500, `sumByType multi-period should be 1500, got ${sumMulti}`);
  }

  // ── sumByType: empty ──
  {
    const sum = sumByType([], [], ['revenue'], { year: 2024, month: 1 });
    console.assert(sum === 0, 'empty should return 0');
  }

  // ── computePnL: basic ──
  {
    const accounts = [
      mkAccount('r1', 'Sales Revenue', 'revenue'),
      mkAccount('c1', 'Cost of Goods', 'cogs'),
      mkAccount('e1', 'Rent', 'expense', 'fixed'),
      mkAccount('e2', 'Commissions', 'expense', 'variable'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 10000),
      mkVal('c1', 2024, 1, 3000),
      mkVal('e1', 2024, 1, 2000),
      mkVal('e2', 2024, 1, 1000),
    ];
    const pnl = computePnL(accounts, values, { year: 2024, month: 1 });
    console.assert(pnl.revenue === 10000, `revenue should be 10000, got ${pnl.revenue}`);
    console.assert(pnl.cogs === 3000, `cogs should be 3000, got ${pnl.cogs}`);
    console.assert(pnl.grossProfit === 7000, `grossProfit should be 7000, got ${pnl.grossProfit}`);
    console.assert(pnl.totalFixedCosts === 2000, `fixed costs should be 2000, got ${pnl.totalFixedCosts}`);
    console.assert(pnl.totalVariableCosts === 1000, `variable costs should be 1000, got ${pnl.totalVariableCosts}`);
    console.assert(pnl.operatingExpenses === 3000, `opex should be 3000, got ${pnl.operatingExpenses}`);
    console.assert(pnl.operatingIncome === 4000, `operating income should be 4000, got ${pnl.operatingIncome}`);
    // CM = revenue - cogs - variable expenses = 10000 - 3000 - 1000 = 6000
    console.assert(pnl.contributionMargin === 6000, `CM should be 6000, got ${pnl.contributionMargin}`);
  }

  // ── computePnL: zero revenue ──
  {
    const accounts = [mkAccount('e1', 'Rent', 'expense', 'fixed')];
    const values = [mkVal('e1', 2024, 1, 1000)];
    const pnl = computePnL(accounts, values, { year: 2024, month: 1 });
    console.assert(pnl.revenue === 0, 'revenue should be 0');
    console.assert(pnl.grossMarginPct === 0, 'gross margin should be 0 (not NaN)');
    console.assert(pnl.operatingMarginPct === 0, 'operating margin should be 0 (not NaN)');
  }

  // ── computePnL: mixed costs ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('m1', 'Utilities', 'expense', 'mixed', 0.6),
    ];
    const values = [
      mkVal('r1', 2024, 1, 5000),
      mkVal('m1', 2024, 1, 1000),
    ];
    const pnl = computePnL(accounts, values, { year: 2024, month: 1 });
    console.assert(pnl.totalMixedCosts === 1000, `mixedTotal should be 1000, got ${pnl.totalMixedCosts}`);
    console.assert(Math.abs(pnl.totalFixedCosts - 600) < 1e-9, `fixed portion should be 600, got ${pnl.totalFixedCosts}`);
    console.assert(Math.abs(pnl.totalVariableCosts - 400) < 1e-9, `variable portion should be 400, got ${pnl.totalVariableCosts}`);
  }

  // ── computePnL: marketing spend ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('m1', 'Marketing Budget', 'expense', 'variable'),
      mkAccount('m2', 'Advertising Spend', 'expense', 'variable'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 5000),
      mkVal('m1', 2024, 1, 300),
      mkVal('m2', 2024, 1, 200),
    ];
    const pnl = computePnL(accounts, values, { year: 2024, month: 1 });
    console.assert(pnl.marketingSpend === 500, `marketingSpend should be 500, got ${pnl.marketingSpend}`);
  }

  // ── buildPeriodAggregations: labels ──
  {
    const accounts = [mkAccount('r1', 'Revenue', 'revenue')];
    const values = [
      mkVal('r1', 2024, 1, 100),
      mkVal('r1', 2024, 2, 200),
    ];
    const monthly = buildPeriodAggregations(accounts, values, 'monthly');
    console.assert(monthly.length === 2, `monthly should have 2 entries, got ${monthly.length}`);
    console.assert(monthly[0]!.label === 'Jan 2024', `label should be 'Jan 2024', got ${monthly[0]!.label}`);

    const annual = buildPeriodAggregations(accounts, values, 'annual');
    console.assert(annual.length === 1, `annual should have 1 entry, got ${annual.length}`);
    console.assert(annual[0]!.label === 'FY2024', `label should be 'FY2024', got ${annual[0]!.label}`);
  }

  console.log('pnl tests passed');
}
