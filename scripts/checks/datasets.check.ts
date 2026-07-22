/**
 * Dataset diff-engine checks:
 *   npx tsx scripts/checks/datasets.check.ts
 *
 * Covers the accountant's "same history + new month" scenario, value
 * conflicts, new accounts, the non-destructive merge, the externalId
 * (realm-qualified QBO Account.Id) matcher tier, the inferential-tier guards
 * (cross-statement, realm switch, excluded summary placeholders), and the
 * restatement-capable mergeOverwrite.
 */

import type { Account, AccountValue } from '../../src/types';
import { diffImport, mergeNewPeriods, mergeOverwrite, isAdditiveStatementMerge } from '../../src/lib/data/datasets';

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
// Account WITH an externalId (realm-qualified QBO Account.Id, '<realm>:<Id>').
const accX = (
  id: string,
  name: string,
  type: Account['type'],
  number: string | undefined,
  externalId: string
): Account => ({ id, name, type, number, externalId, isManuallyClassified: false });

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

// ── Scenario 9: a NEW account name appearing TWICE in the incoming file (QBO
//    leaf rows like COGS:Insurance + Overhead:Insurance export as two rows
//    both named 'Insurance') — the second row's backfill history must not be
//    dropped when it's remapped onto the newly-adopted first row ──────────────
{
  const ea = [acc('e1', 'Food Sales', 'revenue')];
  const ev: AccountValue[] = [];
  for (let m = 1; m <= 6; m++) ev.push(val('e1', 2026, m, 100));
  const ia = [acc('i1', 'Food Sales', 'revenue'), acc('i2', 'Insurance', 'expense'), acc('i3', 'Insurance', 'expense')];
  const iv: AccountValue[] = [];
  for (let m = 1; m <= 7; m++) {
    iv.push(val('i1', 2026, m, 100));
    iv.push(val('i2', 2026, m, 200));
    iv.push(val('i3', 2026, m, 500));
  }
  const merged = mergeNewPeriods(ea, ev, ia, iv);
  const insuranceIds = new Set(merged.accounts.filter((a) => a.name === 'Insurance').map((a) => a.id));
  const insuranceTotal = (month: number) =>
    merged.values.filter((v) => insuranceIds.has(v.accountId) && v.period.month === month).reduce((s, v) => s + v.amount, 0);
  check(insuranceTotal(1) === 700, `duplicate new-name backfill: Jan Insurance should total 700, got ${insuranceTotal(1)}`);
  check(insuranceTotal(6) === 700, `duplicate new-name backfill: Jun Insurance should total 700, got ${insuranceTotal(6)}`);
  check(insuranceTotal(7) === 700, `duplicate new-name July should total 700, got ${insuranceTotal(7)}`);
}

// ── Scenario 10: EXISTING duplicate same-name twins (numberless) must pair
//    positionally, not both collapse onto the first twin ──────────────────────
{
  const ea = [acc('e1', 'Sales', 'revenue'), acc('e2', 'Other', 'expense'), acc('e3', 'Other', 'expense')];
  const ev: AccountValue[] = [];
  for (let m = 1; m <= 6; m++) {
    ev.push(val('e1', 2026, m, 1000));
    ev.push(val('e2', 2026, m, 100));
    ev.push(val('e3', 2026, m, 120));
  }
  // (a) Identical re-import must NOT report phantom conflicts between the twins.
  const ia = [acc('i1', 'Sales', 'revenue'), acc('i2', 'Other', 'expense'), acc('i3', 'Other', 'expense')];
  const iv: AccountValue[] = [];
  for (let m = 1; m <= 6; m++) {
    iv.push(val('i1', 2026, m, 1000));
    iv.push(val('i2', 2026, m, 100));
    iv.push(val('i3', 2026, m, 120));
  }
  const diff = diffImport(ea, ev, ia, iv);
  check(diff.status === 'identical', `twin re-import should be 'identical', got ${diff.status}`);
  check(diff.changedCells.length === 0, `twin re-import: no phantom changed cells, got ${diff.changedCells.length}`);
  check(diff.newAccounts.length === 0, `twin re-import: no new accounts, got ${diff.newAccounts.length}`);

  // (b) YTD merge through July must attach each twin's July to its OWN account.
  const iv7 = [...iv, val('i1', 2026, 7, 1000), val('i2', 2026, 7, 110), val('i3', 2026, 7, 990)];
  const merged = mergeNewPeriods(ea, ev, ia, iv7);
  check(merged.accounts.length === 3, `twin merge: no duplicate accounts adopted, got ${merged.accounts.length}`);
  const julyE2 = merged.values.filter((v) => v.accountId === 'e2' && v.period.month === 7);
  const julyE3 = merged.values.filter((v) => v.accountId === 'e3' && v.period.month === 7);
  check(julyE2.length === 1 && julyE2[0]!.amount === 110, `twin merge: first twin's July should be [110], got ${JSON.stringify(julyE2.map((v) => v.amount))}`);
  check(julyE3.length === 1 && julyE3[0]!.amount === 990, `twin merge: second twin's July should be [990], got ${JSON.stringify(julyE3.map((v) => v.amount))}`);
}

