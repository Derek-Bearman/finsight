import type { Account, AccountValue, Period, HealthScores } from '@/types';
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

function nameContains(account: Account, ...keywords: string[]): boolean {
  const name = account.name.toLowerCase();
  return keywords.some(kw => name.includes(kw.toLowerCase()));
}

function accountNumber(account: Account): number | null {
  if (!account.number) return null;
  const n = parseInt(account.number, 10);
  return isNaN(n) ? null : n;
}

// ─────────────────────────────────────────────
// Account classification helpers
// ─────────────────────────────────────────────

function isRetainedEarnings(account: Account): boolean {
  return account.type === 'equity' && nameContains(account, 'retained');
}

function isInterestExpense(account: Account): boolean {
  return account.type === 'expense' && nameContains(account, 'interest');
}

function isCurrentAsset(account: Account): boolean {
  if (account.type !== 'asset') return false;
  const num = accountNumber(account);
  if (num !== null && num >= 1000 && num <= 1499) return true;
  return nameContains(account, 'cash', 'checking', 'savings', 'receivable', ' ar', 'inventory', 'prepaid');
}

function isCurrentLiability(account: Account): boolean {
  if (account.type !== 'liability') return false;
  const num = accountNumber(account);
  if (num !== null && num >= 2000 && num <= 2499) return true;
  return nameContains(account, 'payable', ' ap', 'accrued', 'credit card');
}

// ─────────────────────────────────────────────
// Balance sheet snapshot helper
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

// ─────────────────────────────────────────────
// computeHealthScores
// ─────────────────────────────────────────────

/**
 * Altman Z-Score — private company variant (Z''):
 * X1 = working capital / total assets
 * X2 = retained earnings / total assets
 * X3 = EBIT / total assets  (EBIT = operating income)
 * X4 = book value of equity / total liabilities
 * Z'' = 6.56*X1 + 3.26*X2 + 6.72*X3 + 1.05*X4
 * Zones: >= 2.6 = safe, 1.1–2.6 = grey, < 1.1 = distress
 *
 * interest coverage = EBIT / interest expense
 * (null if interest expense is 0 or not present)
 */
export function computeHealthScores(
  accounts: Account[],
  values: AccountValue[],
  period: Period,
  _priorPeriod?: Period
): HealthScores {
  // P&L for the period
  const periodVals = values.filter(v => periodsEqual(v.period, period));
  const pnl = computePnL(accounts, periodVals, period);

  // EBIT = operating income (before interest and tax in this model)
  const ebit = pnl.operatingIncome;

  // Balance sheet items (snapshot)
  const currentAssets = getAccountBalance(accounts, values, period, isCurrentAsset);
  const currentLiabilities = getAccountBalance(accounts, values, period, isCurrentLiability);
  const workingCapital = currentAssets - currentLiabilities;

  const totalAssets = getAccountBalance(accounts, values, period, a => a.type === 'asset');
  const totalLiabilities = getAccountBalance(accounts, values, period, a => a.type === 'liability');
  const totalEquity = getAccountBalance(accounts, values, period, a => a.type === 'equity');
  const retainedEarnings = getAccountBalance(accounts, values, period, isRetainedEarnings);

  // Altman Z'' (private company variant)
  let altmanZScore: number | null = null;
  if (totalAssets !== 0) {
    const X1 = workingCapital / totalAssets;
    const X2 = retainedEarnings / totalAssets;
    const X3 = ebit / totalAssets;
    const X4 = totalLiabilities !== 0 ? totalEquity / totalLiabilities : 0;

    altmanZScore = 6.56 * X1 + 3.26 * X2 + 6.72 * X3 + 1.05 * X4;
  }

  // Interest coverage = EBIT / interest expense
  // Find interest expense accounts
  const interestAccounts = accounts.filter(a => !a.isExcluded && isInterestExpense(a));
  const hasInterestAccounts = interestAccounts.length > 0;

  let interestCoverageRatio: number | null = null;
  if (hasInterestAccounts) {
    const amountByAccount = new Map<string, number>();
    for (const v of periodVals) {
      amountByAccount.set(v.accountId, (amountByAccount.get(v.accountId) ?? 0) + v.amount);
    }
    const interestExpense = interestAccounts.reduce(
      (s, a) => s + (amountByAccount.get(a.id) ?? 0),
      0
    );
    if (interestExpense !== 0) {
      interestCoverageRatio = ebit / interestExpense;
    }
  }

  return {
    period,
    altmanZScore,
    interestCoverageRatio,
  };
}

