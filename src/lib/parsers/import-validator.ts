/**
 * Import validation functions for financial data.
 * All pure functions, no side effects, no React imports.
 */

import type {
  Account,
  AccountValue,
  ImportValidationWarning,
  Period,
  StatementType,
} from '@/types';

// ─────────────────────────────────────────────
// Helper: sum AccountValues for a given filter
// ─────────────────────────────────────────────

/** Returns a unique string key for a Period. */
function periodKey(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/**
 * Sums the amounts for all AccountValues whose accountId is in `ids`.
 * Groups results by period key.
 */
function sumByPeriod(
  values: AccountValue[],
  ids: Set<string>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const v of values) {
    if (!ids.has(v.accountId)) continue;
    const key = periodKey(v.period);
    totals.set(key, (totals.get(key) ?? 0) + v.amount);
  }
  return totals;
}

/** Returns all unique period keys present in a set of AccountValues. */
function allPeriodKeys(values: AccountValue[]): Set<string> {
  const keys = new Set<string>();
  for (const v of values) keys.add(periodKey(v.period));
  return keys;
}

// ─────────────────────────────────────────────
// Individual checks
// ─────────────────────────────────────────────

/** Check 1 — Balance sheet balance: assets should equal liabilities + equity per period. */
function checkBalanceSheetBalance(
  accounts: Account[],
  values: AccountValue[],
): ImportValidationWarning[] {
  const warnings: ImportValidationWarning[] = [];

  const assetIds = new Set(accounts.filter((a) => a.type === 'asset').map((a) => a.id));
  const liabIds = new Set(accounts.filter((a) => a.type === 'liability').map((a) => a.id));
  const eqIds = new Set(accounts.filter((a) => a.type === 'equity').map((a) => a.id));

  const assetTotals = sumByPeriod(values, assetIds);
  const liabTotals = sumByPeriod(values, liabIds);
  const eqTotals = sumByPeriod(values, eqIds);

  const periods = allPeriodKeys(values);

  for (const key of periods) {
    const assets = assetTotals.get(key) ?? 0;
    const liabAndEq = (liabTotals.get(key) ?? 0) + (eqTotals.get(key) ?? 0);
    const difference = assets - liabAndEq;
    const absDiff = Math.abs(difference);

    // Flag if |difference| > $1 or > 0.01% of total assets
    const pctThreshold = Math.abs(assets) * 0.0001;
    if (absDiff > 1 || absDiff > pctThreshold) {
      warnings.push({
        type: 'balance_sheet_mismatch',
        severity: 'warning',
        message:
          `Balance sheet out of balance for period ${key}: ` +
          `assets = ${assets.toFixed(2)}, liabilities + equity = ${liabAndEq.toFixed(2)}, ` +
          `difference = ${difference.toFixed(2)}`,
      });
    }
  }

  return warnings;
}

/** Check 2 — Duplicate account numbers. */
function checkDuplicateAccountNumbers(accounts: Account[]): ImportValidationWarning[] {
  const warnings: ImportValidationWarning[] = [];
  const seen = new Map<string, string>(); // number → first accountId

  for (const account of accounts) {
    if (!account.number) continue;
    const existing = seen.get(account.number);
    if (existing !== undefined) {
      warnings.push({
        type: 'duplicate_account_number',
        severity: 'warning',
        accountId: account.id,
        message: `Duplicate account number "${account.number}" on account "${account.name}" (first seen on account id "${existing}")`,
      });
    } else {
      seen.set(account.number, account.id);
    }
  }

  return warnings;
}

/** Check 3 — Blank account names. */
function checkBlankAccountNames(accounts: Account[]): ImportValidationWarning[] {
  return accounts
    .filter((a) => !a.name || a.name.trim() === '')
    .map((a) => ({
      type: 'blank_account_name' as const,
      severity: 'error' as const,
      accountId: a.id,
      message: `Account id "${a.id}" has a blank or whitespace-only name`,
    }));
}

/** Check 4 — Suspiciously large amounts (|amount| > $50,000,000). */
function checkSuspiciouslyLargeAmounts(
  accounts: Account[],
  values: AccountValue[],
): ImportValidationWarning[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const THRESHOLD = 50_000_000;

  return values
    .filter((v) => Math.abs(v.amount) > THRESHOLD)
    .map((v) => {
      const acct = accountById.get(v.accountId);
      const name = acct ? acct.name : v.accountId;
      return {
        type: 'suspiciously_large_amount' as const,
        severity: 'warning' as const,
        accountId: v.accountId,
        message:
          `Account "${name}" has a suspiciously large amount of ${v.amount.toFixed(2)} ` +
          `for period ${periodKey(v.period)} (threshold: $${THRESHOLD.toLocaleString()})`,
      };
    });
}

/** Check 5 — Negative revenue accounts. */
function checkNegativeRevenue(
  accounts: Account[],
  values: AccountValue[],
): ImportValidationWarning[] {
  const warnings: ImportValidationWarning[] = [];

  const revenueAccounts = accounts.filter((a) => a.type === 'revenue');
  const valuesByAccount = new Map<string, number>();

  for (const v of values) {
    valuesByAccount.set(v.accountId, (valuesByAccount.get(v.accountId) ?? 0) + v.amount);
  }

  for (const account of revenueAccounts) {
    const total = valuesByAccount.get(account.id) ?? 0;
    if (total < 0) {
      warnings.push({
        type: 'negative_revenue',
        severity: 'warning',
        accountId: account.id,
        message:
          `Revenue account "${account.name}" has a negative total of ${total.toFixed(2)} across all periods. ` +
          `It may be misclassified or represent a returns/refunds account.`,
      });
    }
  }

  return warnings;
}

