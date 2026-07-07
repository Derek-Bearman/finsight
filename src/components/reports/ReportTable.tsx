'use client';

import React from 'react';
import type { MetricRowProps } from './MetricRow';
import { MetricRow } from './MetricRow';

export interface ReportTableProps {
  title: string;
  periods: string[];
  rows: MetricRowProps[];
  periodCount?: number;
  showChange?: boolean;
  /** Fit the table to its container width (print pages can't scroll horizontally). */
  fit?: boolean;
}

export function ReportTable({ title, periods, rows, periodCount, showChange = false, fit = false }: ReportTableProps) {
  const displayPeriods = periodCount !== undefined ? periods.slice(-periodCount) : periods;
  const skipCount = periods.length - displayPeriods.length;

  // Slice values for each row to match displayPeriods
  const slicedRows: MetricRowProps[] = rows.map(row => ({
    ...row,
    values: row.isSeparator ? row.values : row.values.slice(skipCount),
    showChange: row.showChange ?? showChange,
    dense: fit,
  }));

  return (
    <div className="mb-6">
      {/* Section title */}
      <div
        className="px-3 py-2 text-xs font-semibold uppercase tracking-wider rounded-t"
        style={{
          background: 'hsl(var(--muted))',
          color: 'hsl(var(--muted-foreground))',
          borderBottom: '1px solid hsl(var(--border))',
        }}
      >
        {title}
      </div>

      {/* Scrollable table */}
      <div
        className="overflow-x-auto"
        style={{
          borderLeft: '1px solid hsl(var(--border))',
          borderRight: '1px solid hsl(var(--border))',
          borderBottom: '1px solid hsl(var(--border))',
          borderRadius: '0 0 0.375rem 0.375rem',
          background: 'hsl(var(--card))',
        }}
      >
        <table className="w-full border-collapse" style={fit ? undefined : { minWidth: `${Math.max(400, displayPeriods.length * 120 + 240)}px` }}>
          <thead>
            <tr style={{ borderBottom: '1px solid hsl(var(--border))' }}>
              {/* Label header */}
              <th
                className={`${fit ? 'px-1.5 py-1' : 'px-3 py-2'} text-left text-xs font-medium uppercase tracking-wide`}
                style={{
                  color: 'hsl(var(--muted-foreground))',
                  position: 'sticky',
                  left: 0,
                  background: 'hsl(var(--muted))',
                  borderRight: '1px solid hsl(var(--border))',
                  zIndex: 2,
                  minWidth: fit ? '120px' : '180px',
                }}
              >
                Metric
              </th>

              {/* Period headers */}
              {displayPeriods.map((p, i) => (
                <th
                  key={i}
                  className={`${fit ? 'px-1.5 py-1' : 'px-3 py-2'} text-right text-xs font-medium uppercase tracking-wide`}
                  style={{ color: 'hsl(var(--muted-foreground))', background: 'hsl(var(--muted))', whiteSpace: 'nowrap' }}
                >
                  {p}
                </th>
              ))}

              {/* Change header */}
              {showChange && (
                <th
                  className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide"
                  style={{ color: 'hsl(var(--muted-foreground))', background: 'hsl(var(--muted))', whiteSpace: 'nowrap' }}
                >
                  Change
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {slicedRows.map((row, i) => (
              <MetricRow key={i} {...row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