// ── Scenario 11: same-period Balance Sheet into a P&L-only working set — no
//    new periods, all-new accounts: must qualify as an additive statement
//    merge and adopt the BS with full history, leaving the P&L untouched ──────
{
  const ea = [acc('e1', 'Food Sales', 'revenue'), acc('e2', 'Rent', 'expense')];
  const ev: AccountValue[] = [];
  for (let m = 1; m <= 6; m++) {
    ev.push(val('e1', 2026, m, 1000));
    ev.push(val('e2', 2026, m, 300));
  }
  const ia = [acc('i1', 'Cash', 'asset'), acc('i2', 'Loan Payable', 'liability'), acc('i3', 'Owner Equity', 'equity')];
  const iv: AccountValue[] = [];
  for (let m = 1; m <= 6; m++) {
    iv.push(val('i1', 2026, m, 5000));
    iv.push(val('i2', 2026, m, 2000));
    iv.push(val('i3', 2026, m, 3000));
  }
  const diff = diffImport(ea, ev, ia, iv);
  check(diff.status === 'extends' && diff.newPeriods.length === 0, `BS-into-P&L: extends with 0 new periods, got ${diff.status}/${diff.newPeriods.length}`);
  check(diff.newAccounts.length === 3 && diff.changedCells.length === 0, `BS-into-P&L: 3 new accounts, 0 conflicts, got ${diff.newAccounts.length}/${diff.changedCells.length}`);
  check(isAdditiveStatementMerge(ea, ia), 'BS-into-P&L: disjoint-by-type BS should qualify for additive merge');

  const merged = mergeNewPeriods(ea, ev, ia, iv);
  check(merged.accounts.length === 5, `BS-into-P&L merge: 2 P&L + 3 BS accounts, got ${merged.accounts.length}`);
  check(merged.values.length === 30, `BS-into-P&L merge: 12 P&L + 18 BS values, got ${merged.values.length}`);
  const janCash = merged.values.find((v) => v.accountId === 'i1' && v.period.month === 1);
  check(janCash?.amount === 5000, `BS-into-P&L merge: Cash keeps overlapping-period history, got ${janCash?.amount}`);
  const janFood = merged.values.filter((v) => v.accountId === 'e1' && v.period.month === 1);
  check(janFood.length === 1 && janFood[0]!.amount === 1000, 'BS-into-P&L merge: existing P&L values untouched');
}

