import type { Account, AccountValue, Period, ProfitabilityRatios } from '@/types';
import { aggregateValues, type Granularity } from './period-aggregation';
import { computePnL } from './pnl';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function periodToKey(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

function periodsEqual(a: Period, b: Period): boolean {
  return a.year === b.year && a.month === b.month;
}

function comparePeriods(a: Period, b: Period): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function safeDivide(num: number, denom: number): number | null {
  if (denom === 0) return null;
  return num / denom;
}

// ─────────────────────────────────────────────
// Balance sheet snapshot helpers
// ─────────────────────────────────────────────

function getAccountBalance(
  accounts: Account[],
  values: AccountValue[],
  period: Period,
  filter: (a: Account) => boolean
): number {
  const periodVals = values.filter(v => periodsEqual(v.period, period));
  const amountByAccount = new Map<string, number>();
  for (const v of periodVals) {
    amountByAccount.set(v.accountId, (amountByAccount.get(v.accountId) ?? 0) + v.amount);
  }
  return accounts
    .filter(a => !a.isExcluded && filter(a))
    .reduce((s, a) => s + (amountByAccount.get(a.id) ?? 0), 0);
}

function avgBalance(current: number, prior?: number): number {
  if (prior === undefined) return current;
  return (current + prior) / 2;
}

// ─────────────────────────────────────────────
// computeProfitabilityRatios
// ─────────────────────────────────────────────

/**
 * ROA = net income / avg total assets
 * ROE = net income / avg total equity
 * DuPont: ROE = net margin × asset turnover × equity multiplier
 *   net margin = net income / revenue
 *   asset turnover = revenue / avg total assets
 *   equity multiplier = avg total assets / avg total equity
 */
export function computeProfitabilityRatios(
  accounts: Account[],
  values: AccountValue[],
  period: Period,
  priorPeriod?: Period
): ProfitabilityRatios {
  // P&L for the current period (flow)
  const periodVals = values.filter(v => periodsEqual(v.period, period));
  const pnl = computePnL(accounts, periodVals, period);

  const netIncome = pnl.netIncome;
  const revenue = pnl.revenue;

  // Balance sheet snapshots
  const totalAssetsCurrent = getAccountBalance(accounts, values, period, a => a.type === 'asset');
  const totalAssetsPrior = priorPeriod
    ? getAccountBalance(accounts, values, priorPeriod, a => a.type === 'asset')
    : undefined;
  const avgTotalAssets = avgBalance(totalAssetsCurrent, totalAssetsPrior);

  const totalEquityCurrent = getAccountBalance(accounts, values, period, a => a.type === 'equity');
  const totalEquityPrior = priorPeriod
    ? getAccountBalance(accounts, values, priorPeriod, a => a.type === 'equity')
    : undefined;
  const avgTotalEquity = avgBalance(totalEquityCurrent, totalEquityPrior);

  // ROA = net income / avg total assets
  const roa = safeDivide(netIncome, avgTotalAssets);

  // ROE = net income / avg total equity
  const roe = safeDivide(netIncome, avgTotalEquity);

  // DuPont components
  const netMargin = safeDivide(netIncome, revenue);
  const assetTurnover = safeDivide(revenue, avgTotalAssets);
  const equityMultiplier = safeDivide(avgTotalAssets, avgTotalEquity);

  return {
    period,
    roa,
    roe,
    dupont: {
      netMargin,
      assetTurnover,
      equityMultiplier,
    },
  };
}

// ─────────────────────────────────────────────
// computeProfitabilitySeries
// ─────────────────────────────────────────────

export function computeProfitabilitySeries(
  accounts: Account[],
  values: AccountValue[],
  granularity: Granularity
): ProfitabilityRatios[] {
  const aggregated = aggregateValues(values, granularity);
  if (aggregated.length === 0) return [];

  const seen = new Map<string, Period>();
  for (const v of aggregated) {
    const k = periodToKey(v.period);
    if (!seen.has(k)) seen.set(k, v.period);
  }
  const periods = Array.from(seen.values()).sort(comparePeriods);

  return periods.map((period, idx) => {
    const priorPeriod = idx > 0 ? periods[idx - 1] : undefined;
    const periodVals = aggregated.filter(v => periodsEqual(v.period, period));
    const priorVals = priorPeriod
      ? aggregated.filter(v => periodsEqual(v.period, priorPeriod))
      : [];
    const jointVals = [...periodVals, ...priorVals];
    return computeProfitabilityRatios(accounts, jointVals, period, priorPeriod);
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
    costBehavior?: Account['costBehavior']
  ): Account => ({
    id,
    name,
    type,
    costBehavior,
    isManuallyClassified: false,
  });

  const mkVal = (accountId: string, year: number, month: number, amount: number): AccountValue => ({
    accountId,
    period: { year, month },
    amount,
  });

  // ── Basic profitability ratios ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('e1', 'Expenses', 'expense', 'fixed'),
      mkAccount('a1', 'Assets', 'asset'),
      mkAccount('eq1', 'Equity', 'equity'),
    ];

    // Jan 2024: revenue=10000, expenses=6000, net income=4000
    // Assets=20000, Equity=15000
    const values = [
      mkVal('r1', 2024, 1, 10000),
      mkVal('e1', 2024, 1, 6000),
      mkVal('a1', 2024, 1, 20000),
      mkVal('eq1', 2024, 1, 15000),
      // Prior: Dec 2023
      mkVal('a1', 2023, 12, 18000),
      mkVal('eq1', 2023, 12, 14000),
    ];

    const result = computeProfitabilityRatios(
      accounts,
      values,
      { year: 2024, month: 1 },
      { year: 2023, month: 12 }
    );

    // avg total assets = (20000 + 18000) / 2 = 19000
    // avg total equity = (15000 + 14000) / 2 = 14500
    // ROA = 4000 / 19000 ≈ 0.2105
    // ROE = 4000 / 14500 ≈ 0.2759
    const expectedROA = 4000 / 19000;
    const expectedROE = 4000 / 14500;

    console.assert(
      result.roa !== null && Math.abs(result.roa - expectedROA) < 1e-9,
      `ROA should be ~${expectedROA}, got ${result.roa}`
    );
    console.assert(
      result.roe !== null && Math.abs(result.roe - expectedROE) < 1e-9,
      `ROE should be ~${expectedROE}, got ${result.roe}`
    );

    // DuPont: net margin = 4000/10000 = 0.4
    // asset turnover = 10000/19000
    // equity multiplier = 19000/14500
    // ROE check = 0.4 * (10000/19000) * (19000/14500) = 0.4 * 10000/14500 = 4000/14500 ✓
    console.assert(
      result.dupont.netMargin !== null && Math.abs(result.dupont.netMargin - 0.4) < 1e-9,
      `DuPont net margin should be 0.4, got ${result.dupont.netMargin}`
    );
    console.assert(
      result.dupont.assetTurnover !== null &&
        Math.abs(result.dupont.assetTurnover - 10000 / 19000) < 1e-9,
      `DuPont asset turnover should be ${10000 / 19000}, got ${result.dupont.assetTurnover}`
    );
    console.assert(
      result.dupont.equityMultiplier !== null &&
        Math.abs(result.dupont.equityMultiplier - 19000 / 14500) < 1e-9,
      `DuPont equity multiplier should be ${19000 / 14500}, got ${result.dupont.equityMultiplier}`
    );
  }

  // ── Zero equity → null ROE ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('a1', 'Assets', 'asset'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 5000),
      mkVal('a1', 2024, 1, 10000),
    ];
    const result = computeProfitabilityRatios(accounts, values, { year: 2024, month: 1 });
    console.assert(result.roe === null, 'ROE should be null when equity is 0');
    console.assert(result.dupont.equityMultiplier === null, 'equity multiplier should be null when equity is 0');
  }

  // ── Zero assets → null ROA ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
    ];
    const values = [mkVal('r1', 2024, 1, 5000)];
    const result = computeProfitabilityRatios(accounts, values, { year: 2024, month: 1 });
    console.assert(result.roa === null, 'ROA should be null when assets are 0');
  }

  // ── Empty arrays ──
  {
    const result = computeProfitabilityRatios([], [], { year: 2024, month: 1 });
    console.assert(result.roa === null, 'empty: ROA should be null');
    console.assert(result.roe === null, 'empty: ROE should be null');
  }

  // ── No prior period — uses single value ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('a1', 'Assets', 'asset'),
      mkAccount('eq1', 'Equity', 'equity'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 1000),
      mkVal('a1', 2024, 1, 5000),
      mkVal('eq1', 2024, 1, 3000),
    ];
    const result = computeProfitabilityRatios(accounts, values, { year: 2024, month: 1 });
    // No prior: avg = single value
    console.assert(
      result.roa !== null && Math.abs(result.roa - 1000 / 5000) < 1e-9,
      `ROA without prior should be ${1000 / 5000}, got ${result.roa}`
    );
  }

  // ── Series ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('a1', 'Assets', 'asset'),
      mkAccount('eq1', 'Equity', 'equity'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 1000),
      mkVal('a1', 2024, 1, 5000),
      mkVal('eq1', 2024, 1, 3000),
      mkVal('r1', 2024, 2, 1200),
      mkVal('a1', 2024, 2, 5500),
      mkVal('eq1', 2024, 2, 3200),
    ];
    const series = computeProfitabilitySeries(accounts, values, 'monthly');
    console.assert(series.length === 2, `series should have 2 entries, got ${series.length}`);
    console.assert(
      periodsEqual(series[0]!.period, { year: 2024, month: 1 }),
      'first entry should be Jan 2024'
    );
  }

  console.log('profitability tests passed');
}
