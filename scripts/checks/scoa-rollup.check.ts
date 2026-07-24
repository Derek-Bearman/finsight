/**
 * SCOA roll-up engine checks, runnable headless:
 *   npx tsx scripts/checks/scoa-rollup.check.ts
 *
 * Pins the many-to-one roll-up that the corporate-line comparison depends on:
 * N client accounts sharing a scoaNumber fold into ONE line, unmapped +
 * excluded are handled, coverage + % of revenue are correct, and the peer
 * median is right.
 */

import type { Account, AccountValue, FranchiseScoaAccount, Period } from '../../src/types';
import { rollupByScoa, scoaLineSnapshot } from '../../src/lib/franchise/scoa-rollup';
import { median } from '../../src/lib/franchise/peer-metrics';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}
const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

const P: Period = { year: 2025, month: 1 };
const P2: Period = { year: 2025, month: 2 };

function acct(over: Partial<Account> & { id: string; name: string; type: Account['type'] }): Account {
  return { isManuallyClassified: false, ...over };
}
function val(accountId: string, amount: number, period: Period = P): AccountValue {
  return { accountId, period, amount };
}

// Corporate SCOA: generic lines.
const scoa: FranchiseScoaAccount[] = [
  { number: '1000', name: 'Cash', statementType: 'balance' },
  { number: '4000', name: 'Revenue', statementType: 'pnl' },
  { number: '6000', name: 'Marketing Expense', statementType: 'pnl' },
  { number: '6300', name: 'Rent Expense', statementType: 'pnl' },
];

// Franchisee: 2 checking accounts, 1 revenue, 3 marketing accounts, 2 buildings,
// one unmapped account, one excluded summary row.
const accounts: Account[] = [
  acct({ id: 'chk1', name: 'Checking Main', type: 'asset', scoaNumber: '1000' }),
  acct({ id: 'chk2', name: 'Checking Payroll', type: 'asset', scoaNumber: '1000' }),
  acct({ id: 'rev1', name: 'Food Sales', type: 'revenue', scoaNumber: '4000' }),
  acct({ id: 'mkt1', name: 'Google Ads', type: 'expense', scoaNumber: '6000' }),
  acct({ id: 'mkt2', name: 'Facebook Ads', type: 'expense', scoaNumber: '6000' }),
  acct({ id: 'mkt3', name: 'Local Print', type: 'expense', scoaNumber: '6000' }),
  acct({ id: 'rent1', name: 'Rent Building A', type: 'expense', scoaNumber: '6300' }),
  acct({ id: 'rent2', name: 'Rent Building B', type: 'expense', scoaNumber: '6300' }),
  acct({ id: 'misc', name: 'Misc Expense', type: 'expense' }), // unmapped
  acct({ id: 'sub', name: 'Total Expenses', type: 'expense', scoaNumber: '6000', isExcluded: true }), // excluded
];

const values: AccountValue[] = [
  val('chk1', 50_000), val('chk2', 10_000),
  val('rev1', 100_000),
  val('mkt1', 3_000), val('mkt2', 2_000), val('mkt3', 1_000),
  val('rent1', 6_000), val('rent2', 4_000),
  val('misc', 500),
  val('sub', 999_999), // excluded — must NOT count
];

const roll = rollupByScoa(scoa, accounts, values, [P]);
const line = (n: string) => roll.lines.find((l) => l.number === n)!;

// Many-to-one: 3 marketing accounts fold into ONE line and sum.
check(line('6000').accountIds.length === 3, 'marketing line folds 3 accounts');
check(approx(line('6000').total, 6_000), 'marketing line sums 3 accounts (3000+2000+1000)');
check(line('6000').accountNames.includes('Google Ads'), 'marketing line lists underlying account names');

// Two checking accounts fold into Cash; two buildings into Rent.
check(approx(line('1000').total, 60_000), 'cash line sums 2 checking accounts');
check(approx(line('6300').total, 10_000), 'rent line sums 2 buildings');
check(approx(line('4000').total, 100_000), 'revenue line');

