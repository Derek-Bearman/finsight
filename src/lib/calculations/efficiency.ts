import type { Account, AccountValue, Period, EfficiencyRatios } from '@/types';
import { aggregateValues, getUniquePeriods, type Granularity } from './period-aggregation';
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
// Account classification helpers
// ─────────────────────────────────────────────

function isInventory(account: Account): boolean {
  if (account.type !== 'asset') return false;
  const num = accountNumber(account);
  if (num !== null && num >= 1300 && num <= 1399) return true;
  return nameContains(account, 'inventory');
}

function isAccountsReceivable(account: Account): boolean {
  if (account.type !== 'asset') return false;
  const num = accountNumber(account);
  if (num !== null && num >= 1100 && num <= 1199) return true;
  return nameContains(account, 'receivable', ' ar', 'accounts receivable');
}

function isAccountsPayable(account: Account): boolean {
  if (account.type !== 'liability') return false;
  const num = accountNumber(account);
  if (num !== null && num >= 2000 && num <= 2099) return true;
  return nameContains(account, 'payable', ' ap', 'accounts payable');
}

function isCurrentAsset(account: Account): boolean {
  if (account.type !== 'asset') return false;
  const num = accountNumber(account);
  if (num !== null && num >= 1000 && num <= 1499) return true;
  return nameContains(account, 'cash', 'checking', 'savings', 'receivable', ' ar', 'inventory', 'prepaid');
}

// ─────────────────────────────────────────────
// Balance at a period (snapshot)
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

/** Average of two values, or single value if prior is undefined */
function avgBalance(current: number, prior?: number): number {
  if (prior === undefined) return current;
  return (current + prior) / 2;
}

/** Days in period based on granularity approximation */
function daysInPeriod(granularity: 'monthly' | 'quarterly' | 'annual' | 'ttm'): number {
  switch (granularity) {
    case 'monthly': return 30;
    case 'quarterly': return 91;
    case 'annual': return 365;
    case 'ttm': return 365;
  }
}

/** Infer granularity from the period type being used */
function inferGranularity(period: Period, priorPeriod?: Period): 'monthly' | 'quarterly' | 'annual' {
  if (priorPeriod === undefined) return 'monthly';
  const monthDiff = (period.year - priorPeriod.year) * 12 + (period.month - priorPeriod.month);
  if (monthDiff >= 11) return 'annual';
  if (monthDiff >= 3) return 'quarterly';
  return 'monthly';
}

// ─────────────────────────────────────────────
// computeEfficiencyRatios
// ─────────────────────────────────────────────

/**
 * Efficiency ratios for a period (annualized where needed).
 *
 * asset turnover = revenue / avg total assets
 * inventory turnover = COGS / avg inventory (null if no inventory)
 * DSO = (avg AR / revenue) * days_in_period
 * DPO = (avg AP / COGS) * days_in_period
 * DIO = (avg inventory / COGS) * days_in_period (null if no inventory)
 * CCC = DSO + DIO - DPO (null if any component null)
 */