// ── Scenario 12: cross-statement guard — the inferential (number/name) tiers
//    must never pair a P&L account with a same-named BS account. The combined-
//    QBO-batch bug this pins down: an existing 'Insurance' asset (12,000
//    balance) name-merged with an incoming 'Insurance' expense (350/mo),
//    overwriting the balance and adopting the wrong externalId forever. ───────
{
  const ea = [acc('e1', 'Insurance', 'asset')];
  const ev = [val('e1', 2026, 1, 12000)];
  const ia = [accX('i1', 'Insurance', 'expense', undefined, '9130001:55')];
  const iv = [val('i1', 2026, 1, 350)];

  const diff = diffImport(ea, ev, ia, iv);
  check(diff.newAccounts.length === 1, `cross-statement twin: incoming expense is a NEW account, got ${diff.newAccounts.length}`);
  check(diff.changedCells.length === 0, `cross-statement twin: 12000 vs 350 must never be compared, got ${diff.changedCells.length} changed`);

  const ow = mergeOverwrite(ea, ev, ia, iv);
  check(ow.accounts.length === 2 && ow.addedAccounts === 1, `cross-statement twin overwrite: both accounts survive, got ${ow.accounts.length}/${ow.addedAccounts}`);
  check(ow.accounts.find((a) => a.id === 'e1') === ea[0], 'cross-statement twin overwrite: asset untouched (same reference — no externalId adopted)');
  const assetVals = ow.values.filter((v) => v.accountId === 'e1');
  check(assetVals.length === 1 && assetVals[0]!.amount === 12000, `cross-statement twin overwrite: the 12,000 balance survives, got ${JSON.stringify(assetVals.map((v) => v.amount))}`);
  const expVals = ow.values.filter((v) => v.accountId === 'i1');
  check(expVals.length === 1 && expVals[0]!.amount === 350, 'cross-statement twin overwrite: the expense lands on its OWN account');
  check(ow.changedCells === 0, `cross-statement twin overwrite: not a restatement, got ${ow.changedCells}`);

  // Guard applies to no-externalId (CSV) flows too — same-name cross-statement
  // rows are different accounts, never a merge.
  const csvDiff = diffImport([acc('e1', 'Insurance', 'expense')], [], [acc('c1', 'Insurance', 'asset')], [val('c1', 2026, 1, 1)]);
  check(csvDiff.newAccounts.length === 1, 'cross-statement twin: guard applies to no-externalId flows too');

  // The additive-statement-merge gate: name twins can no longer cross-attach
  // (they arrive as NEW accounts), so a same-period BS with a name collision
  // now QUALIFIES as additive — and the merge proves it is safe.
  const gateEa = [acc('e1', 'Insurance', 'expense')];
  const gateIa = [acc('i1', 'Insurance', 'asset'), acc('i2', 'Cash', 'asset')];
  check(isAdditiveStatementMerge(gateEa, gateIa), 'additive gate: name twin cannot cross-attach, so the BS merge is additive');
  const bsMerge = mergeNewPeriods(gateEa, [val('e1', 2026, 1, 350)], gateIa, [val('i1', 2026, 1, 12000), val('i2', 2026, 1, 5000)]);
  check(bsMerge.accounts.length === 3, `additive gate: BS twin ADDS accounts, got ${bsMerge.accounts.length}`);
  const keptExp = bsMerge.values.filter((v) => v.accountId === 'e1');
  check(keptExp.length === 1 && keptExp[0]!.amount === 350, 'additive gate: P&L expense untouched by the BS twin');
  // …while a tier-1 externalId match crossing the divide (user reclassified a
  // QBO-linked account) still disqualifies the additive merge.
  check(
    !isAdditiveStatementMerge(
      [accX('e9', 'Prepaid Insurance', 'asset', undefined, '9130001:9')],
      [accX('i9', 'Prepaid Insurance', 'expense', undefined, '9130001:9')]
    ),
    'additive gate: externalId-tier cross-statement match still disqualifies'
  );
  // Same-side matches (a normal P&L re-import) still qualify.
  check(isAdditiveStatementMerge(gateEa, [acc('i3', 'Insurance', 'expense')]), 'same-side name match should still qualify');
}

// ── externalId matcher tier (QBO Account.Id) ─────────────────────────────────

