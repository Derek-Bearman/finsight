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

const periodKey = (p: Period) => `${p.year}-${p.month}`;

function pushInto(map: Map<string, Account[]>, key: string, a: Account): void {
  const list = map.get(key);
  if (list) list.push(a);
  else map.set(key, [a]);
}

/** Per-account amount summed over the requested periods (non-excluded only). */
function perAccountTotals(
  accounts: Account[],
  values: AccountValue[],
  periods: Period[]
): Map<string, number> {
  const keys = new Set(periods.map(periodKey));
  const included = new Set(accounts.filter((a) => !a.isExcluded).map((a) => a.id));
  const totals = new Map<string, number>();
  for (const v of values) {
    if (!included.has(v.accountId)) continue;
    if (!keys.has(periodKey(v.period))) continue;
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