// ─────────────────────────────────────────────
// computeHealthSeries
// ─────────────────────────────────────────────

export function computeHealthSeries(
  accounts: Account[],
  values: AccountValue[],
  granularity: Granularity
): HealthScores[] {
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
    return computeHealthScores(accounts, jointVals, period, priorPeriod);
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
    number?: string
  ): Account => ({
    id,
    name,
    type,
    costBehavior,
    number,
    isManuallyClassified: false,
  });

  const mkVal = (accountId: string, year: number, month: number, amount: number): AccountValue => ({
    accountId,
    period: { year, month },
    amount,
  });

  // ── Basic Altman Z-Score ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('e1', 'Expenses', 'expense', 'fixed'),
      // Current assets
      mkAccount('ca1', 'Cash', 'asset', undefined, '1010'),
      mkAccount('ca2', 'Accounts Receivable', 'asset', undefined, '1100'),
      // Non-current assets
      mkAccount('fa1', 'Equipment', 'asset', undefined, '1500'),
      // Current liabilities
      mkAccount('cl1', 'Accounts Payable', 'liability', undefined, '2010'),
      // Long-term liabilities
      mkAccount('ll1', 'Long Term Debt', 'liability', undefined, '2600'),
      // Equity
      mkAccount('eq1', 'Common Stock', 'equity'),
      mkAccount('re1', 'Retained Earnings', 'equity'),
    ];

    const values = [
      mkVal('r1', 2024, 1, 50000),
      mkVal('e1', 2024, 1, 30000),
      mkVal('ca1', 2024, 1, 15000),
      mkVal('ca2', 2024, 1, 10000),
      mkVal('fa1', 2024, 1, 40000),
      mkVal('cl1', 2024, 1, 8000),
      mkVal('ll1', 2024, 1, 22000),
      mkVal('eq1', 2024, 1, 25000),
      mkVal('re1', 2024, 1, 10000),
    ];

    const result = computeHealthScores(accounts, values, { year: 2024, month: 1 });

    // totalAssets = 15000 + 10000 + 40000 = 65000
    // workingCapital = (15000+10000) - 8000 = 17000
    // retainedEarnings = 10000
    // ebit = 50000 - 30000 = 20000
    // totalLiabilities = 8000 + 22000 = 30000
    // totalEquity = 25000 + 10000 = 35000
    // X1 = 17000/65000
    // X2 = 10000/65000
    // X3 = 20000/65000
    // X4 = 35000/30000
    // Z'' = 6.56*(17000/65000) + 3.26*(10000/65000) + 6.72*(20000/65000) + 1.05*(35000/30000)

    const X1 = 17000 / 65000;
    const X2 = 10000 / 65000;
    const X3 = 20000 / 65000;
    const X4 = 35000 / 30000;
    const expectedZ = 6.56 * X1 + 3.26 * X2 + 6.72 * X3 + 1.05 * X4;

    console.assert(
      result.altmanZScore !== null && Math.abs(result.altmanZScore - expectedZ) < 1e-9,
      `Altman Z should be ~${expectedZ}, got ${result.altmanZScore}`
    );

    // Z > 2.6 means safe zone
    console.assert(
      result.altmanZScore !== null && result.altmanZScore > 2.6,
      `Altman Z should be in safe zone, got ${result.altmanZScore}`
    );
  }

  // ── Interest coverage ratio ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('e1', 'Operating Expense', 'expense', 'fixed'),
      mkAccount('int1', 'Interest Expense', 'expense'),
      mkAccount('a1', 'Assets', 'asset', undefined, '1500'),
    ];

    const values = [
      mkVal('r1', 2024, 1, 10000),
      mkVal('e1', 2024, 1, 4000),
      mkVal('int1', 2024, 1, 500),
      mkVal('a1', 2024, 1, 20000),
    ];

    const result = computeHealthScores(accounts, values, { year: 2024, month: 1 });

    // ebit = 10000 - 4000 - 500 = 5500 (interest is included in opex)
    // interest expense = 500
    // interest coverage = 5500 / 500 = 11
    console.assert(
      result.interestCoverageRatio !== null,
      'interestCoverageRatio should not be null'
    );
    // Note: interest expense is part of opex, so ebit includes it
    // interest coverage = operatingIncome / interestExpense
    const expectedICR = (10000 - 4000 - 500) / 500;
    console.assert(
      Math.abs((result.interestCoverageRatio ?? 0) - expectedICR) < 1e-9,
      `interestCoverageRatio should be ${expectedICR}, got ${result.interestCoverageRatio}`
    );
  }

  // ── No interest accounts → null ICR ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('a1', 'Assets', 'asset', undefined, '1500'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 5000),
      mkVal('a1', 2024, 1, 10000),
    ];
    const result = computeHealthScores(accounts, values, { year: 2024, month: 1 });
    console.assert(result.interestCoverageRatio === null, 'ICR should be null when no interest accounts');
  }

  // ── Zero total assets → null Altman Z ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
    ];
    const values = [mkVal('r1', 2024, 1, 5000)];
    const result = computeHealthScores(accounts, values, { year: 2024, month: 1 });
    console.assert(result.altmanZScore === null, 'Altman Z should be null when no assets');
  }

  // ── Empty arrays ──
  {
    const result = computeHealthScores([], [], { year: 2024, month: 1 });
    console.assert(result.altmanZScore === null, 'empty: altmanZScore should be null');
    console.assert(result.interestCoverageRatio === null, 'empty: ICR should be null');
  }

  // ── Series ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('a1', 'Assets', 'asset', undefined, '1500'),
      mkAccount('eq1', 'Equity', 'equity'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 5000),
      mkVal('a1', 2024, 1, 20000),
      mkVal('eq1', 2024, 1, 15000),
      mkVal('r1', 2024, 2, 6000),
      mkVal('a1', 2024, 2, 21000),
      mkVal('eq1', 2024, 2, 16000),
    ];
    const series = computeHealthSeries(accounts, values, 'monthly');
    console.assert(series.length === 2, `series should have 2 entries, got ${series.length}`);
  }

  // ── Altman Z zones ──
  {
    // A distressed company: high liabilities, low equity, negative working capital
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('e1', 'Expenses', 'expense', 'fixed'),
      mkAccount('ca1', 'Cash', 'asset', undefined, '1010'),      // small current asset
      mkAccount('fa1', 'Equipment', 'asset', undefined, '1500'),
      mkAccount('cl1', 'Payable', 'liability', undefined, '2010'),  // large current liab
      mkAccount('ll1', 'Long Term Debt', 'liability', undefined, '2600'),
      mkAccount('eq1', 'Equity', 'equity'),
      mkAccount('re1', 'Retained Earnings', 'equity'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 5000),
      mkVal('e1', 2024, 1, 8000), // loss
      mkVal('ca1', 2024, 1, 500),
      mkVal('fa1', 2024, 1, 5000),
      mkVal('cl1', 2024, 1, 4000),
      mkVal('ll1', 2024, 1, 8000),
      mkVal('eq1', 2024, 1, -4500), // negative retained
      mkVal('re1', 2024, 1, -2000),
    ];
    const result = computeHealthScores(accounts, values, { year: 2024, month: 1 });
    // Z < 1.1 should be distress
    console.assert(
      result.altmanZScore !== null && result.altmanZScore < 1.1,
      `Distressed company Altman Z should be < 1.1, got ${result.altmanZScore}`
    );
  }

  console.log('health tests passed');
}
