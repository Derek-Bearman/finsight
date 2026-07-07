import type { Account, AccountValue, Period } from '@/types';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type Granularity = 'monthly' | 'quarterly' | 'annual' | 'ttm';

export interface YoYComparison {
  period: Period;
  amount: number;
  priorAmount: number;
  absoluteChange: number;
  percentChange: number | null; // null if priorAmount === 0
}

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

/** Return the calendar quarter (1–4) for a given month */
function getQuarter(month: number): number {
  return Math.ceil(month / 3);
}

/** Return the first month of a quarter (1, 4, 7, or 10) */
function quarterStartMonth(month: number): number {
  return (getQuarter(month) - 1) * 3 + 1;
}

// ─────────────────────────────────────────────
// aggregateValues
// ─────────────────────────────────────────────

/**
 * Given a flat array of AccountValue (monthly), group and sum them
 * by the requested granularity. Returns one entry per period.
 *
 * For 'monthly' — pass through unchanged.
 * For 'quarterly' — aggregate months into their calendar quarter.
 *   Period returned = first month of the quarter (e.g. Jan, Apr, Jul, Oct).
 * For 'annual' — aggregate all months in each calendar year.
 *   Period returned = { year, month: 1 }.
 * For 'ttm' — trailing 12 months from the most recent period.
 *   Returns a single entry with period = most recent period.
 */
export function aggregateValues(
  values: AccountValue[],
  granularity: Granularity
): AccountValue[] {
  if (values.length === 0) return [];

  if (granularity === 'monthly') {
    return values.slice();
  }

  if (granularity === 'ttm') {
    // Find the most recent period
    const sorted = values.slice().sort((a, b) => comparePeriods(a.period, b.period));
    const mostRecent = sorted[sorted.length - 1]!.period;

    // Build a set of the trailing 12 months
    const trailingPeriods = new Set<string>();
    for (let i = 0; i < 12; i++) {
      let month = mostRecent.month - i;
      let year = mostRecent.year;
      while (month <= 0) {
        month += 12;
        year -= 1;
      }
      trailingPeriods.add(periodToKey({ year, month }));
    }

    // Group by accountId, sum only the trailing 12 months
    const byAccount = new Map<string, number>();
    for (const v of values) {
      if (trailingPeriods.has(periodToKey(v.period))) {
        byAccount.set(v.accountId, (byAccount.get(v.accountId) ?? 0) + v.amount);
      }
    }

    return Array.from(byAccount.entries()).map(([accountId, amount]) => ({
      accountId,
      period: mostRecent,
      amount,
    }));
  }

  // quarterly or annual: group by (accountId, bucketKey)
  type BucketKey = string;
  const buckets = new Map<BucketKey, { period: Period; amounts: Map<string, number> }>();

  for (const v of values) {
    let bucketPeriod: Period;
    if (granularity === 'quarterly') {
      bucketPeriod = { year: v.period.year, month: quarterStartMonth(v.period.month) };
    } else {
      // annual
      bucketPeriod = { year: v.period.year, month: 1 };
    }

    const bk = `${v.accountId}::${periodToKey(bucketPeriod)}`;
    if (!buckets.has(bk)) {
      buckets.set(bk, { period: bucketPeriod, amounts: new Map() });
    }
    const bucket = buckets.get(bk)!;
    bucket.amounts.set(v.accountId, (bucket.amounts.get(v.accountId) ?? 0) + v.amount);
  }

  // Flatten
  const result: AccountValue[] = [];
  for (const [bk, { period, amounts }] of buckets) {
    const accountId = bk.split('::')[0]!;
    const amount = amounts.get(accountId) ?? 0;
    result.push({ accountId, period, amount });
  }

  result.sort((a, b) => comparePeriods(a.period, b.period));
  return result;
}

