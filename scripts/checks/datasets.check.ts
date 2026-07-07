/**
 * Dataset diff-engine checks:
 *   npx tsx scripts/checks/datasets.check.ts
 *
 * Covers the accountant's "same history + new month" scenario, value
 * conflicts, new accounts, and the non-destructive merge.
 */

import type { Account, AccountValue } from '../../src/types';
import { diffImport, mergeNewPeriods } from '../../src/lib/data/datasets';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

const acc = (id: string, name: string, type: Account['type'], number?: string): Account => ({
  id,
  name,
  type,
  number,
  isManuallyClassified: false,
});
const val = (accountId: string, year: number, month: number, amount: number): AccountValue => ({
  accountId,
  period: { year, month },
  amount,
});

// Existing: Jan–Jun 2026, two accounts (matched by number).
const existAccounts = [acc('e1', 'Food Sales', 'revenue', '4000'), acc('e2', 'Rent', 'expense', '6300')];
const existValues: AccountValue[] = [];
for (let m = 1; m <= 6; m++) {
  existValues.push(val('e1', 2026, m, 10000 + m * 100));
  existValues.push(val('e2', 2026, m, 3000));
}

// ── Scenario 1: YTD re-import through July — history identical, July is new ──
{
  const incAccounts = [acc('i1', 'Food Sales', 'revenue', '4000'), acc('i2', 'Rent', 'expense', '6300')];
  const incValues: AccountValue[] = [];
  for (let m = 1; m <= 7; m++) {
    incValues.push(val('i1', 2026, m, 10000 + m * 100)); // same as existing for Jan–Jun
    incValues.push(val('i2', 2026, m, 3000));
  }
  const diff = diffImport(existAccounts, existValues, incAccounts, incValues);
  check(diff.status === 'extends', `YTD re-import should 'extends', got ${diff.status}`);
  check(diff.changedCells.length === 0, `no cells should differ, got ${diff.changedCells.length}`);
  check(diff.newPeriods.length === 1 && diff.newPeriods[0]!.month === 7, 'July should be the one new period');
  check(diff.matchedCells === 12, `12 cells (2 accts × 6 months) should match, got ${diff.matchedCells}`);
  check(diff.newAccounts.length === 0, 'no new accounts');

  const merged = mergeNewPeriods(existAccounts, existValues, incAccounts, incValues);
  // Existing 12 + July's 2 = 14 values; existing values untouched.
  check(merged.values.length === 14, `merge should yield 14 values, got ${merged.values.length}`);
  const julyFood = merged.values.find((v) => v.period.month === 7 && merged.accounts.find((a) => a.id === v.accountId)?.number === '4000');
  check(julyFood?.amount === 10700, `July Food Sales should be 10700, got ${julyFood?.amount}`);
  check(merged.accounts.length === 2, 'merge should not add duplicate accounts (matched by number)');
}

// ── Scenario 2: identical re-import — all match, nothing new ──────────────────
{
  const diff = diffImport(existAccounts, existValues, existAccounts, existValues);
  check(diff.status === 'identical', `identical re-import should be 'identical', got ${diff.status}`);
  check(diff.changedCells.length === 0 && diff.newPeriods.length === 0, 'identical: nothing changed or new');
}

// ── Scenario 3: a corrected value — conflict with a delta ────────────────────
{
  const incAccounts = [acc('i1', 'Food Sales', 'revenue', '4000'), acc('i2', 'Rent', 'expense', '6300')];
  const incValues: AccountValue[] = [];
  for (let m = 1; m <= 6; m++) {
    incValues.push(val('i1', 2026, m, m === 3 ? 15000 : 10000 + m * 100)); // March corrected up
    incValues.push(val('i2', 2026, m, 3000));
  }
  const diff = diffImport(existAccounts, existValues, incAccounts, incValues);
  check(diff.status === 'conflicts', `corrected value should be 'conflicts', got ${diff.status}`);
  check(diff.changedCells.length === 1, `one changed cell, got ${diff.changedCells.length}`);
  const c = diff.changedCells[0]!;
  check(c.oldValue === 10300 && c.newValue === 15000 && c.delta === 4700, `delta math wrong: ${c.oldValue}→${c.newValue} (${c.delta})`);
}

// ── Scenario 4: a genuinely new account with values ──────────────────────────
{
  const incAccounts = [acc('i1', 'Food Sales', 'revenue', '4000'), acc('i3', 'Catering', 'revenue', '4200')];
  const incValues: AccountValue[] = [];
  for (let m = 1; m <= 6; m++) {
    incValues.push(val('i1', 2026, m, 10000 + m * 100));
    incValues.push(val('i3', 2026, m, 500));
  }
  const diff = diffImport(existAccounts, existValues, incAccounts, incValues);
  check(diff.newAccounts.length === 1 && diff.newAccounts[0]!.name === 'Catering', 'Catering should be a new account');
}

// ── Scenario 5: name-based matching when no account numbers ──────────────────
{
  const ea = [acc('e1', 'Food Sales', 'revenue')];
  const ev = [val('e1', 2026, 1, 100)];
  const ia = [acc('i1', 'food sales', 'revenue')]; // different case/id, no number
  const iv = [val('i1', 2026, 1, 100), val('i1', 2026, 2, 200)];
  const diff = diffImport(ea, ev, ia, iv);
  check(diff.newAccounts.length === 0, 'name match (case-insensitive) should not flag a new account');
  check(diff.matchedCells === 1 && diff.newPeriods.length === 1, 'Jan matches, Feb is new');
}

if (failures > 0) {
  console.error(`\n${failures} dataset check(s) FAILED`);
  process.exit(1);
}
console.log('All dataset checks passed.');