export function computeEfficiencyRatios(
  accounts: Account[],
  values: AccountValue[],
  period: Period,
  priorPeriod?: Period,
  granularity?: Granularity
): EfficiencyRatios {
  // Days in period: use the caller-supplied granularity when given — a series
  // knows its own bucket size, and inferring from prior-period spacing would
  // hardcode 30 days for the FIRST bucket of a quarterly/annual series.
  // Inference remains the fallback for direct single-period callers.
  const gran = granularity ?? inferGranularity(period, priorPeriod);
  const days = daysInPeriod(gran);

  // P&L for the period (flow)
  const periodVals = values.filter(v => periodsEqual(v.period, period));
  const pnl = computePnL(accounts, periodVals, period);

  const revenue = pnl.revenue;
  const cogs = pnl.cogs;

  // Balance sheet snapshots
  const totalAssetsCurrent = getAccountBalance(accounts, values, period, a => a.type === 'asset');
  const totalAssetsPrior = priorPeriod
    ? getAccountBalance(accounts, values, priorPeriod, a => a.type === 'asset')
    : undefined;
  const avgTotalAssets = avgBalance(totalAssetsCurrent, totalAssetsPrior);

  const inventoryCurrent = getAccountBalance(accounts, values, period, isInventory);
  const inventoryPrior = priorPeriod
    ? getAccountBalance(accounts, values, priorPeriod, isInventory)
    : undefined;
  const avgInventory = avgBalance(inventoryCurrent, inventoryPrior);

  const arCurrent = getAccountBalance(accounts, values, period, isAccountsReceivable);
  const arPrior = priorPeriod
    ? getAccountBalance(accounts, values, priorPeriod, isAccountsReceivable)
    : undefined;
  const avgAR = avgBalance(arCurrent, arPrior);

  const apCurrent = getAccountBalance(accounts, values, period, isAccountsPayable);
  const apPrior = priorPeriod
    ? getAccountBalance(accounts, values, priorPeriod, isAccountsPayable)
    : undefined;
  const avgAP = avgBalance(apCurrent, apPrior);

  // Ratios
  const assetTurnover = safeDivide(revenue, avgTotalAssets);

  // Inventory turnover: null if no inventory accounts exist. Honor isExcluded
  // (like getAccountBalance) so an excluded-only inventory summary row doesn't
  // make hasInventory true while avgInventory is 0 (which would render DIO=0 and
  // a non-null cash-conversion-cycle instead of null).
  const hasInventory = accounts.some(a => !a.isExcluded && isInventory(a));
  const inventoryTurnover = hasInventory ? safeDivide(cogs, avgInventory) : null;

  // DSO = (avg AR / revenue) * days
  const dso = revenue === 0 ? null : (avgAR / revenue) * days;

  // DPO = (avg AP / cogs) * days
  const dpo = cogs === 0 ? null : (avgAP / cogs) * days;

  // DIO = (avg inventory / cogs) * days
  const dio = !hasInventory ? null : cogs === 0 ? null : (avgInventory / cogs) * days;

  // CCC = DSO + DIO - DPO
  const cashConversionCycle =
    dso !== null && dio !== null && dpo !== null
      ? dso + dio - dpo
      : null;

  return {
    period,
    assetTurnover,
    inventoryTurnover,
    dso,
    dpo,
    dio,
    cashConversionCycle,
  };
}

// ─────────────────────────────────────────────
// computeEfficiencySeries
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