// ── Scenario 13: externalId match survives a rename AND an account-number
//    change (the whole point of the tier — idempotent QBO re-sync) ────────────
{
  const ea = [accX('e1', 'Sales of Product Income', 'revenue', '4000', 'qbo-101')];
  const ev: AccountValue[] = [];
  for (let m = 1; m <= 6; m++) ev.push(val('e1', 2026, m, 100));
  // Renamed AND renumbered in QBO — only the externalId still agrees.
  const ia = [accX('i1', 'Product Revenue', 'revenue', '4999', 'qbo-101')];
  const iv: AccountValue[] = [];
  for (let m = 1; m <= 7; m++) iv.push(val('i1', 2026, m, 100));
  const diff = diffImport(ea, ev, ia, iv);
  check(diff.newAccounts.length === 0, `externalId tier: rename+renumber should still match, got ${diff.newAccounts.length} new`);
  check(diff.matchedCells === 6 && diff.status === 'extends', `externalId tier: 6 matched cells + extends, got ${diff.matchedCells}/${diff.status}`);

  const merged = mergeNewPeriods(ea, ev, ia, iv);
  check(merged.accounts.length === 1, `externalId tier merge: no duplicate account, got ${merged.accounts.length}`);
  const july = merged.values.find((v) => v.period.month === 7);
  check(july?.accountId === 'e1' && july.amount === 100, `externalId tier merge: July attaches to existing id, got ${july?.accountId}`);

  const ow = mergeOverwrite(ea, ev, ia, iv);
  const owAcct = ow.accounts[0]!;
  check(ow.accounts.length === 1 && owAcct.id === 'e1', `externalId overwrite: still one account, got ${ow.accounts.length}`);
  check(owAcct.name === 'Product Revenue' && owAcct.number === '4999' && owAcct.externalId === 'qbo-101',
    `externalId overwrite: metadata should refresh, got ${owAcct.name}/${owAcct.number}/${owAcct.externalId}`);
}

// ── Scenario 14: adoption — incoming WITH externalId matches existing WITHOUT
//    (by number, else name) and the merges stamp the externalId on ────────────
{
  const ea = [acc('e1', 'Food Sales', 'revenue', '4000'), acc('e2', 'Rent', 'expense')]; // CSV-era, no externalIds
  const ev = [val('e1', 2026, 1, 100), val('e2', 2026, 1, 50)];
  const ia = [
    accX('i1', 'Food Sales', 'revenue', '4000', 'qbo-1'), // adopts via number
    accX('i2', 'Rent', 'expense', undefined, 'qbo-2'), // adopts via name
  ];
  const iv = [val('i1', 2026, 1, 100), val('i1', 2026, 2, 110), val('i2', 2026, 1, 50), val('i2', 2026, 2, 55)];
  const diff = diffImport(ea, ev, ia, iv);
  check(diff.newAccounts.length === 0 && diff.matchedCells === 2, `adoption: both should match, got ${diff.newAccounts.length} new / ${diff.matchedCells} matched`);

  const merged = mergeNewPeriods(ea, ev, ia, iv);
  check(merged.accounts.length === 2, `adoption merge: no duplicates, got ${merged.accounts.length}`);
  check(merged.accounts.find((a) => a.id === 'e1')?.externalId === 'qbo-1', 'adoption merge: number-matched account should adopt qbo-1');
  check(merged.accounts.find((a) => a.id === 'e2')?.externalId === 'qbo-2', 'adoption merge: name-matched account should adopt qbo-2');
  const febRent = merged.values.find((v) => v.accountId === 'e2' && v.period.month === 2);
  check(febRent?.amount === 55, `adoption merge: Feb Rent attaches to existing account, got ${febRent?.amount}`);

  const ow = mergeOverwrite(ea, ev, ia, iv);
  check(ow.accounts.find((a) => a.id === 'e1')?.externalId === 'qbo-1', 'adoption overwrite: number-matched account should adopt qbo-1');
  check(ow.accounts.find((a) => a.id === 'e2')?.externalId === 'qbo-2', 'adoption overwrite: name-matched account should adopt qbo-2');
}