/** Check 6 — All-zero accounts (present in every period but always $0). */
function checkAllZeroAccounts(
  accounts: Account[],
  values: AccountValue[],
): ImportValidationWarning[] {
  const warnings: ImportValidationWarning[] = [];

  // Build a map: accountId → set of period keys with non-zero values
  const nonZeroByAccount = new Map<string, Set<string>>();
  const allPeriodsForAccount = new Map<string, Set<string>>();

  for (const v of values) {
    const pk = periodKey(v.period);
    if (!allPeriodsForAccount.has(v.accountId)) {
      allPeriodsForAccount.set(v.accountId, new Set());
    }
    allPeriodsForAccount.get(v.accountId)!.add(pk);

    if (v.amount !== 0) {
      if (!nonZeroByAccount.has(v.accountId)) {
        nonZeroByAccount.set(v.accountId, new Set());
      }
      nonZeroByAccount.get(v.accountId)!.add(pk);
    }
  }

  const globalPeriods = allPeriodKeys(values);
  if (globalPeriods.size === 0) return [];

  for (const account of accounts) {
    const accountPeriods = allPeriodsForAccount.get(account.id);
    // Only flag if the account has values for every period
    if (!accountPeriods || accountPeriods.size < globalPeriods.size) continue;

    const nonZero = nonZeroByAccount.get(account.id);
    if (!nonZero || nonZero.size === 0) {
      warnings.push({
        type: 'balance_sheet_mismatch', // closest available type; using a generic warning
        severity: 'info',
        accountId: account.id,
        message:
          `Account "${account.name}" has values in every period but they are all $0. ` +
          `It may be unused or a duplicate.`,
      });
    }
  }

  return warnings;
}

// ─────────────────────────────────────────────
// Balance sheet export
// ─────────────────────────────────────────────

/**
 * Returns a per-period breakdown of assets vs liabilities+equity for balance sheet validation.
 *
 * @param accounts - All accounts in the import.
 * @param values   - All AccountValues in the import.
 * @returns Array of period-level balance comparisons.
 */
export function validateBalanceSheet(
  accounts: Account[],
  values: AccountValue[],
): { period: Period; assets: number; liabilitiesAndEquity: number; difference: number }[] {
  const assetIds = new Set(accounts.filter((a) => a.type === 'asset').map((a) => a.id));
  const liabIds = new Set(accounts.filter((a) => a.type === 'liability').map((a) => a.id));
  const eqIds = new Set(accounts.filter((a) => a.type === 'equity').map((a) => a.id));

  const assetTotals = sumByPeriod(values, assetIds);
  const liabTotals = sumByPeriod(values, liabIds);
  const eqTotals = sumByPeriod(values, eqIds);

  // Collect unique periods from values
  const periodMap = new Map<string, Period>();
  for (const v of values) {
    const key = periodKey(v.period);
    if (!periodMap.has(key)) periodMap.set(key, v.period);
  }

  return Array.from(periodMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, period]) => {
      const assets = assetTotals.get(key) ?? 0;
      const liabilitiesAndEquity = (liabTotals.get(key) ?? 0) + (eqTotals.get(key) ?? 0);
      return { period, assets, liabilitiesAndEquity, difference: assets - liabilitiesAndEquity };
    });
}

// ─────────────────────────────────────────────
// Main validator
// ─────────────────────────────────────────────

/**
 * Runs all applicable import validation checks and returns a flat array of warnings.
 *
 * Checks performed:
 * 1. Balance sheet balance (balance_sheet only)
 * 2. Duplicate account numbers
 * 3. Blank account names
 * 4. Suspiciously large amounts (|amount| > $50M)
 * 5. Negative revenue totals
 * 6. All-zero accounts present in every period
 *
 * @param accounts      - The accounts to validate.
 * @param values        - The AccountValues to validate.
 * @param statementType - Determines which checks are applicable.
 * @returns Array of ImportValidationWarning objects (may be empty).
 */
export function validateImport(
  accounts: Account[],
  values: AccountValue[],
  statementType: StatementType,
): ImportValidationWarning[] {
  const warnings: ImportValidationWarning[] = [];

  // Check 1 — Balance sheet balance (only for balance_sheet imports)
  if (statementType === 'balance_sheet') {
    warnings.push(...checkBalanceSheetBalance(accounts, values));
  }

  // Check 2 — Duplicate account numbers
  warnings.push(...checkDuplicateAccountNumbers(accounts));

  // Check 3 — Blank account names
  warnings.push(...checkBlankAccountNames(accounts));

  // Check 4 — Suspiciously large amounts
  warnings.push(...checkSuspiciouslyLargeAmounts(accounts, values));

  // Check 5 — Negative revenue
  warnings.push(...checkNegativeRevenue(accounts, values));

  // Check 6 — All-zero accounts
  warnings.push(...checkAllZeroAccounts(accounts, values));

  return warnings;
}
