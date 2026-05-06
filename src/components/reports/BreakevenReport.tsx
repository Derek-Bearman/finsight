'use client';

import React from 'react';
import type { BreakevenResult } from '@/types';
import type { Granularity } from '@/lib/calculations/period-aggregation';
import type { MetricRowProps } from './MetricRow';
import { ReportTable } from './ReportTable';
import { periodLabel, quarterLabel } from '@/lib/utils/period';

export interface BreakevenReportProps {
  series: BreakevenResult[];
  granularity: Granularity;
}

function getPeriodLabel(r: BreakevenResult, granularity: Granularity): string {
  switch (granularity) {
    case 'monthly':   return periodLabel(r.period);
    case 'quarterly': return quarterLabel(r.period);
    case 'annual':    return `FY${r.period.year}`;
    case 'ttm':       return 'TTM';
  }
}

export function BreakevenReport({ series, granularity }: BreakevenReportProps) {
  if (series.length === 0) {
    return (
      <div
        className="rounded-xl border p-8 text-center"
        style={{ borderColor: 'hsl(var(--border))' }}
      >
        <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
          No financial data available for breakeven analysis.
        </p>
      </div>
    );
  }

  const periods = series.map(r => getPeriodLabel(r, granularity));
  const latest = series[series.length - 1];
  const isBelowBreakeven = latest !== undefined && latest.marginOfSafety < 0;

  function vals<K extends keyof BreakevenResult>(key: K): (number | null)[] {
    return series.map(r => {
      const v = r[key];
      return typeof v === 'number' ? v : null;
    });
  }

  const hasUnits = series.some(r => r.breakevenUnits !== undefined);

  const rows: MetricRowProps[] = [
    {
      label: 'Breakeven Revenue',
      values: vals('breakevenRevenue'),
      format: 'currency',
      isHighlight: true,
      showChange: false,
    },
    {
      label: 'Actual Revenue',
      values: vals('actualRevenue'),
      format: 'currency',
      showChange: true,
    },
    {
      label: 'Margin of Safety ($)',
      values: vals('marginOfSafety'),
      format: 'currency',
      showChange: true,
    },
    {
      label: 'Margin of Safety (%)',
      values: vals('marginOfSafetyPct'),
      format: 'percent',
      isSubtotal: true,
      showChange: true,
      invertChange: false,
      benchmark: { good: 0.2, warn: 0.05, bad: 0, direction: 'higher' },
    },
    {
      label: '',
      values: series.map(() => null),
      format: 'currency',
      isSeparator: true,
    },
    {
      label: 'Fixed Costs',
      values: vals('fixedCosts'),
      format: 'currency',
      showChange: true,
      invertChange: true,
    },
    {
      label: 'Contribution Margin %',
      values: vals('contributionMarginPct'),
      format: 'percent',
      showChange: true,
      benchmark: { good: 0.4, warn: 0.2, bad: 0, direction: 'higher' },
    },
    {
      label: 'Operating Leverage',
      sublabel: 'Higher = more leverage',
      values: vals('operatingLeverage'),
      format: 'ratio',
      showChange: false,
    },
    ...(hasUnits
      ? [
          {
            label: 'Breakeven Units',
            values: series.map(r => r.breakevenUnits ?? null),
            format: 'number' as const,
            showChange: false,
          },
        ]
      : []),
  ];

  return (
    <div>
      {/* Below-breakeven alert */}
      {isBelowBreakeven && (
        <div
          className="mb-4 rounded-lg border px-4 py-3 text-sm font-medium"
          style={{
            borderColor: 'hsl(0 84% 60% / 0.4)',
            background: 'hsl(0 84% 60% / 0.08)',
            color: 'hsl(0 72% 50%)',
          }}
        >
          ⚠ Below breakeven — revenue is below breakeven threshold.
        </div>
      )}

      <ReportTable
        title="Breakeven Analysis"
        periods={periods}
        rows={rows}
        showChange={false}
      />
    </div>
  );
}