// ── Scenario 15: conflicting externalIds must NEVER merge, even with the same
//    number and name — they are provably different QBO accounts ───────────────
{
  const ea = [accX('e1', 'Sales', 'revenue', '4000', 'qbo-A')];
  const ev = [val('e1', 2026, 1, 100)];
  const ia = [accX('i1', 'Sales', 'revenue', '4000', 'qbo-B')];
  const iv = [val('i1', 2026, 1, 999), val('i1', 2026, 2, 50)];
  const diff = diffImport(ea, ev, ia, iv);
  check(diff.newAccounts.length === 1, `externalId conflict: should be a NEW account, got ${diff.newAccounts.length}`);
  check(diff.changedCells.length === 0, `externalId conflict: must not compare qbo-A vs qbo-B, got ${diff.changedCells.length} changed`);

  const merged = mergeNewPeriods(ea, ev, ia, iv);
  check(merged.accounts.length === 2, `externalId conflict merge: keep both, got ${merged.accounts.length}`);
  check(merged.accounts.find((a) => a.id === 'e1')?.externalId === 'qbo-A', 'externalId conflict merge: existing keeps qbo-A');

  const ow = mergeOverwrite(ea, ev, ia, iv);
  check(ow.accounts.length === 2 && ow.addedAccounts === 1, `externalId conflict overwrite: adopt as new, got ${ow.accounts.length}/${ow.addedAccounts}`);
  check(ow.changedCells === 0, `externalId conflict overwrite: no cell counts as changed, got ${ow.changedCells}`);
  const e1Jan = ow.values.filter((v) => v.accountId === 'e1' && v.period.month === 1);
  check(e1Jan.length === 1 && e1Jan[0]!.amount === 100, `externalId conflict overwrite: qbo-A's Jan untouched, got ${JSON.stringify(e1Jan.map((v) => v.amount))}`);
}

// ── Scenario 16: regression — flows WITHOUT externalId are byte-identical to
//    the pre-externalId engine (Scenario 1 fixtures, exact-output proof) ──────
{
  const incAccounts = [acc('i1', 'Food Sales', 'revenue', '4000'), acc('i2', 'Rent', 'expense', '6300')];
  const incValues: AccountValue[] = [];
  for (let m = 1; m <= 7; m++) {
    incValues.push(val('i1', 2026, m, 10000 + m * 100));
    incValues.push(val('i2', 2026, m, 3000));
  }
  const merged = mergeNewPeriods(existAccounts, existValues, incAccounts, incValues);
  // Account objects pass through UNTOUCHED (same references — no adoption, no
  // metadata churn, no externalId key materializing anywhere).
  check(merged.accounts.length === 2 && merged.accounts[0] === existAccounts[0] && merged.accounts[1] === existAccounts[1],
    'no-externalId regression: existing account objects pass through by reference');
  // Existing value rows pass through by reference, in order.
  check(merged.values.slice(0, 12).every((v, i) => v === existValues[i]),
    'no-externalId regression: existing value rows pass through by reference');
  // Full output matches the pre-change engine's output, byte for byte.
  const expected = {
    accounts: [
      { id: 'e1', name: 'Food Sales', type: 'revenue', number: '4000', isManuallyClassified: false },
      { id: 'e2', name: 'Rent', type: 'expense', number: '6300', isManuallyClassified: false },
    ],
    values: [
      ...existValues,
      { accountId: 'e1', period: { year: 2026, month: 7 }, amount: 10700 },
      { accountId: 'e2', period: { year: 2026, month: 7 }, amount: 3000 },
    ],
  };
  check(JSON.stringify(merged) === JSON.stringify(expected), 'no-externalId regression: merge output is byte-identical to the pre-externalId engine');

  const diff = diffImport(existAccounts, existValues, incAccounts, incValues);
  check(diff.status === 'extends' && diff.matchedCells === 12 && diff.changedCells.length === 0 && diff.newAccounts.length === 0,
    `no-externalId regression: diff unchanged, got ${diff.status}/${diff.matchedCells}/${diff.changedCells.length}/${diff.newAccounts.length}`);
}

