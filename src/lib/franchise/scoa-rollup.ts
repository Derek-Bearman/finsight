/**
 * Corporate SCOA roll-up (SCOA_ROLLUP_PLAN.md, Phase 1).
 *
 * Folds a franchisee's granular chart into the franchisor's corporate lines by
 * summing every client account that shares a `scoaNumber` into that one line —
 * the many-to-one that `auditScoa` (1-to-1) does not do. Excluded accounts are
 * skipped (same rule as computePnL's sumByType). Accounts with no `scoaNumber`
 * fall into an "unmapped" bucket. Pure, no I/O, no React.
 *
 * `scoaLineSnapshot` is the per-franchisee comparable used by the corporate-line
 * comparison: each SCOA line's rolled-up dollars plus its share of revenue (the
 * size-neutral normalizer for cross-franchisee comparison).
 */

import type { Account, AccountValue, FranchiseScoaAccount, Period } from '@/types';
import { median } from '@/lib/franchise/peer-metrics';

const periodKey = (p: Period) => `${p.year}-${p.month}`;
const comparePeriods = (a: Period, b: Period) =>
  a.year !== b.year ? a.year - b.year : a.month - b.month;

/** Balance-sheet (stock) account types — point-in-time balances, not flows. */
const STOCK_TYPES = new Set<Account['type']>(['asset', 'liability', 'equity']);

function pushInto(map: Map<string, Account[]>, key: string, a: Account): void {
  const list = map.get(key);
  if (list) list.push(a);
  else map.set(key, [a]);
}

/**
 * Per-account amount over the requested periods (non-excluded only).
 *
 * FLOW accounts (revenue/cogs/expense) SUM across the window. STOCK accounts
 * (asset/liability/equity) are point-in-time balances — summing them across a
 * 12-month window overstates them ~12x — so they use the ENDING balance at a
 * SINGLE GLOBAL ending month (the latest in-window period with ANY stock data),
 * exactly like computeBalanceSheetSeries: a stock account with no row at that
 * month contributes 0. This keeps the SCOA comparison consistent with the
 * franchisee's own balance sheet.
 */
function perAccountTotals(
  accounts: Account[],
  values: AccountValue[],
  periods: Period[]
): Map<string, number> {
  const keys = new Set(periods.map(periodKey));
  const byId = new Map<string, Account>();
  for (const a of accounts) if (!a.isExcluded) byId.set(a.id, a);

  // Pass 1: the single global ending month = latest in-window period with ANY
  // stock (asset/liability/equity) data.
  let stockEnd: Period | null = null;
  for (const v of values) {
    const acct = byId.get(v.accountId);
    if (!acct || !STOCK_TYPES.has(acct.type)) continue;
    if (!keys.has(periodKey(v.period))) continue;
    if (!stockEnd || comparePeriods(v.period, stockEnd) > 0) stockEnd = v.period;
  }

  // Pass 2: sum flows across the window; for stocks add only the global ending month.
  const totals = new Map<string, number>();
  for (const v of values) {
    const acct = byId.get(v.accountId);
    if (!acct) continue;
    if (!keys.has(periodKey(v.period))) continue;
    if (STOCK_TYPES.has(acct.type)) {
      if (!stockEnd || v.period.year !== stockEnd.year || v.period.month !== stockEnd.month) continue;
    }
    totals.set(v.accountId, (totals.get(v.accountId) ?? 0) + v.amount);
  }
  return totals;
}

export interface ScoaLineRollup {
  number: string;
  name: string;
  statementType?: 'pnl' | 'balance';
  /** Client account ids folded into this corporate line. */
  accountIds: string[];
  /** Client account names, for the expandable "what rolls up here" UI. */
  accountNames: string[];
  /** Summed amount over the requested periods. */
  total: number;
}

export interface ScoaRollupResult {
  /** One entry per corporate SCOA account, in SCOA order. */
  lines: ScoaLineRollup[];
  unmappedTotal: number;
  unmappedAccountIds: string[];
  unmappedAccountNames: string[];
  /** Non-excluded accounts carrying a scoaNumber. */
  mappedAccountCount: number;
  /** Non-excluded accounts total (the denominator for coverage). */
  mappableAccountCount: number;
  /** mappedAccountCount / mappableAccountCount, 0..1. */
  coveragePct: number;
  /** Revenue over the periods (sum of revenue-type accounts), for % normalizing. */
  revenueTotal: number;
}

/**
 * Roll a workspace's accounts up into the corporate SCOA lines by `scoaNumber`.
 * Many client accounts → one line. Unmapped/excluded handled explicitly.
 */