export function computeEfficiencySeries(
  accounts: Account[],
  values: AccountValue[],
  granularity: Granularity
): EfficiencyRatios[] {
  if (values.length === 0) return [];

  // Flows (P&L accounts) sum across a bucket; balance-sheet balances are
  // point-in-time snapshots (stocks) — summing them across a quarter/year
  // would overstate every balance by up to 12x. Stocks instead use the
  // bucket's ENDING balance: the last month in the bucket with BS data.
  const stockTypes = new Set<Account['type']>(['asset', 'liability', 'equity']);
  const stockAccountIds = new Set(accounts.filter(a => stockTypes.has(a.type)).map(a => a.id));
  const flowValues = values.filter(v => !stockAccountIds.has(v.accountId));
  const stockValues = values.filter(v => stockAccountIds.has(v.accountId));
  const aggregatedFlows = aggregateValues(flowValues, granularity);
  const stockMonthKeys = new Set(stockValues.map(v => periodToKey(v.period)));

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
  const bucketArr = Array.from(buckets.values()).sort((a, b) => comparePeriods(a.period, b.period));

  // Ending stock snapshot for a bucket, relabeled to the bucket period.
  function stockSnapshot(bucket: { period: Period; months: Period[] }): AccountValue[] {
    const withStock = bucket.months.filter(m => stockMonthKeys.has(periodToKey(m)));
    if (withStock.length === 0) return [];
    const snapshotMonth = withStock[withStock.length - 1]!;
    return stockValues
      .filter(v => periodsEqual(v.period, snapshotMonth))
      .map(v => ({ ...v, period: bucket.period }));
  }

  return bucketArr.map((bucket, idx) => {
    const priorBucket = idx > 0 ? bucketArr[idx - 1] : undefined;
    const periodFlows = aggregatedFlows.filter(v => periodsEqual(v.period, bucket.period));
    const priorStocks = priorBucket ? stockSnapshot(priorBucket) : [];

    // Joint values array for both periods (for snapshot lookups)
    const jointVals = [...periodFlows, ...stockSnapshot(bucket), ...priorStocks];
    return computeEfficiencyRatios(accounts, jointVals, bucket.period, priorBucket?.period, granularity);
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

  // ── Basic efficiency ratios ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('c1', 'Cost of Goods Sold', 'cogs'),
      mkAccount('ar1', 'Accounts Receivable', 'asset', undefined, '1100'),
      mkAccount('inv1', 'Inventory', 'asset', undefined, '1310'),
      mkAccount('ap1', 'Accounts Payable', 'liability', undefined, '2010'),
      mkAccount('fa1', 'Equipment', 'asset', undefined, '1500'),
    ];

    const values = [
      // Period: Jan 2024
      mkVal('r1', 2024, 1, 12000),
      mkVal('c1', 2024, 1, 6000),
      mkVal('ar1', 2024, 1, 3000),
      mkVal('inv1', 2024, 1, 2000),
      mkVal('ap1', 2024, 1, 1500),
      mkVal('fa1', 2024, 1, 10000),
      // Prior period: Dec 2023
      mkVal('ar1', 2023, 12, 2000),
      mkVal('inv1', 2023, 12, 1800),
      mkVal('ap1', 2023, 12, 1200),
      mkVal('fa1', 2023, 12, 10000),
    ];

    const result = computeEfficiencyRatios(
      accounts,
      values,
      { year: 2024, month: 1 },
      { year: 2023, month: 12 }
    );

    // avg total assets = (3000 + 2000 + 10000 + 2000 + 1800 + 10000) / 2 = (15000 + 13800) / 2 = 14400
    // asset turnover = 12000 / 14400 ≈ 0.833
    const expectedAssetTurnover = 12000 / 14400;
    console.assert(
      result.assetTurnover !== null && Math.abs(result.assetTurnover - expectedAssetTurnover) < 1e-9,
      `assetTurnover should be ~${expectedAssetTurnover}, got ${result.assetTurnover}`
    );

    // avg inventory = (2000 + 1800) / 2 = 1900
    // inventory turnover = 6000 / 1900 ≈ 3.158
    const expectedInvTurnover = 6000 / 1900;
    console.assert(
      result.inventoryTurnover !== null && Math.abs(result.inventoryTurnover - expectedInvTurnover) < 1e-9,
      `inventoryTurnover should be ~${expectedInvTurnover}, got ${result.inventoryTurnover}`
    );

    // avg AR = (3000 + 2000) / 2 = 2500; DSO = (2500 / 12000) * 30 = 6.25
    const expectedDSO = (2500 / 12000) * 30;
    console.assert(
      result.dso !== null && Math.abs(result.dso - expectedDSO) < 1e-9,
      `DSO should be ~${expectedDSO}, got ${result.dso}`
    );
  }

  // ── No inventory → null inventory turnover and DIO ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('c1', 'COGS', 'cogs'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 5000),
      mkVal('c1', 2024, 1, 2000),
    ];
    const result = computeEfficiencyRatios(accounts, values, { year: 2024, month: 1 });
    console.assert(result.inventoryTurnover === null, 'inventoryTurnover should be null when no inventory');
    console.assert(result.dio === null, 'DIO should be null when no inventory');
  }

  // ── Zero revenue → null DSO ──
  {
    const accounts = [
      mkAccount('ar1', 'Accounts Receivable', 'asset', undefined, '1100'),
    ];
    const values = [mkVal('ar1', 2024, 1, 1000)];
    const result = computeEfficiencyRatios(accounts, values, { year: 2024, month: 1 });
    console.assert(result.dso === null, 'DSO should be null when revenue is 0');
  }

  // ── Empty arrays ──
  {
    const result = computeEfficiencyRatios([], [], { year: 2024, month: 1 });
    console.assert(result.assetTurnover === null, 'empty: assetTurnover should be null');
    console.assert(result.inventoryTurnover === null, 'empty: inventoryTurnover should be null');
  }

  // ── CCC: null when a component is null ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      // No AR, AP, or inventory
    ];
    const values = [mkVal('r1', 2024, 1, 5000)];
    const result = computeEfficiencyRatios(accounts, values, { year: 2024, month: 1 });
    console.assert(result.cashConversionCycle === null, 'CCC should be null when components are null');
  }

  // ── Single period (no prior): uses single value ──
  {
    const accounts = [
      mkAccount('r1', 'Revenue', 'revenue'),
      mkAccount('fa1', 'Equipment', 'asset', undefined, '1500'),
    ];
    const values = [
      mkVal('r1', 2024, 1, 6000),
      mkVal('fa1', 2024, 1, 3000),
    ];
    const result = computeEfficiencyRatios(accounts, values, { year: 2024, month: 1 });
    // avg total assets = 3000 (no prior); asset turnover = 6000/3000 = 2
    console.assert(
      result.assetTurnover !== null && Math.abs(result.assetTurnover - 2) < 1e-9,
      `assetTurnover with no prior should be 2, got ${result.assetTurnover}`
    );
  }

  console.log('efficiency tests passed');
}