// ── Scenario 17: mergeOverwrite — restated cell overwritten and counted, new
//    period added, absent account left completely untouched ───────────────────
{
  const ea = [acc('e1', 'Sales', 'revenue', '4000'), acc('e2', 'Rent', 'expense', '6300')];
  const ev = [
    val('e1', 2026, 1, 100), val('e1', 2026, 2, 200), val('e1', 2026, 3, 300),
    val('e2', 2026, 1, 50), val('e2', 2026, 2, 50), val('e2', 2026, 3, 50),
  ];
  // Incoming restates Feb Sales (200→250), adds April, and OMITS Rent entirely
  // (a QBO P&L omits zero-activity accounts — absence is not deletion).
  const ia = [acc('i1', 'Sales', 'revenue', '4000')];
  const iv = [val('i1', 2026, 1, 100), val('i1', 2026, 2, 250), val('i1', 2026, 3, 300), val('i1', 2026, 4, 400)];
  const ow = mergeOverwrite(ea, ev, ia, iv);
  check(ow.changedCells === 1, `overwrite: exactly the restated Feb cell counts, got ${ow.changedCells}`);
  check(ow.addedPeriods === 1 && ow.addedAccounts === 0, `overwrite: 1 new period / 0 new accounts, got ${ow.addedPeriods}/${ow.addedAccounts}`);
  const feb = ow.values.filter((v) => v.accountId === 'e1' && v.period.month === 2);
  check(feb.length === 1 && feb[0]!.amount === 250, `overwrite: Feb Sales should be restated to 250, got ${JSON.stringify(feb.map((v) => v.amount))}`);
  const apr = ow.values.find((v) => v.accountId === 'e1' && v.period.month === 4);
  check(apr?.amount === 400, `overwrite: April should be added, got ${apr?.amount}`);
  // Absent account: object AND all its values pass through by reference.
  check(ow.accounts.find((a) => a.id === 'e2') === ea[1], 'overwrite: absent account object untouched (same reference)');
  const rentVals = ow.values.filter((v) => v.accountId === 'e2');
  check(rentVals.length === 3 && rentVals.every((v) => v.amount === 50), `overwrite: absent account keeps all 3 values, got ${rentVals.length}`);
  check(ow.values.length === 7, `overwrite: 3 Rent + 4 Sales values, got ${ow.values.length}`);
}

// ── Scenario 18: mergeOverwrite preserves the user's classification while
//    refreshing name/number/externalId from the source of record ──────────────
{
  const ea: Account[] = [{
    id: 'e1',
    name: 'Old Insurance',
    number: '6000',
    externalId: 'qbo-9',
    type: 'expense',
    costBehavior: 'fixed',
    mixedFixedPercent: undefined,
    isManuallyClassified: true,
    isExcluded: false,
    classificationSource: 'manual',
    classificationConfidence: 'high',
    detectedSection: 'expense',
  }];
  const ev = [val('e1', 2026, 1, 500)];
  // QBO renamed + renumbered the account; the transform layer also classifies
  // it differently — the user's classification must survive the refresh.
  const ia: Account[] = [{
    id: 'i1',
    name: 'Insurance Expense',
    number: '6150',
    externalId: 'qbo-9',
    type: 'cogs',
    costBehavior: 'variable',
    isManuallyClassified: false,
  }];
  const iv = [val('i1', 2026, 1, 500)];
  const ow = mergeOverwrite(ea, ev, ia, iv);
  const a = ow.accounts[0]!;
  check(ow.accounts.length === 1 && a.id === 'e1', `classification preserve: one account, got ${ow.accounts.length}`);
  check(a.name === 'Insurance Expense' && a.number === '6150' && a.externalId === 'qbo-9',
    `classification preserve: metadata should refresh, got ${a.name}/${a.number}/${a.externalId}`);
  check(a.type === 'expense' && a.costBehavior === 'fixed' && a.isManuallyClassified === true,
    `classification preserve: type/behavior/manual flag must survive, got ${a.type}/${a.costBehavior}/${a.isManuallyClassified}`);
  check(a.isExcluded === false && a.classificationSource === 'manual' && a.classificationConfidence === 'high' && a.detectedSection === 'expense',
    'classification preserve: remaining classification fields must survive');
  check(ow.changedCells === 0, `classification preserve: identical value should not count as changed, got ${ow.changedCells}`);
}

