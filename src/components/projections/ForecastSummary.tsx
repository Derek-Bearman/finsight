'use client';

/**
 * Forecast summary tiles + key-account breakdown that supplements the
 * projection chart: headline projected revenue / net income / implied growth,
 * plus the largest revenue and expense accounts with their projected next-12-
 * month total vs the trailing-12 actual. Pure presentational.
 */

import { useMemo } from 'react';
import type { Account, AccountValue } from '@/types';
import type { WorkspaceProjectionResult } from '@/lib/projections/workspace-projections';
import { formatCurrency, formatPercent } from '@/lib/utils/format';

function abbrev(v: number): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border p-4 flex flex-col gap-1" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>{label}</p>
      <p className="text-xl font-bold" style={{ color: accent ? 'hsl(217 91% 55%)' : 'hsl(var(--foreground))' }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{sub}</p>}
    </div>
  );
}

export function ForecastSummary({
  result,
  accounts,
  values,
  modelLabel,
}: {
  result: WorkspaceProjectionResult;
  accounts: Account[];
  values: AccountValue[];
  modelLabel: string;
}) {
  const projected = result.rolledUp.filter((r) => r.isProjected);
  const historical = result.rolledUp.filter((r) => !r.isProjected);

  const projRev12 = projected.slice(0, 12).reduce((s, r) => s + r.revenue, 0);
  const projNi12 = projected.slice(0, 12).reduce((s, r) => s + r.netIncome, 0);

  const impliedGrowth = useMemo(() => {
    if (!historical.length || !projected.length) return null;
    const lastHist = historical[historical.length - 1]!.revenue;
    const lastProj = projected[projected.length - 1]!.revenue;
    const months = projected.length;
    if (lastHist > 0 && months > 0) return Math.pow(lastProj / lastHist, 12 / months) - 1;
    return null;
  }, [historical, projected]);

  // Per-account: projected next-12-mo total vs trailing-12 actual.
  const accountRows = useMemo(() => {
    const active = accounts.filter((a) => !a.isExcluded && (a.type === 'revenue' || a.type === 'expense' || a.type === 'cogs'));
    const projByAcct = new Map(result.accountProjections.map((p) => [p.accountId, p.points]));

    // trailing-12 actuals per account
    const sorted = [...values].sort(
      (a, b) => a.period.year * 12 + a.period.month - (b.period.year * 12 + b.period.month)
    );
    const periodsDesc = Array.from(
      new Set(sorted.map((v) => `${v.period.year}-${String(v.period.month).padStart(2, '0')}`))
    ).sort().slice(-12);
    const last12 = new Set(periodsDesc);

    const rows = active.map((a) => {
      const pts = projByAcct.get(a.id) ?? [];
      const proj12 = pts.slice(0, 12).reduce((s, p) => s + p.value, 0);
      const actual12 = values
        .filter((v) => v.accountId === a.id && last12.has(`${v.period.year}-${String(v.period.month).padStart(2, '0')}`))
        .reduce((s, v) => s + v.amount, 0);
      return { account: a, proj12, actual12, delta: proj12 - actual12 };
    });

    const revenue = rows.filter((r) => r.account.type === 'revenue').sort((a, b) => b.proj12 - a.proj12).slice(0, 3);
    const costs = rows.filter((r) => r.account.type !== 'revenue').sort((a, b) => b.proj12 - a.proj12).slice(0, 3);
    return [...revenue, ...costs];
  }, [accounts, values, result.accountProjections]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile label="Projected Revenue (12 mo)" value={abbrev(projRev12)} sub="Next 12 projected months" accent />
        <Tile
          label="Projected Net Income (12 mo)"
          value={abbrev(projNi12)}
          sub="Next 12 projected months"
          accent={projNi12 >= 0}
        />
        <Tile
          label="Implied Growth Rate"
          value={impliedGrowth !== null ? formatPercent(impliedGrowth) : '—'}
          sub={`Annualized · ${modelLabel} model`}
        />
      </div>

      {accountRows.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))', borderBottom: '1px solid hsl(var(--border))' }}>
            Key Accounts — Next 12 Months (Projected vs Trailing Actual)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  <th className="text-left px-4 py-1.5 font-medium">Account</th>
                  <th className="text-right px-4 py-1.5 font-medium">Trailing 12</th>
                  <th className="text-right px-4 py-1.5 font-medium">Projected 12</th>
                  <th className="text-right px-4 py-1.5 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {accountRows.map((r) => (
                  <tr key={r.account.id} style={{ borderTop: '1px solid hsl(var(--border))' }}>
                    <td className="px-4 py-1.5" style={{ color: 'hsl(var(--foreground))' }}>
                      {r.account.name}
                      <span className="ml-1.5 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                        {r.account.type === 'revenue' ? 'revenue' : r.account.type === 'cogs' ? 'COGS' : 'expense'}
                      </span>
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums" style={{ color: 'hsl(var(--muted-foreground))' }}>{formatCurrency(r.actual12)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums font-semibold" style={{ color: 'hsl(var(--foreground))' }}>{formatCurrency(r.proj12)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums" style={{ color: r.delta >= 0 ? 'hsl(142 71% 40%)' : 'hsl(0 72% 45%)' }}>
                      {r.delta >= 0 ? '+' : ''}{abbrev(r.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