// Excluded summary row never counts even though it carries scoaNumber 6000.
check(!line('6000').accountIds.includes('sub'), 'excluded account not folded');
check(approx(line('6000').total, 6_000), 'excluded account amount excluded from the line');

// Unmapped bucket.
check(roll.unmappedAccountIds.length === 1 && roll.unmappedAccountIds[0] === 'misc', 'unmapped bucket holds the no-scoaNumber account');
check(approx(roll.unmappedTotal, 500), 'unmapped total');

// Coverage: 8 of 9 non-excluded accounts are mapped (misc unmapped; sub excluded from denom).
check(roll.mappableAccountCount === 9, 'coverage denominator excludes the excluded row');
check(roll.mappedAccountCount === 8, 'mapped count');
check(approx(roll.coveragePct, 8 / 9), 'coverage pct');

// Revenue total for % normalizing.
check(approx(roll.revenueTotal, 100_000), 'revenue total for normalization');

// Snapshot: % of revenue per line; empty lines omitted.
const snap = scoaLineSnapshot(scoa, accounts, values, [P]);
check(approx(snap.lineTotals['6000']!.pctRevenue!, 0.06), 'marketing = 6% of revenue');
check(approx(snap.lineTotals['6300']!.pctRevenue!, 0.10), 'rent = 10% of revenue');
check(snap.lineTotals['1000'] !== undefined, 'balance-sheet line present in snapshot');

// Multi-period roll-up sums across periods.
const values2 = [...values, val('mkt1', 4_000, P2), val('rev1', 100_000, P2)];
const roll2 = rollupByScoa(scoa, accounts, values2, [P, P2]);
check(approx(roll2.lines.find((l) => l.number === '6000')!.total, 10_000), 'multi-period marketing (6000 + 4000)');

// Orphan mapping: a scoaNumber matching no corporate line (stale after a SCOA
// re-upload/renumber) is treated as UNMAPPED — its dollars stay in the
// reconciliation and coverage does not over-credit it.
const orphanAccts: Account[] = [
  acct({ id: 'ok', name: 'Google Ads', type: 'expense', scoaNumber: '6000' }),
  acct({ id: 'orphan', name: 'Old Marketing', type: 'expense', scoaNumber: '9999' }), // 9999 not in SCOA
  acct({ id: 'free', name: 'Uncategorized', type: 'expense' }),
];
const orphanVals: AccountValue[] = [val('ok', 1_000), val('orphan', 5_000), val('free', 200)];
const oRoll = rollupByScoa(scoa, orphanAccts, orphanVals, [P]);
check(oRoll.unmappedAccountIds.includes('orphan'), 'orphan scoaNumber routed to unmapped');
check(approx(oRoll.unmappedTotal, 5_200), 'orphan + free dollars in unmappedTotal (5000+200)');
check(oRoll.mappedAccountCount === 1, 'orphan not counted as mapped (only the valid one)');
check(approx(oRoll.coveragePct, 1 / 3), 'coverage excludes the orphan');
const orphanLinesSum = oRoll.lines.reduce((s, l) => s + l.total, 0);
check(approx(orphanLinesSum + oRoll.unmappedTotal, 6_200), 'reconciles: sum(lines) + unmapped == total non-excluded');
check(oRoll.lines.find((l) => l.number === '6000')!.total === 1_000, 'orphan dollars do NOT leak into line 6000');

// Median helper (used to build peer medians in the comparison).
check(median([2, 4, 6]) === 4, 'median odd');
check(median([2, 4, 6, 8]) === 5, 'median even');
check(median([null, 4, undefined]) === 4, 'median ignores null/undefined');
check(median([]) === null, 'median empty = null');

if (failures > 0) {
  console.error(`\n${failures} scoa-rollup check(s) FAILED`);
  process.exit(1);
}
console.log('All scoa-rollup checks passed.');