// ── Scenario 19: mergeOverwrite adopts a brand-new incoming account with its
//    full (backfilled) history ────────────────────────────────────────────────
{
  const ea = [acc('e1', 'Sales', 'revenue', '4000')];
  const ev = [val('e1', 2026, 1, 100), val('e1', 2026, 2, 200)];
  const ia = [acc('i1', 'Sales', 'revenue', '4000'), accX('i2', 'Delivery', 'expense', '5300', 'qbo-77')];
  const iv = [
    val('i1', 2026, 1, 100), val('i1', 2026, 2, 200),
    val('i2', 2026, 1, 20), val('i2', 2026, 2, 25),
  ];
  const ow = mergeOverwrite(ea, ev, ia, iv);
  check(ow.addedAccounts === 1 && ow.accounts.length === 2, `overwrite adopt: 1 new account, got ${ow.addedAccounts}/${ow.accounts.length}`);
  check(ow.changedCells === 0 && ow.addedPeriods === 0, `overwrite adopt: backfill is not a restatement, got ${ow.changedCells}/${ow.addedPeriods}`);
  const deliveryVals = ow.values.filter((v) => v.accountId === 'i2');
  check(deliveryVals.length === 2 && deliveryVals[0]!.amount === 20 && deliveryVals[1]!.amount === 25,
    `overwrite adopt: full history should come in, got ${JSON.stringify(deliveryVals.map((v) => v.amount))}`);
}

// ── Scenario 20: realm switch — the workspace reconnects to a DIFFERENT QBO
//    company. Every account carries a realm-qualified externalId, so the
//    externalIdConflict guard blocks BOTH the number and name fallbacks: the
//    new company arrives as new accounts, never a fake restatement. ───────────
{
  const ea = [
    accX('e1', 'Rent', 'expense', '6300', '9130001:12'),
    accX('e2', 'Truck Loan', 'liability', undefined, '9130001:44'),
  ];
  const ev = [val('e1', 2026, 1, 3000), val('e2', 2026, 1, 25000)];
  // Same names AND same account numbers — but a different company (realm).
  const ia = [
    accX('i1', 'Rent', 'expense', '6300', '4620816365:12'),
    accX('i2', 'Truck Loan', 'liability', undefined, '4620816365:44'),
  ];
  const iv = [val('i1', 2026, 1, 2800), val('i2', 2026, 1, 18000)];

  const diff = diffImport(ea, ev, ia, iv);
  check(diff.newAccounts.length === 2, `realm switch: both accounts arrive NEW, got ${diff.newAccounts.length}`);
  check(diff.matchedCells === 0 && diff.changedCells.length === 0, `realm switch: no cell ever compared, got ${diff.matchedCells} matched / ${diff.changedCells.length} changed`);

  const ow = mergeOverwrite(ea, ev, ia, iv);
  check(ow.accounts.length === 4 && ow.addedAccounts === 2, `realm switch overwrite: old and new company coexist, got ${ow.accounts.length}/${ow.addedAccounts}`);
  check(ow.changedCells === 0, `realm switch overwrite: never a fake restatement, got ${ow.changedCells}`);
  check(
    ow.accounts.find((a) => a.id === 'e1') === ea[0] && ow.accounts.find((a) => a.id === 'e2') === ea[1],
    'realm switch overwrite: old company accounts untouched (same references)'
  );
  const oldRent = ow.values.filter((v) => v.accountId === 'e1');
  const oldLoan = ow.values.filter((v) => v.accountId === 'e2');
  check(
    oldRent.length === 1 && oldRent[0]!.amount === 3000 && oldLoan.length === 1 && oldLoan[0]!.amount === 25000,
    'realm switch overwrite: old company values survive untouched'
  );
}

