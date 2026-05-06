'use client';

import React from 'react';
import type { WorkspaceProjectionResult } from '@/lib/projections/workspace-projections';
import { formatCurrency, formatPercent } from '@/lib/utils/format';

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────

export interface AnnualSummaryTableProps {
  annualSummary: WorkspaceProjectionResult['annualSummary'];
}

// ─────────────────────────────────────────────
// AnnualSummaryTable
// ─────────────────────────────────────────────

export function AnnualSummaryTable({ annualSummary }: AnnualSummaryTableProps) {
  if (annualSummary.length === 0) {
    return (
      <div
        className="rounded-xl border p-6 text-center"
        style={{ borderColor: 'hsl(var(--border))' }}
      >
        <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
          No annual data available.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: 'hsl(var(--border))' }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr
            style={{
              borderBottom: '1px solid hsl(var(--border))',
              background: 'hsl(var(--muted))',
            }}
          >
            {['Year', 'Revenue', 'Net Income', 'YoY Revenue Growth', 'Status'].map((col) => (
              <th
                key={col}
                className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide"
                style={{ color: 'hsl(var(--muted-foreground))' }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {annualSummary.map((row, idx) => {
            const prev = annualSummary[idx - 1];
            const yoyGrowth = prev && prev.revenue > 0
              ? (row.revenue - prev.revenue) / prev.revenue
              : null;

            const isProjected = row.isProjected;

            return (
              <tr
                key={row.year}
                style={{
                  borderBottom: idx < annualSummary.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                  background: isProjected ? 'hsl(217 91% 60% / 0.04)' : 'transparent',
                  opacity: isProjected ? 1 : 0.85,
                }}
              >
                {/* Year */}
                <td
                  className="px-4 py-2.5 font-semibold"
                  style={{ color: 'hsl(var(--foreground))' }}
                >
                  {row.year}
                </td>

                {/* Revenue */}
                <td
                  className="px-4 py-2.5 font-medium tabular-nums"
                  style={{ color: 'hsl(var(--foreground))' }}
                >
                  {formatCurrency(row.revenue)}
                </td>

                {/* Net Income */}
                <td
                  className="px-4 py-2.5 font-medium tabular-nums"
                  style={{
                    color:
                      row.netIncome >= 0
                        ? 'hsl(142 71% 40%)'
                        : 'hsl(0 84% 55%)',
                  }}
                >
                  {formatCurrency(row.netIncome)}
                </td>

                {/* YoY Growth */}
                <td
                  className="px-4 py-2.5 tabular-nums"
                  style={{
                    color:
                      yoyGrowth === null
                        ? 'hsl(var(--muted-foreground))'
                        : yoyGrowth >= 0
                        ? 'hsl(142 71% 40%)'
                        : 'hsl(0 84% 55%)',
                  }}
                >
                  {yoyGrowth === null
                    ? '—'
                    : `${yoyGrowth >= 0 ? '+' : ''}${formatPercent(yoyGrowth)}`}
                </td>

                {/* Status badge */}
                <td className="px-4 py-2.5">
                  {isProjected ? (
                    <span
                      className="inline-block rounded px-1.5 py-0.5 text-xs font-medium"
                      style={{
                        background: 'hsl(217 91% 60% / 0.15)',
                        color: 'hsl(217 91% 45%)',
                      }}
                    >
                      Projected
                    </span>
                  ) : (
                    <span
                      className="inline-block rounded px-1.5 py-0.5 text-xs font-medium"
                      style={{
                        background: 'hsl(var(--muted))',
                        color: 'hsl(var(--muted-foreground))',
                      }}
                    >
                      Actual
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