/**
 * Like aggregateValues, but treats balance-sheet accounts (asset/liability/
 * equity) as point-in-time stocks: each quarterly/annual/ttm bucket reports
 * the ENDING balance (last month in the bucket with BS data, relabeled to the
 * bucket period) instead of summing months — summing overstates balances by
 * up to 12x. P&L flows aggregate exactly as aggregateValues does.
 */
export function aggregateValuesStockAware(
  accounts: Account[],
  values: AccountValue[],
  granularity: Granularity
): AccountValue[] {
  if (values.length === 0) return [];
  if (granularity === 'monthly') return values.slice();

  const stockTypes = new Set<Account['type']>(['asset', 'liability', 'equity']);
  const stockIds = new Set(accounts.filter(a => stockTypes.has(a.type)).map(a => a.id));
  const flows = values.filter(v => !stockIds.has(v.accountId));
  const stocks = values.filter(v => stockIds.has(v.accountId));
  const aggregatedFlows = aggregateValues(flows, granularity);
  if (stocks.length === 0) return aggregatedFlows;

  const sortedAll = values.slice().sort((a, b) => comparePeriods(a.period, b.period));
  const mostRecent = sortedAll[sortedAll.length - 1]!.period;
  const bucketPeriodFor = (p: Period): Period => {
    if (granularity === 'quarterly') return { year: p.year, month: quarterStartMonth(p.month) };
    if (granularity === 'annual') return { year: p.year, month: 1 };
    return mostRecent; // ttm
  };

  // Per bucket, find the last month with stock data; emit that month's stock
  // rows relabeled to the bucket period.
  const endingMonthByBucket = new Map<string, Period>();
  for (const v of stocks) {
    if (granularity === 'ttm' && comparePeriods(v.period, mostRecent) > 0) continue;
    const bk = periodToKey(bucketPeriodFor(v.period));
    const cur = endingMonthByBucket.get(bk);
    if (!cur || comparePeriods(v.period, cur) > 0) endingMonthByBucket.set(bk, v.period);
  }
  const snapshots: AccountValue[] = [];
  for (const [bk, endingMonth] of endingMonthByBucket) {
    const bucketPeriod = bucketPeriodFor(endingMonth);
    if (periodToKey(bucketPeriod) !== bk) continue; // defensive; keys always match
    for (const v of stocks) {
      if (periodsEqual(v.period, endingMonth)) snapshots.push({ ...v, period: bucketPeriod });
    }
  }

  const result = [...aggregatedFlows, ...snapshots];
  result.sort((a, b) => comparePeriods(a.period, b.period));
  return result;
}

// ─────────────────────────────────────────────
// computeYoY
// ─────────────────────────────────────────────

/**
 * For a single account (or multiple accounts combined), compute year-over-year change.
 * Returns array of { period, amount, priorAmount, absoluteChange, percentChange }
 * Only returns periods that have a matching period one year prior.
 */
export function computeYoY(values: AccountValue[]): YoYComparison[] {
  if (values.length === 0) return [];

  // Sum amounts by period (handles multiple accounts)
  const byPeriod = new Map<string, { period: Period; amount: number }>();
  for (const v of values) {
    const key = periodToKey(v.period);
    if (!byPeriod.has(key)) {
      byPeriod.set(key, { period: { ...v.period }, amount: 0 });
    }
    byPeriod.get(key)!.amount += v.amount;
  }

  const results: YoYComparison[] = [];

  for (const { period, amount } of byPeriod.values()) {
    const priorPeriodKey = periodToKey({ year: period.year - 1, month: period.month });
    const prior = byPeriod.get(priorPeriodKey);
    if (prior === undefined) continue;

    const absoluteChange = amount - prior.amount;
    const percentChange = prior.amount === 0 ? null : absoluteChange / prior.amount;

    results.push({
      period,
      amount,
      priorAmount: prior.amount,
      absoluteChange,
      percentChange,
    });
  }

  results.sort((a, b) => comparePeriods(a.period, b.period));
  return results;
}

// ─────────────────────────────────────────────
// getUniquePeriods
// ─────────────────────────────────────────────

