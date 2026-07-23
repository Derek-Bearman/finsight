/**
 * Franchise peer-comparison + SCOA audit checks (FRANCHISE_BENCHMARKS_PLAN.md
 * §F3/§F4):
 *   npx tsx scripts/checks/franchise.check.ts
 *
 * Pins the pure layers behind the co-franchisee comparison table and the
 * Corporate SCOA mapping mode:
 *   1. computePeerSnapshot: ratio extraction, trailing-12 sums, zero-revenue
 *      months yield null margins (not 0%), month counting, empty workspaces.
 *   2. median(): odd/even/null-heavy/empty inputs.
 *   3. auditScoa(): match tiers (explicit mapping > number > name), the
 *      statement-side guard, one-claim-per-account, discrepancy flags,
 *      autoMap proposals only for unmapped accounts, missing/extra buckets.
 */

import type { Account, AccountValue, ClientWorkspace, FranchiseScoaAccount } from '../../src/types';
import { computePeerSnapshot, median } from '../../src/lib/franchise/peer-metrics';
import { auditScoa, scoaCoverage } from '../../src/lib/franchise/scoa-audit';

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const approx = (a: number | null | undefined, b: number, eps = 1e-9) =>
  typeof a === 'number' && Math.abs(a - b) < eps;

// ─────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────

function acct(id: string, name: string, type: Account['type'], number?: string, scoaNumber?: string): Account {
  return { id, name, type, ...(number ? { number } : {}), ...(scoaNumber ? { scoaNumber } : {}) } as Account;
}

