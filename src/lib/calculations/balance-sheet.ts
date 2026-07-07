import type { Account, AccountValue, Period, BalanceSheetRatios } from '@/types';
import { getUniquePeriods, type Granularity } from './period-aggregation';

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

function accountNumber(account: Account): number | null {
  if (!account.number) return null;
  const n = parseInt(account.number, 10);
  return isNaN(n) ? null : n;
}

function nameContains(account: Account, ...keywords: string[]): boolean {
  const name = account.name.toLowerCase();
  return keywords.some(kw => name.includes(kw.toLowerCase()));
}

// ─────────────────────────────────────────────
// Balance sheet account classification
// ─────────────────────────────────────────────

/**
 * Current assets: asset accounts with names containing cash, checking, savings,
 * receivable, ar, inventory, prepaid, or account numbers 1000-1499
 */
function isCurrentAsset(account: Account): boolean {
  if (account.type !== 'asset') return false;
  const num = accountNumber(account);
  if (num !== null && num >= 1000 && num <= 1499) return true;
  return nameContains(account, 'cash', 'checking', 'savings', 'receivable', ' ar', 'inventory', 'prepaid');
}

/**
 * Cash: asset accounts with names containing cash, checking, savings, or 1000-1099
 */
function isCash(account: Account): boolean {
  if (account.type !== 'asset') return false;
  const num = accountNumber(account);
  if (num !== null && num >= 1000 && num <= 1099) return true;
  return nameContains(account, 'cash', 'checking', 'savings');
}

/**
 * Inventory: asset accounts with names containing inventory or 1300-1399
 */
function isInventory(account: Account): boolean {
  if (account.type !== 'asset') return false;
  const num = accountNumber(account);
  if (num !== null && num >= 1300 && num <= 1399) return true;
  return nameContains(account, 'inventory');
}

/**
 * Current liabilities: liability accounts with names containing payable, ap, accrued,
 * credit card, or account numbers 2000-2499
 */
function isCurrentLiability(account: Account): boolean {
  if (account.type !== 'liability') return false;
  const num = accountNumber(account);
  if (num !== null && num >= 2000 && num <= 2499) return true;
  return nameContains(account, 'payable', ' ap', 'accrued', 'credit card');
}

// ─────────────────────────────────────────────
// computeBalanceSheetRatios
// ─────────────────────────────────────────────

/**
 * Compute balance sheet ratios for a single period.
 * Balance sheet is a snapshot — use account values at the specific period date.
 */
export function computeBalanceSheetRatios(
  accounts: Account[],
  values: AccountValue[],
  period: Period
): BalanceSheetRatios {
  // Filter values to the given period
  const periodValues = values.filter(v => periodsEqual(v.period, period));

  // Build amount map
  const amountByAccount = new Map<string, number>();
  for (const v of periodValues) {
    amountByAccount.set(v.accountId, (amountByAccount.get(v.accountId) ?? 0) + v.amount);
  }

  function getAmount(acc: Account): number {
    return amountByAccount.get(acc.id) ?? 0;
  }

  function sumAccounts(filter: (a: Account) => boolean): number {
    // Excluded rows (QBO summary/check rows, manual exclusions) never count.
    return accounts.filter(a => !a.isExcluded && filter(a)).reduce((s, a) => s + getAmount(a), 0);
  }

  const currentAssets = sumAccounts(isCurrentAsset);
  const nonCurrentAssets = sumAccounts(a => a.type === 'asset' && !isCurrentAsset(a));
  const totalAssets = currentAssets + nonCurrentAssets;

  const cash = sumAccounts(isCash);
  const inventory = sumAccounts(isInventory);

  const currentLiabilities = sumAccounts(isCurrentLiability);
  const longTermLiabilities = sumAccounts(a => a.type === 'liability' && !isCurrentLiability(a));
  const totalLiabilities = currentLiabilities + longTermLiabilities;

  const totalEquity = sumAccounts(a => a.type === 'equity');

  // Ratios
  const currentRatio = safeDivide(currentAssets, currentLiabilities);
  const quickRatio = safeDivide(currentAssets - inventory, currentLiabilities);
  const cashRatio = safeDivide(cash, currentLiabilities);
  const debtToEquity = safeDivide(totalLiabilities, totalEquity);
  const debtToAssets = safeDivide(totalLiabilities, totalAssets);
  const workingCapital: number | null = currentLiabilities === 0 && currentAssets === 0
    ? null
    : currentAssets - currentLiabilities;

  return {
    period,
    currentRatio,
    quickRatio,
    cashRatio,
    debtToEquity,
    debtToAssets,
    workingCapital,
  };
}

