/**
 * Account-TYPE classification engine checks, runnable headless:
 *   npx tsx scripts/checks/classifier.check.ts
 *
 * The type engine (classifyBaseline number-range + keyword logic, and
 * classifyAll's statement-type/section override) decides every account's
 * revenue/cogs/expense/asset/liability/equity type on the live CSV/manual-import
 * path — yet had ZERO check coverage (the QBO path takes type from Intuit and
 * never runs it). A regression to ACCOUNT_NUMBER_RANGES or ACCOUNT_TYPE_KEYWORDS
 * would silently corrupt every downstream calc while tsc + the other suites stay
 * green. This pins the ranges, representative keywords, the longest-match tie,
 * and the section-wins override.
 */

import { classifyBaseline, classifyAll } from '../../src/lib/classifiers';
import { getProfile } from '../../src/lib/profiles';
import type { AccountType } from '../../src/types';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

// ── Step 1: account-number ranges (1xxx..9xxx) ───────────────────────────────
const numCases: Array<[string, AccountType]> = [
  ['1000', 'asset'], ['1500', 'asset'],
  ['2000', 'liability'],
  ['3000', 'equity'],
  ['4000', 'revenue'],
  ['5000', 'cogs'],
  ['6000', 'expense'], ['7000', 'expense'],
  ['8000', 'revenue'],
  ['9000', 'expense'],
];
for (const [num, type] of numCases) {
  const r = classifyBaseline('Some Account', num);
  check(r.accountType === type, `account number ${num} should classify as ${type}, got ${r.accountType}`);
}

// ── Step 2: representative keyword type mapping (no number) ───────────────────
const kwCases: Array<[string, AccountType]> = [
  ['Sales', 'revenue'],
  ['Service Revenue', 'revenue'],
  ['Cost of Goods Sold', 'cogs'],
  ['Rent Expense', 'expense'],
  ['Business Checking', 'asset'],
  ['Accounts Payable', 'liability'],
  ['Retained Earnings', 'equity'],
];
for (const [name, type] of kwCases) {
  const r = classifyBaseline(name);
  check(r.accountType === type, `keyword '${name}' should classify as ${type}, got ${r.accountType}`);
}

// ── Longest-match tie: the most specific keyword wins across ALL type lists ───
// 'Sales Tax Payable' contains 'sales' (revenue) but 'sales tax payable'
// (liability) is longer, so it must win.
check(
  classifyBaseline('Sales Tax Payable').accountType === 'liability',
  `'Sales Tax Payable' should be liability via longest-match, got ${classifyBaseline('Sales Tax Payable').accountType}`
);

// ── classifyAll: section ALWAYS wins for a typed statement import ─────────────
// 'Customer Deposits' keyword-matches 'deposits' → asset, but under a LIABILITIES
// section on a balance-sheet import it must be typed as a liability.
{
  const profile = getProfile('generic-smb');
  const res = classifyAll(
    [{ id: 'a', name: 'Customer Deposits', section: 'liability' }],
    profile,
    'balance_sheet'
  );
  check(
    res.get('a')?.accountType === 'liability',
    `section-wins: 'Customer Deposits' under a LIABILITIES section should be liability, got ${res.get('a')?.accountType}`
  );
}

// ── classifyAll: unconstrained (mixed) import returns the raw keyword type ────
{
  const profile = getProfile('generic-smb');
  const res = classifyAll([{ id: 'r', name: 'Consulting Revenue' }], profile);
  check(
    res.get('r')?.accountType === 'revenue',
    `unconstrained classify: 'Consulting Revenue' should be revenue, got ${res.get('r')?.accountType}`
  );
}

if (failures > 0) {
  console.error(`\n${failures} classifier check(s) FAILED`);
  process.exit(1);
}
console.log('All classifier checks passed.');
