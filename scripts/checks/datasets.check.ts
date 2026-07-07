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

// ── Scenario 6: existing has numbers, incoming has ONLY names (QBO export
//    without account numbers) — must still match by name, not flag as new ────
{
  const ea = [acc('e1', 'Food Sales', 'revenue', '4000'), acc('e2', 'Rent', 'expense', '6300')];
  const ev = [val('e1', 2026, 1, 100), val('e2', 2026, 1, 50)];
  const ia = [acc('i1', 'Food Sales', 'revenue'), acc('i2', 'Rent', 'expense')]; // no numbers
  const iv = [val('i1', 2026, 1, 100), val('i1', 2026, 2, 110), val('i2', 2026, 1, 50), val('i2', 2026, 2, 50)];
  const diff = diffImport(ea, ev, ia, iv);
  check(diff.newAccounts.length === 0, `number-vs-name: should match by name, got ${diff.newAccounts.length} new accounts`);
  check(diff.matchedCells === 2, `number-vs-name: 2 cells should match, got ${diff.matchedCells}`);
  check(diff.status === 'extends' && diff.newPeriods.length === 1, 'number-vs-name: Feb is the one new period');

  const merged = mergeNewPeriods(ea, ev, ia, iv);
  check(merged.accounts.length === 2, `number-vs-name merge: no duplicate accounts, got ${merged.accounts.length}`);
  const febFood = merged.values.find((v) => v.period.month === 2 && v.accountId === 'e1');
  check(febFood?.amount === 110, `number-vs-name merge: Feb attaches to existing account, got ${febFood?.amount}`);
}

// ── Scenario 7: a back-filled NEW account must bring its full history on merge,
//    not just the new period (review fix) ──────────────────────────────────────
{
  const ea = [acc('e1', 'Food Sales', 'revenue', '4000')];
  const ev: AccountValue[] = [];
  for (let m = 1; m <= 6; m++) ev.push(val('e1', 2026, m, 100));
  // Incoming adds a brand-new account 'Delivery' spanning Jan–Jul.
  const ia = [acc('i1', 'Food Sales', 'revenue', '4000'), acc('i2', 'Delivery', 'expense', '5300')];
  const iv: AccountValue[] = [];
  for (let m = 1; m <= 7; m++) {
    iv.push(val('i1', 2026, m, 100));
    iv.push(val('i2', 2026, m, 20));
  }
  const merged = mergeNewPeriods(ea, ev, ia, iv);
  const deliveryId = merged.accounts.find((a) => a.number === '5300')?.id;
  const deliveryVals = merged.values.filter((v) => v.accountId === deliveryId);
  check(deliveryVals.length === 7, `new account should keep full 7-month history, got ${deliveryVals.length}`);
  const janDelivery = deliveryVals.find((v) => v.period.month === 1);
  check(janDelivery?.amount === 20, `new account's Jan (overlapping) value should be present, got ${janDelivery?.amount}`);
  // Existing Food Sales unchanged: 6 values, no July duplicate-overwrite issue.
  const foodVals = merged.values.filter((v) => merged.accounts.find((a) => a.id === v.accountId)?.number === '4000');
  check(foodVals.length === 7, `Food Sales should be 6 existing + 1 new July = 7, got ${foodVals.length}`);
}

// ── Scenario 8: same name, DIFFERENT numbers = different accounts (no misgmerge)
{
  const ea = [acc('e1', 'Other', 'expense', '6000')];
  const ev = [val('e1', 2026, 1, 100)];
  const ia = [acc('i1', 'Other', 'expense', '7000')]; // same name, different number
  const iv = [val('i1', 2026, 1, 999), val('i1', 2026, 2, 50)];
  const diff = diffImport(ea, ev, ia, iv);
  check(diff.newAccounts.length === 1, `differing-number same-name should be a NEW account, got ${diff.newAccounts.length}`);
  check(diff.changedCells.length === 0, `should not compare #7000 against #6000, got ${diff.changedCells.length} changed`);
  const merged = mergeNewPeriods(ea, ev, ia, iv);
  check(merged.accounts.length === 2, `should keep both #6000 and #7000, got ${merged.accounts.length}`);
}

if (failures > 0) {
  console.error(`\n${failures} dataset check(s) FAILED`);
  process.exit(1);
}
console.log('All dataset checks passed.');
