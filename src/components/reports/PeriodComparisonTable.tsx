'use client';

import React, { useState } from 'react';
import type { Account, AccountValue, Period, AccountType } from '@/types';
import { formatCurrency, formatPercent } from '@/lib/utils/format';
import { periodLabel } from '@/lib/utils/period';

export interface PeriodComparisonTableProps {
  accounts: Account[];
  values: AccountValue[];
  periodA: Period;
  periodB: Period;
  labelA: string;
  labelB: string;
}

function getAmountForPeriod(
  accountId: string,
  values: AccountValue[],
  period: Period
): number {
  return values
    .filter(v => v.accountId === accountId && v.period.year === period.year && v.period.month === period.month)
    .reduce((s, v) => s + v.amount, 0);
}

function isFavorable(variance: number, type: AccountType): boolean {
  // Revenue/asset increase = good, expense/liability/cogs increase = bad
  if (type === 'revenue' || type === 'asset' || type === 'equity') return variance > 0;
  return variance < 0;
}

const ALL_TYPES: AccountType[] = ['revenue', 'cogs', 'expense', 'asset', 'liability', 'equity'];
const TYPE_LABELS: Record<AccountType, string> = {
  revenue: 'Revenue',
  cogs: 'COGS',
  expense: 'Expenses',
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
};

export function PeriodComparisonTable({
  accounts,
  values,
  periodA,
  periodB,
  labelA,
  labelB,
}: PeriodComparisonTableProps) {
  const [filterType, setFilterType] = useState<AccountType | 'all'>('all');

  const displayAccounts = filterType === 'all'
    ? accounts
    : accounts.filter(a => a.type === filterType);

  const rows = displayAccounts.map(account => {
    const a = getAmountForPeriod(account.id, values, periodA);
    const b = getAmountForPeriod(account.id, values, periodB);
    const variance = b - a;
    const variancePct = a !== 0 ? variance / Math.abs(a) : null;
    const favorable = isFavorable(variance, account.type);
    return { account, a, b, variance, variancePct, favorable };
  });

  const hasData = accounts.length > 0;

  if (!hasData) {
    return (
      <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'hsl(var(--border))' }}>
        <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
          No accounts to compare.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Type filter pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(['all', ...ALL_TYPES] as const).map(t => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className="px-3 py-1 rounded-full text-xs font-medium border transition-colors"
            style={{
              background: filterType === t ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
              color: filterType === t ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
              borderColor: filterType === t ? 'hsl(var(--primary))' : 'hsl(var(--border))',
            }}
          >
            {t === 'all' ? 'All' : TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Table */}
      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'hsl(var(--border))' }}
      >
        <table className="w-full text-sm border-collapse" style={{ minWidth: '600px' }}>
          <thead>
            <tr style={{ background: 'hsl(var(--muted))', borderBottom: '1px solid hsl(var(--border))' }}>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Account
              </th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-right" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {labelA}
              </th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-right" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {labelB}
              </th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-right" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Variance $
              </th>
              <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-right" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Variance %
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  No accounts in this category.
                </td>
              </tr>
            ) : (
              rows.map(({ account, a, b, variance, variancePct, favorable }, i) => {
                const varColor = variance === 0
                  ? 'hsl(var(--muted-foreground))'
                  : favorable
                  ? 'hsl(142 71% 45%)'
                  : 'hsl(0 84% 60%)';

                return (
                  <tr
                    key={account.id}
                    style={{ borderBottom: i < rows.length - 1 ? '1px solid hsl(var(--border))' : 'none' }}
                  >
                    <td className="px-4 py-2 font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                      {account.name}
                      <span
                        className="ml-2 rounded px-1 py-0.5 text-xs"
                        style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
                      >
                        {account.type}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'hsl(var(--foreground))' }}>
                      {formatCurrency(a)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'hsl(var(--foreground))' }}>
                      {formatCurrency(b)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium" style={{ color: varColor }}>
                      {formatCurrency(variance)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium" style={{ color: varColor }}>
                      {variancePct !== null ? formatPercent(variancePct) : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