function ws(accounts: Account[], values: AccountValue[]): ClientWorkspace {
  return {
    id: 'ws-1',
    name: 'Fixture Franchisee',
    industryProfileId: 'generic-smb',
    accounts,
    values,
    fiscalYearStart: 1,
    scenarios: [],
    operationalData: [],
    customMetrics: [],
    auditLog: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const v = (accountId: string, year: number, month: number, amount: number): AccountValue => ({
  accountId,
  period: { year, month },
  amount,
});

// ─────────────────────────────────────────────
// 1. computePeerSnapshot
// ─────────────────────────────────────────────
{
  const accounts = [
    acct('rev', 'Sales', 'revenue'),
    acct('cogs', 'Food Cost', 'cogs'),
    acct('exp', 'Rent', 'expense'),
    acct('cash', 'Cash', 'asset', '1000'),
    acct('ap', 'Accounts Payable', 'liability', '2000'),
    acct('eq', 'Owner Equity', 'equity', '3000'),
  ];
  // 14 months so trailing-12 is a strict subset: Jan 2025 – Feb 2026.
  const values: AccountValue[] = [];
  const months: Array<[number, number]> = [];
  for (let m = 1; m <= 12; m++) months.push([2025, m]);
  months.push([2026, 1], [2026, 2]);
  for (const [y, m] of months) {
    values.push(v('rev', y, m, 1000));
    values.push(v('cogs', y, m, 400));
    values.push(v('exp', y, m, 300));
    values.push(v('cash', y, m, 5000));
    values.push(v('ap', y, m, 2000));
    values.push(v('eq', y, m, 3000));
  }

  const snap = computePeerSnapshot(ws(accounts, values));
  check('snapshot: month count', snap.monthCount === 14, String(snap.monthCount));
  check('snapshot: latest label', snap.latestPeriodLabel === 'Feb 2026', String(snap.latestPeriodLabel));
  check('snapshot: T12 revenue = 12000', approx(snap.trailing12Revenue, 12_000), String(snap.trailing12Revenue));
  check('snapshot: T12 net income = 3600', approx(snap.trailing12NetIncome, 3_600), String(snap.trailing12NetIncome));
  check('snapshot: gross margin 60%', approx(snap.ratios.gross_margin ?? null, 0.6), String(snap.ratios.gross_margin));
  check('snapshot: net margin 30%', approx(snap.ratios.net_margin ?? null, 0.3), String(snap.ratios.net_margin));
  check('snapshot: current ratio 2.5', approx(snap.ratios.current_ratio ?? null, 2.5), String(snap.ratios.current_ratio));
  check(
    'snapshot: debt/equity 0.666…',
    approx(snap.ratios.debt_to_equity ?? null, 2000 / 3000),
    String(snap.ratios.debt_to_equity)
  );

  // Zero-revenue latest month → null margins, not 0%.
  const values2 = values.concat([v('exp', 2026, 3, 100), v('cash', 2026, 3, 5000)]);
  const snap2 = computePeerSnapshot(ws(accounts, values2));
  check('snapshot: zero-revenue month nulls margins', snap2.ratios.gross_margin === null, String(snap2.ratios.gross_margin));
  check('snapshot: zero-revenue label advances', snap2.latestPeriodLabel === 'Mar 2026', String(snap2.latestPeriodLabel));

  const empty = computePeerSnapshot(ws(accounts, []));
  check('snapshot: empty workspace nulls', empty.trailing12Revenue === null && empty.monthCount === 0);
}

// ─────────────────────────────────────────────
// 2. median
// ─────────────────────────────────────────────
{
  check('median: odd', median([3, 1, 2]) === 2);
  check('median: even averages', median([1, 2, 3, 4]) === 2.5);
  check('median: ignores nulls', median([null, 5, undefined, 1]) === 3);
  check('median: empty -> null', median([]) === null);
  check('median: all-null -> null', median([null, undefined]) === null);
}

// ─────────────────────────────────────────────
// 3. auditScoa
// ─────────────────────────────────────────────
{
  const scoa: FranchiseScoaAccount[] = [
    { number: '4000', name: 'Food Sales', statementType: 'pnl' },
    { number: '5000', name: 'Food Cost', statementType: 'pnl' },
    { number: '1000', name: 'Cash', statementType: 'balance' },
    { number: '6100', name: 'Insurance', statementType: 'pnl' },
    { number: '9999', name: 'Franchise Fees', statementType: 'pnl' },
  ];
  const accounts = [
    // Tier 1: explicit mapping wins even when the number differs.
    acct('a1', 'Sales - Food', 'revenue', '4400', '4000'),
    // Tier 2: exact number match; name drifts -> nameMismatch.
    acct('a2', 'COGS Food', 'cogs', '5000'),
    // Tier 3: name match with no client number -> numberMismatch.
    acct('a3', 'Insurance', 'expense'),
    // Side guard: BS-declared "Cash" must NOT match a P&L account named Cash.
    acct('a4', 'Cash', 'expense', '7777'),
    // Extra: nothing in the SCOA for this one.
    acct('a5', 'Owner Draws', 'equity', '3100'),
  ];

  const result = auditScoa(scoa, accounts);
  const byNum = (n: string) => result.missing.find((m) => m.number === n);

  check('scoa: mapping tier claims a1', result.matched.some((p) => p.account.id === 'a1' && p.matchedBy === 'mapping')
    || result.discrepancies.some((p) => p.account.id === 'a1' && p.matchedBy === 'mapping'));
  const a1pair = [...result.matched, ...result.discrepancies].find((p) => p.account.id === 'a1');
  check('scoa: a1 name drift flagged', a1pair?.nameMismatch === true);

  const a2pair = [...result.matched, ...result.discrepancies].find((p) => p.account.id === 'a2');
  check('scoa: number tier claims a2', a2pair?.matchedBy === 'number');
  check('scoa: a2 name drift flagged', a2pair?.nameMismatch === true);

  const a3pair = [...result.matched, ...result.discrepancies].find((p) => p.account.id === 'a3');
  check('scoa: name tier claims a3', a3pair?.matchedBy === 'name');
  check('scoa: a3 number mismatch flagged', a3pair?.numberMismatch === true);

  check('scoa: side guard leaves 1000 Cash missing', Boolean(byNum('1000')), 'P&L "Cash" wrongly matched BS SCOA row');
  check('scoa: 9999 missing', Boolean(byNum('9999')));
  check('scoa: a4 and a5 are extra', result.extra.length === 2 && result.extra.some((a) => a.id === 'a4') && result.extra.some((a) => a.id === 'a5'));

  check('scoa: autoMap proposes only unmapped', result.autoMap['a2'] === '5000' && result.autoMap['a3'] === '6100' && !('a1' in result.autoMap));
  check('scoa: coverage line', scoaCoverage(result, scoa.length) === '3 of 5 SCOA accounts matched', scoaCoverage(result, scoa.length));

  // One-claim rule: two SCOA rows with the same normalized name only claim
  // one client account; the second goes missing.
  const dupScoa: FranchiseScoaAccount[] = [
    { number: '6100', name: 'Insurance' },
    { number: '6101', name: 'Insurance' },
  ];
  const dupAccounts = [acct('b1', 'Insurance', 'expense')];
  const dup = auditScoa(dupScoa, dupAccounts);
  check('scoa: one claim per account', dup.missing.length === 1 && dup.missing[0]!.number === '6101');
}

if (failures > 0) {
  console.error(`\n${failures} franchise check(s) FAILED.`);
  process.exit(1);
}
console.log('All franchise checks passed.');