/**
 * Given a set of AccountValues (multiple accounts, multiple periods),
 * return the set of unique periods sorted chronologically.
 */
export function getUniquePeriods(values: AccountValue[]): Period[] {
  const seen = new Map<string, Period>();
  for (const v of values) {
    const key = periodToKey(v.period);
    if (!seen.has(key)) {
      seen.set(key, { ...v.period });
    }
  }
  return Array.from(seen.values()).sort(comparePeriods);
}

// ─────────────────────────────────────────────
// getTrailingPeriods
// ─────────────────────────────────────────────

/**
 * Return the trailing N months of periods from the most recent period in the dataset.
 */
export function getTrailingPeriods(values: AccountValue[], n: number): Period[] {
  if (values.length === 0 || n <= 0) return [];

  const unique = getUniquePeriods(values);
  if (unique.length === 0) return [];

  // Take last n periods
  return unique.slice(-n);
}

// ─────────────────────────────────────────────
// Unit Tests
// ─────────────────────────────────────────────

export function runTests(): void {
  // ── aggregateValues: monthly passthrough ──
  {
    const vals: AccountValue[] = [
      { accountId: 'a1', period: { year: 2024, month: 1 }, amount: 100 },
      { accountId: 'a1', period: { year: 2024, month: 2 }, amount: 200 },
    ];
    const result = aggregateValues(vals, 'monthly');
    console.assert(result.length === 2, 'monthly passthrough should return 2 entries');
    console.assert(result[0]!.amount === 100, 'first month should be 100');
    console.assert(result[1]!.amount === 200, 'second month should be 200');
  }

  // ── aggregateValues: empty array ──
  {
    const result = aggregateValues([], 'quarterly');
    console.assert(result.length === 0, 'empty array should return empty');
  }

  // ── aggregateValues: quarterly ──
  {
    const vals: AccountValue[] = [
      { accountId: 'a1', period: { year: 2024, month: 1 }, amount: 100 },
      { accountId: 'a1', period: { year: 2024, month: 2 }, amount: 200 },
      { accountId: 'a1', period: { year: 2024, month: 3 }, amount: 300 },
      { accountId: 'a1', period: { year: 2024, month: 4 }, amount: 50 },
    ];
    const result = aggregateValues(vals, 'quarterly');
    console.assert(result.length === 2, `quarterly should return 2 entries, got ${result.length}`);
    const q1 = result.find(r => r.period.month === 1);
    const q2 = result.find(r => r.period.month === 4);
    console.assert(q1 !== undefined, 'Q1 entry should exist');
    console.assert(q1!.amount === 600, `Q1 sum should be 600, got ${q1!.amount}`);
    console.assert(q2 !== undefined, 'Q2 entry should exist');
    console.assert(q2!.amount === 50, `Q2 sum should be 50, got ${q2!.amount}`);
  }

  // ── aggregateValues: annual ──
  {
    const vals: AccountValue[] = [
      { accountId: 'a1', period: { year: 2023, month: 11 }, amount: 100 },
      { accountId: 'a1', period: { year: 2023, month: 12 }, amount: 200 },
      { accountId: 'a1', period: { year: 2024, month: 1 }, amount: 50 },
    ];
    const result = aggregateValues(vals, 'annual');
    console.assert(result.length === 2, `annual should return 2 entries, got ${result.length}`);
    const yr2023 = result.find(r => r.period.year === 2023);
    console.assert(yr2023 !== undefined, '2023 entry should exist');
    console.assert(yr2023!.amount === 300, `2023 sum should be 300, got ${yr2023!.amount}`);
    console.assert(yr2023!.period.month === 1, '2023 period should have month=1');
  }

  // ── aggregateValues: ttm ──
  {
    const vals: AccountValue[] = [];
    // 14 months of data
    for (let m = 1; m <= 12; m++) {
      vals.push({ accountId: 'a1', period: { year: 2023, month: m }, amount: 10 });
    }
    vals.push({ accountId: 'a1', period: { year: 2024, month: 1 }, amount: 10 });
    vals.push({ accountId: 'a1', period: { year: 2024, month: 2 }, amount: 10 });

    const result = aggregateValues(vals, 'ttm');
    console.assert(result.length === 1, `ttm should return 1 entry, got ${result.length}`);
    console.assert(result[0]!.amount === 120, `ttm sum should be 120, got ${result[0]!.amount}`);
    console.assert(
      periodsEqual(result[0]!.period, { year: 2024, month: 2 }),
      'ttm period should be most recent'
    );
  }

  // ── computeYoY: basic ──
  {
    const vals: AccountValue[] = [
      { accountId: 'a1', period: { year: 2023, month: 3 }, amount: 100 },
      { accountId: 'a1', period: { year: 2024, month: 3 }, amount: 150 },
      { accountId: 'a1', period: { year: 2024, month: 4 }, amount: 200 }, // no prior
    ];
    const result = computeYoY(vals);
    console.assert(result.length === 1, `YoY should return 1 entry (only one period has prior)`);
    console.assert(result[0]!.amount === 150, 'current amount should be 150');
    console.assert(result[0]!.priorAmount === 100, 'prior amount should be 100');
    console.assert(result[0]!.absoluteChange === 50, 'absolute change should be 50');
    console.assert(
      Math.abs((result[0]!.percentChange ?? 0) - 0.5) < 1e-9,
      `percent change should be 0.5, got ${result[0]!.percentChange}`
    );
  }

  // ── computeYoY: zero prior ──
  {
    const vals: AccountValue[] = [
      { accountId: 'a1', period: { year: 2023, month: 1 }, amount: 0 },
      { accountId: 'a1', period: { year: 2024, month: 1 }, amount: 100 },
    ];
    const result = computeYoY(vals);
    console.assert(result[0]!.percentChange === null, 'percentChange should be null when prior is 0');
  }

  // ── computeYoY: empty ──
  {
    const result = computeYoY([]);
    console.assert(result.length === 0, 'empty array should return empty');
  }

  // ── getUniquePeriods ──
  {
    const vals: AccountValue[] = [
      { accountId: 'a1', period: { year: 2024, month: 2 }, amount: 1 },
      { accountId: 'a2', period: { year: 2024, month: 2 }, amount: 2 },
      { accountId: 'a1', period: { year: 2024, month: 1 }, amount: 3 },
    ];
    const result = getUniquePeriods(vals);
    console.assert(result.length === 2, 'should return 2 unique periods');
    console.assert(result[0]!.month === 1, 'first period should be Jan');
    console.assert(result[1]!.month === 2, 'second period should be Feb');
  }

  // ── getTrailingPeriods ──
  {
    const vals: AccountValue[] = [
      { accountId: 'a1', period: { year: 2024, month: 1 }, amount: 1 },
      { accountId: 'a1', period: { year: 2024, month: 2 }, amount: 2 },
      { accountId: 'a1', period: { year: 2024, month: 3 }, amount: 3 },
    ];
    const result = getTrailingPeriods(vals, 2);
    console.assert(result.length === 2, 'should return 2 trailing periods');
    console.assert(result[0]!.month === 2, 'first trailing period should be Feb');
    console.assert(result[1]!.month === 3, 'second trailing period should be Mar');
  }

  // ── getTrailingPeriods: empty ──
  {
    const result = getTrailingPeriods([], 3);
    console.assert(result.length === 0, 'empty array should return empty');
  }

  // ── getTrailingPeriods: n=0 ──
  {
    const vals: AccountValue[] = [
      { accountId: 'a1', period: { year: 2024, month: 1 }, amount: 1 },
    ];
    const result = getTrailingPeriods(vals, 0);
    console.assert(result.length === 0, 'n=0 should return empty');
  }

  console.log('period-aggregation tests passed');
}
