import type { Account, AccountValue } from '@/types';

/** Returns a Map<accountId, latestAmount> for each account */
export function getLatestAmounts(
  accounts: Account[],
  values: AccountValue[]
): Map<string, number> {
  const latestPeriod = new Map<string, { year: number; month: number }>();
  const latestAmount = new Map<string, number>();

  for (const v of values) {
    const existing = latestPeriod.get(v.accountId);
    if (
      !existing ||
      v.period.year > existing.year ||
      (v.period.year === existing.year && v.period.month > existing.month)
    ) {
      latestPeriod.set(v.accountId, v.period);
      latestAmount.set(v.accountId, v.amount);
    }
  }
  return latestAmount;
}

/** Returns the column total (sum of latest amounts) for a set of account IDs */
export function columnTotal(
  accountIds: string[],
  latestAmounts: Map<string, number>
): number {
  return accountIds.reduce((sum, id) => sum + (latestAmounts.get(id) ?? 0), 0);
}

/** Format a number as currency */
export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}
