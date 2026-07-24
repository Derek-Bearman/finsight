import type { Account, AccountValue, ClientWorkspace } from '@/types';

export interface KeyAccount {
  id: string;
  name: string;
  type: Account['type'];
}

/**
 * The largest revenue and cost accounts by trailing total — the ones worth a
 * dedicated What-If slider. Top `perSide` of each (default 3), excluded rows
 * skipped.
 */
export function getKeyAccounts(ws: ClientWorkspace, perSide = 3): KeyAccount[] {
  const total = new Map<string, number>();
  for (const v of ws.values) total.set(v.accountId, (total.get(v.accountId) ?? 0) + Math.abs(v.amount));

  const pick = (types: Account['type'][]) =>
    ws.accounts
      .filter((a) => !a.isExcluded && types.includes(a.type))
      .map((a) => ({ id: a.id, name: a.name, type: a.type, mag: total.get(a.id) ?? 0 }))
      .sort((a, b) => b.mag - a.mag)
      .slice(0, perSide)
      .map(({ id, name, type }) => ({ id, name, type }));

  return [...pick(['revenue']), ...pick(['expense', 'cogs'])];
}

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

