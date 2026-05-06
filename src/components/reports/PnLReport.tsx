'use client';

import React from 'react';
import type { PeriodAggregation } from '@/types';
import type { Granularity } from '@/lib/calculations/period-aggregation';
import type { MetricRowProps } from './MetricRow';
import { ReportTable } from './ReportTable';

export interface PnLReportProps {
  aggregations: PeriodAggregation[];
  granularity: Granularity;
}

export function PnLReport({ aggregations }: PnLReportProps) {
  if (aggregations.length === 0) {
    return (
      <div
        className="rounded-xl border p-8 text-center"
        style={{ borderColor: 'hsl(var(--border))' }}
      >
        <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
          No financial data available for this period.
        </p>
      </div>
    );
  }

  const periods = aggregations.map(a => a.label);

  function vals(key: keyof PeriodAggregation): (number | null)[] {
    return aggregations.map(a => {
      const v = a[key];
      return typeof v === 'number' ? v : null;
    });
  }

  const rows: MetricRowProps[] = [
    {
      label: 'Revenue',
      values: vals('revenue'),
      format: 'currency',
      isHighlight: true,
      showChange: true,
    },
    {
      label: 'Cost of Goods Sold',
      values: vals('cogs'),
      format: 'currency',
      showChange: true,
      invertChange: true,
    },
    {
      label: 'Gross Profit',
      sublabel: 'Gross Margin %',
      values: vals('grossProfit'),
      format: 'currency',
      isHighlight: true,
      showChange: true,
    },
    {
      label: 'Gross Margin %',
      values: vals('grossMarginPct'),
      format: 'percent',
      isSubtotal: true,
      showChange: true,
      benchmark: { good: 0.4, warn: 0.2, bad: 0, direction: 'higher' },
    },
    {
      label: '',
      values: aggregations.map(() => null),
      format: 'currency',
      isSeparator: true,
    },
    {
      label: 'Fixed Costs',
      values: vals('totalFixedCosts'),
      format: 'currency',
      isSubtotal: true,
      showChange: true,
      invertChange: true,
    },
    {
      label: 'Variable Costs',
      values: vals('totalVariableCosts'),
      format: 'currency',
      isSubtotal: true,
      showChange: true,
      invertChange: true,
    },
    {
      label: 'Operating Expenses',
      values: vals('operatingExpenses'),
      format: 'currency',
      showChange: true,
      invertChange: true,
    },
    {
      label: '',
      values: aggregations.map(() => null),
      format: 'currency',
      isSeparator: true,
    },
    {
      label: 'Operating Income',
      values: vals('operatingIncome'),
      format: 'currency',
      isHighlight: true,
      showChange: true,
    },
    {
      label: 'Operating Margin %',
      values: vals('operatingMarginPct'),
      format: 'percent',
      isSubtotal: true,
      showChange: true,
      benchmark: { good: 0.15, warn: 0.05, bad: 0, direction: 'higher' },
    },
    {
      label: 'Net Income',
      values: vals('netIncome'),
      format: 'currency',
      isHighlight: true,
      showChange: true,
    },
    {
      label: 'Net Margin %',
      values: vals('netMarginPct'),
      format: 'percent',
      isSubtotal: true,
      showChange: true,
      benchmark: { good: 0.1, warn: 0.03, bad: 0, direction: 'higher' },
    },
    {
      label: '',
      values: aggregations.map(() => null),
      format: 'currency',
      isSeparator: true,
    },
    {
      label: 'Contribution Margin',
      values: vals('contributionMargin'),
      format: 'currency',
      isHighlight: true,
      showChange: true,
    },
    {
      label: 'Contribution Margin %',
      values: vals('contributionMarginPct'),
      format: 'percent',
      isSubtotal: true,
      showChange: true,
      benchmark: { good: 0.4, warn: 0.2, bad: 0, direction: 'higher' },
    },
  ];

  return (
    <ReportTable
      title="Income Statement"
      periods={periods}
      rows={rows}
      showChange={false}
    />
  );
}