export function rollupByScoa(
  scoaAccounts: FranchiseScoaAccount[],
  accounts: Account[],
  values: AccountValue[],
  periods: Period[]
): ScoaRollupResult {
  const totals = perAccountTotals(accounts, values, periods);
  const nonExcluded = accounts.filter((a) => !a.isExcluded);

  // Valid corporate line numbers. An account whose scoaNumber matches none of
  // them (a stale mapping left after the SCOA was re-uploaded or renumbered) is
  // treated as UNMAPPED, so its dollars stay in the reconciliation (the unmapped
  // bucket) and coverage never credits a mapping that lands in no line.
  const validNumbers = new Set(scoaAccounts.map((s) => s.number.trim()));
  const byScoa = new Map<string, Account[]>();
  const unmapped: Account[] = [];
  for (const a of nonExcluded) {
    const key = a.scoaNumber?.trim();
    if (key && validNumbers.has(key)) pushInto(byScoa, key, a);
    else unmapped.push(a);
  }

  const sumFor = (list: Account[]) => list.reduce((s, a) => s + (totals.get(a.id) ?? 0), 0);

  const lines: ScoaLineRollup[] = scoaAccounts.map((s) => {
    const list = byScoa.get(s.number.trim()) ?? [];
    const line: ScoaLineRollup = {
      number: s.number,
      name: s.name,
      accountIds: list.map((a) => a.id),
      accountNames: list.map((a) => a.name),
      total: sumFor(list),
    };
    if (s.statementType) line.statementType = s.statementType;
    return line;
  });

  const mappedAccountCount = nonExcluded.length - unmapped.length;

  return {
    lines,
    unmappedTotal: sumFor(unmapped),
    unmappedAccountIds: unmapped.map((a) => a.id),
    unmappedAccountNames: unmapped.map((a) => a.name),
    mappedAccountCount,
    mappableAccountCount: nonExcluded.length,
    coveragePct: nonExcluded.length ? mappedAccountCount / nonExcluded.length : 0,
    revenueTotal: sumFor(nonExcluded.filter((a) => a.type === 'revenue')),
  };
}

export interface ScoaLineSnapshot {
  /** Keyed by SCOA number: the rolled-up dollars + share of revenue. Lines with
   *  no mapped accounts are omitted (they show as n/a in the comparison). */
  lineTotals: Record<string, { total: number; pctRevenue: number | null }>;
  revenue: number;
}

/**
 * One corporate SCOA line, this franchisee vs the peer median. Lives here (not
 * in the `'use server'` action module, which may export only async functions).
 */
export interface ScoaComparisonLine {
  number: string;
  name: string;
  statementType?: 'pnl' | 'balance';
  /** This franchisee's rolled-up dollars over T12 (null = no mapped data). */
  thisTotal: number | null;
  /** This franchisee's share of its own revenue. */
  thisPct: number | null;
  /** Median of the peer franchisees' dollars for this line. */
  peerMedianTotal: number | null;
  /** Median of the peer franchisees' % of revenue for this line. */
  peerMedianPct: number | null;
  /** How many peers had a dollar total for this line (dollar-mode sample size). */
  peerCount: number;
  /** How many peers had a % of revenue for this line (pct-mode sample size —
   *  a peer with a total but zero revenue has no %). */
  peerPctCount: number;
}

/** One franchisee's comparable corporate-line values (used server-side per peer). */
export function scoaLineSnapshot(
  scoaAccounts: FranchiseScoaAccount[],
  accounts: Account[],
  values: AccountValue[],
  periods: Period[]
): ScoaLineSnapshot {
  const roll = rollupByScoa(scoaAccounts, accounts, values, periods);
  const lineTotals: Record<string, { total: number; pctRevenue: number | null }> = {};
  for (const line of roll.lines) {
    if (line.accountIds.length === 0) continue; // no data from this franchisee
    lineTotals[line.number] = {
      total: line.total,
      pctRevenue: roll.revenueTotal !== 0 ? line.total / roll.revenueTotal : null,
    };
  }
  return { lineTotals, revenue: roll.revenueTotal };
}

/**
 * Assemble the per-line THIS-vs-peer-median comparison from pre-computed
 * snapshots (this franchisee + peers). Pure — extracted from the `'use server'`
 * action (whose DB I/O can't run headless) so the money math (peer median,
 * sample-size counts, the total-with-zero-revenue → no-% distinction) is
 * unit-checkable. A peer with a total but zero revenue counts toward peerCount
 * but not peerPctCount.
 */
export function buildScoaComparisonLines(
  scoaAccounts: FranchiseScoaAccount[],
  thisSnap: ScoaLineSnapshot | null,
  peerSnaps: ScoaLineSnapshot[]
): ScoaComparisonLine[] {
  return scoaAccounts.map((s) => {
    const mine = thisSnap?.lineTotals[s.number];
    const peerTotals = peerSnaps.map((p) => p.lineTotals[s.number]?.total ?? null);
    const peerPcts = peerSnaps.map((p) => p.lineTotals[s.number]?.pctRevenue ?? null);
    const line: ScoaComparisonLine = {
      number: s.number,
      name: s.name,
      thisTotal: mine?.total ?? null,
      thisPct: mine?.pctRevenue ?? null,
      peerMedianTotal: median(peerTotals),
      peerMedianPct: median(peerPcts),
      peerCount: peerTotals.filter((v) => v !== null).length,
      peerPctCount: peerPcts.filter((v) => v !== null).length,
    };
    if (s.statementType) line.statementType = s.statementType;
    return line;
  });
}