// ── Scenario 21: a genuine QBO account named like a summary row ('Total
//    Income') must NOT match the CSV import's auto-excluded placeholder — its
//    values would vanish from calcs (isExcluded) while the placeholder
//    adopted the externalId. It lands as a NEW account instead. ───────────────
{
  const placeholder: Account = { id: 'e2', name: 'Total Income', type: 'revenue', isManuallyClassified: false, isExcluded: true };
  const ea = [acc('e1', 'Food Sales', 'revenue', '4000'), placeholder];
  const ev = [val('e1', 2026, 1, 9000), val('e2', 2026, 1, 10000)];
  const ia = [
    accX('i1', 'Food Sales', 'revenue', '4000', '9130001:1'),
    accX('i2', 'Total Income', 'revenue', undefined, '9130001:490'),
  ];
  const iv = [val('i1', 2026, 1, 9000), val('i2', 2026, 1, 250)];

  const diff = diffImport(ea, ev, ia, iv);
  check(
    diff.newAccounts.length === 1 && diff.newAccounts[0]!.name === 'Total Income',
    `summary placeholder: genuine QBO account lands as NEW, got ${JSON.stringify(diff.newAccounts)}`
  );
  check(diff.changedCells.length === 0, `summary placeholder: 10000 vs 250 never compared, got ${diff.changedCells.length} changed`);

  const ow = mergeOverwrite(ea, ev, ia, iv);
  check(ow.accounts.length === 3 && ow.addedAccounts === 1, `summary placeholder overwrite: 2 existing + 1 new, got ${ow.accounts.length}/${ow.addedAccounts}`);
  const ph = ow.accounts.find((a) => a.id === 'e2');
  check(
    ph === placeholder && ph.externalId === undefined && ph.isExcluded === true,
    'summary placeholder overwrite: placeholder untouched — no externalId adopted, still excluded'
  );
  const phVals = ow.values.filter((v) => v.accountId === 'e2');
  check(phVals.length === 1 && phVals[0]!.amount === 10000, 'summary placeholder overwrite: placeholder values untouched');
  const genuineVals = ow.values.filter((v) => v.accountId === 'i2');
  check(genuineVals.length === 1 && genuineVals[0]!.amount === 250, 'summary placeholder overwrite: genuine account keeps its own 250');

  // The number tier is guarded too — a numbered placeholder must not absorb a
  // same-numbered genuine QBO row.
  const eaNum: Account[] = [{ ...acc('e3', 'Total Income', 'revenue', '4900'), isExcluded: true }];
  const iaNum = [accX('i3', 'Total Income', 'revenue', '4900', '9130001:491')];
  const numDiff = diffImport(eaNum, [val('e3', 2026, 1, 1)], iaNum, [val('i3', 2026, 1, 2)]);
  check(numDiff.newAccounts.length === 1, 'summary placeholder: number tier guarded too');

  // Back-compat: a CSV re-import (no externalId) still matches the placeholder
  // onto itself, so identical re-imports stay 'identical'.
  const csvAgain = diffImport(
    ea,
    ev,
    [acc('c1', 'Food Sales', 'revenue', '4000'), { ...acc('c2', 'Total Income', 'revenue'), isExcluded: true }],
    [val('c1', 2026, 1, 9000), val('c2', 2026, 1, 10000)]
  );
  check(
    csvAgain.status === 'identical' && csvAgain.newAccounts.length === 0,
    `summary placeholder back-compat: CSV re-import still matches, got ${csvAgain.status}/${csvAgain.newAccounts.length} new`
  );
}

if (failures > 0) {
  console.error(`\n${failures} dataset check(s) FAILED`);
  process.exit(1);
}
console.log('All dataset checks passed.');