// ─────────────────────────────────────────────
// computeBalanceSheetSeries
// ─────────────────────────────────────────────

/**
 * Map a monthly period to its bucket period, matching aggregateValues:
 * quarterly → first month of the quarter, annual → month 1, ttm → the most
 * recent period, monthly → itself.
 */
function bucketPeriodFor(p: Period, granularity: Granularity, mostRecent: Period): Period {
  switch (granularity) {
    case 'monthly': return p;
    case 'quarterly': return { year: p.year, month: (Math.ceil(p.month / 3) - 1) * 3 + 1 };
    case 'annual': return { year: p.year, month: 1 };
    case 'ttm': return mostRecent;
  }
}

export function computeBalanceSheetSeries(
  accounts: Account[],
  values: AccountValue[],
  granularity: Granularity
): BalanceSheetRatios[] {
  if (values.length === 0) return [];

  // Balance sheet balances are point-in-time snapshots (stocks), not flows —
  // summing a bucket's monthly balances would overstate them by up to 12x.
  // Each quarterly/annual bucket instead reports its ENDING balance: the last
  // month in the bucket that has balance-sheet data (the same rule the
  // Statements view uses for balance-sheet columns).
  const stockTypes = new Set<Account['type']>(['asset', 'liability', 'equity']);
  const stockAccountIds = new Set(accounts.filter(a => stockTypes.has(a.type)).map(a => a.id));
  const stockMonthKeys = new Set(
    values.filter(v => stockAccountIds.has(v.accountId)).map(v => periodToKey(v.period))
  );

  // Buckets derive from ALL monthly periods so the series keeps the same
  // period set (and count) as the flow-based series rendered alongside it.
  const months = getUniquePeriods(values);
  const mostRecent = months[months.length - 1]!;
  const buckets = new Map<string, { period: Period; months: Period[] }>();
  for (const m of months) {
    const bucketPeriod = bucketPeriodFor(m, granularity, mostRecent);
    const k = periodToKey(bucketPeriod);
    if (!buckets.has(k)) buckets.set(k, { period: bucketPeriod, months: [] });
    buckets.get(k)!.months.push(m);
  }

  return Array.from(buckets.values())
    .sort((a, b) => comparePeriods(a.period, b.period))
    .map(({ period, months: bucketMonths }) => {
      // Months arrive sorted from getUniquePeriods; take the last one with
      // balance-sheet data (fall back to the bucket's last month so buckets
      // without BS data still emit a row of null ratios).
      const withStock = bucketMonths.filter(m => stockMonthKeys.has(periodToKey(m)));
      const snapshotMonth = (withStock.length > 0 ? withStock : bucketMonths).slice(-1)[0]!;
      const snapshotVals = values
        .filter(v => periodsEqual(v.period, snapshotMonth))
        .map(v => ({ ...v, period }));
      return computeBalanceSheetRatios(accounts, snapshotVals, period);
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
    number?: string
  ): Account => ({
    id,
    name,
    type,
    number,
    isManuallyClassified: false,
  });

  const mkVal = (accountId: string, year: number, month: number, amount: number): AccountValue => ({
    accountId,
    period: { year, month },
    amount,
  });

  // ── Basic ratios ──
  {
    const accounts = [
      mkAccount('ca1', 'Cash', 'asset', '1010'),
      mkAccount('ca2', 'Accounts Receivable', 'asset', '1200'),
      mkAccount('ca3', 'Inventory', 'asset', '1310'),
      mkAccount('fa1', 'Equipment', 'asset', '1500'),
      mkAccount('cl1', 'Accounts Payable', 'liability', '2100'),
      mkAccount('ll1', 'Long Term Debt', 'liability', '2600'),
      mkAccount('eq1', 'Common Stock', 'equity'),
    ];
    const values = [
      mkVal('ca1', 2024, 1, 10000),  // cash
      mkVal('ca2', 2024, 1, 5000),   // AR
      mkVal('ca3', 2024, 1, 3000),   // inventory
      mkVal('fa1', 2024, 1, 20000),  // fixed asset
      mkVal('cl1', 2024, 1, 8000),   // current liability
      mkVal('ll1', 2024, 1, 12000),  // long-term liability
      mkVal('eq1', 2024, 1, 18000),  // equity
    ];

    const result = computeBalanceSheetRatios(accounts, values, { year: 2024, month: 1 });

    // currentAssets = 10000 + 5000 + 3000 = 18000
    // currentRatio = 18000 / 8000 = 2.25
    console.assert(
      Math.abs((result.currentRatio ?? 0) - 2.25) < 1e-9,
      `currentRatio should be 2.25, got ${result.currentRatio}`
    );

    // quickRatio = (18000 - 3000) / 8000 = 15000 / 8000 = 1.875
    console.assert(
      Math.abs((result.quickRatio ?? 0) - 1.875) < 1e-9,
      `quickRatio should be 1.875, got ${result.quickRatio}`
    );

    // cashRatio = 10000 / 8000 = 1.25
    console.assert(
      Math.abs((result.cashRatio ?? 0) - 1.25) < 1e-9,
      `cashRatio should be 1.25, got ${result.cashRatio}`
    );

    // totalLiabilities = 8000 + 12000 = 20000
    // debtToEquity = 20000 / 18000 ≈ 1.111
    console.assert(
      result.debtToEquity !== null,
      'debtToEquity should not be null'
    );
    console.assert(
      Math.abs((result.debtToEquity ?? 0) - (20000 / 18000)) < 1e-9,
      `debtToEquity should be ${20000 / 18000}, got ${result.debtToEquity}`
    );

    // totalAssets = 18000 + 20000 = 38000
    // debtToAssets = 20000 / 38000
    console.assert(
      Math.abs((result.debtToAssets ?? 0) - (20000 / 38000)) < 1e-9,
      `debtToAssets should be ${20000 / 38000}, got ${result.debtToAssets}`
    );

    // workingCapital = 18000 - 8000 = 10000
    console.assert(
      result.workingCapital === 10000,
      `workingCapital should be 10000, got ${result.workingCapital}`
    );
  }

  // ── Zero current liabilities → null ratios ──
  {
    const accounts = [
      mkAccount('ca1', 'Cash', 'asset', '1010'),
      mkAccount('eq1', 'Equity', 'equity'),
    ];
    const values = [
      mkVal('ca1', 2024, 1, 5000),
      mkVal('eq1', 2024, 1, 5000),
    ];
    const result = computeBalanceSheetRatios(accounts, values, { year: 2024, month: 1 });
    console.assert(result.currentRatio === null, 'currentRatio should be null when no current liabilities');
    console.assert(result.quickRatio === null, 'quickRatio should be null when no current liabilities');
    console.assert(result.cashRatio === null, 'cashRatio should be null when no current liabilities');
    console.assert(result.debtToEquity === 0, 'debtToEquity should be 0 when no liabilities (0/equity)');
  }

  // ── Empty arrays ──
  {
    const result = computeBalanceSheetRatios([], [], { year: 2024, month: 1 });
    console.assert(result.currentRatio === null, 'empty: currentRatio should be null');
    console.assert(result.workingCapital === null, 'empty: workingCapital should be null');
  }

  // ── Name-based classification ──
  {
    const accounts = [
      mkAccount('ca1', 'Checking Account', 'asset'),       // cash by name
      mkAccount('ca2', 'Prepaid Insurance', 'asset'),      // current asset by name
      mkAccount('cl1', 'Accrued Wages', 'liability'),      // current liability by name
      mkAccount('cl2', 'Credit Card Balance', 'liability'),// current liability by name
    ];
    const values = [
      mkVal('ca1', 2024, 1, 2000),
      mkVal('ca2', 2024, 1, 500),
      mkVal('cl1', 2024, 1, 800),
      mkVal('cl2', 2024, 1, 200),
    ];
    const result = computeBalanceSheetRatios(accounts, values, { year: 2024, month: 1 });
    // currentAssets = 2000 + 500 = 2500
    // currentLiabilities = 800 + 200 = 1000
    console.assert(
      Math.abs((result.currentRatio ?? 0) - 2.5) < 1e-9,
      `currentRatio should be 2.5, got ${result.currentRatio}`
    );
  }

  // ── Series ──
  {
    const accounts = [
      mkAccount('ca1', 'Cash', 'asset', '1010'),
      mkAccount('cl1', 'Payable', 'liability', '2100'),
    ];
    const values = [
      mkVal('ca1', 2024, 1, 1000),
      mkVal('cl1', 2024, 1, 500),
      mkVal('ca1', 2024, 2, 1200),
      mkVal('cl1', 2024, 2, 600),
    ];
    const series = computeBalanceSheetSeries(accounts, values, 'monthly');
    console.assert(series.length === 2, `series should have 2 entries, got ${series.length}`);
  }

  console.log('balance-sheet tests passed');
}
