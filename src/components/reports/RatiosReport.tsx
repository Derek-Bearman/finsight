'use client';

import React from 'react';
import type { BalanceSheetRatios, EfficiencyRatios, ProfitabilityRatios, HealthScores } from '@/types';
import type { Granularity } from '@/lib/calculations/period-aggregation';
import type { MetricRowProps } from './MetricRow';
import { ReportTable } from './ReportTable';
import { periodLabel, quarterLabel } from '@/lib/utils/period';

export interface RatiosReportProps {
  bsSeries: BalanceSheetRatios[];
  effSeries: EfficiencyRatios[];
  profSeries: ProfitabilityRatios[];
  healthSeries: HealthScores[];
  granularity: Granularity;
}

function getPeriodLabel(period: { year: number; month: number }, granularity: Granularity): string {
  switch (granularity) {
    case 'monthly':   return periodLabel(period);
    case 'quarterly': return quarterLabel(period);
    case 'annual':    return `FY${period.year}`;
    case 'ttm':       return 'TTM';
  }
}

function zScoreZone(z: number | null): { label: string; color: string } {
  if (z === null) return { label: '—', color: 'hsl(var(--muted-foreground))' };
  if (z >= 2.6) return { label: 'Safe', color: 'hsl(142 71% 45%)' };
  if (z >= 1.1) return { label: 'Grey Zone', color: 'hsl(38 92% 50%)' };
  return { label: 'Distress', color: 'hsl(0 84% 60%)' };
}

function sep(count: number): MetricRowProps {
  return {
    label: '',
    values: Array(count).fill(null) as null[],
    format: 'currency',
    isSeparator: true,
  };
}

function altmanZRows(healthSeries: HealthScores[], periods: string[]): MetricRowProps[] {
  // Z-score with zone label as sublabel
  const zValues = healthSeries.map(h => h.altmanZScore);
  const latest = zValues[zValues.length - 1] ?? null;
  const zone = zScoreZone(latest);

  return [
    {
      label: "Altman Z'' Score",
      sublabel: latest !== null ? `${zone.label} (latest)` : undefined,
      values: zValues,
      format: 'number',
      isHighlight: true,
      showChange: false,
    },
    {
      label: 'Interest Coverage',
      values: healthSeries.map(h => h.interestCoverageRatio),
      format: 'ratio',
      showChange: true,
      benchmark: { good: 5, warn: 2, bad: 0, direction: 'higher' },
    },
  ];
}

export function RatiosReport({ bsSeries, effSeries, profSeries, healthSeries, granularity }: RatiosReportProps) {
  const isEmpty = bsSeries.length === 0 && effSeries.length === 0 && profSeries.length === 0 && healthSeries.length === 0;

  if (isEmpty) {
    return (
      <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'hsl(var(--border))' }}>
        <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
          No ratio data available. Import balance sheet and income data to see ratios.
        </p>
      </div>
    );
  }

  // Derive period labels from BS series (most likely to have all periods)
  const bsPeriods = bsSeries.map(r => getPeriodLabel(r.period, granularity));
  const effPeriods = effSeries.map(r => getPeriodLabel(r.period, granularity));
  const profPeriods = profSeries.map(r => getPeriodLabel(r.period, granularity));
  const healthPeriods = healthSeries.map(r => getPeriodLabel(r.period, granularity));

  const hasInventory = effSeries.some(e => e.inventoryTurnover !== null);

  // ── Liquidity ──
  const liquidityRows: MetricRowProps[] = [
    {
      label: 'Current Ratio',
      values: bsSeries.map(r => r.currentRatio),
      format: 'ratio',
      showChange: true,
      benchmark: { good: 2, warn: 1, bad: 0.5, direction: 'higher' },
    },
    {
      label: 'Quick Ratio',
      values: bsSeries.map(r => r.quickRatio),
      format: 'ratio',
      showChange: true,
      benchmark: { good: 1, warn: 0.5, bad: 0.25, direction: 'higher' },
    },
    {
      label: 'Cash Ratio',
      values: bsSeries.map(r => r.cashRatio),
      format: 'ratio',
      showChange: true,
    },
    {
      label: 'Working Capital',
      values: bsSeries.map(r => r.workingCapital),
      format: 'currency',
      isHighlight: true,
      showChange: true,
    },
  ];

  // ── Leverage ──
  const healthInterest: MetricRowProps = {
    label: 'Interest Coverage',
    values: healthSeries.map(h => h.interestCoverageRatio),
    format: 'ratio',
    showChange: true,
    benchmark: { good: 5, warn: 2, bad: 0, direction: 'higher' },
  };

  const leverageRows: MetricRowProps[] = [
    {
      label: 'Debt-to-Equity',
      values: bsSeries.map(r => r.debtToEquity),
      format: 'ratio',
      showChange: true,
      invertChange: true,
      benchmark: { good: 1, warn: 2, bad: 2.1, direction: 'lower' },
    },
    {
      label: 'Debt-to-Assets',
      values: bsSeries.map(r => r.debtToAssets),
      format: 'ratio',
      showChange: true,
      invertChange: true,
      benchmark: { good: 0.4, warn: 0.6, bad: 0.61, direction: 'lower' },
    },
    healthInterest,
  ];

  // ── Efficiency ──
  const efficiencyRows: MetricRowProps[] = [
    {
      label: 'DSO (Days Sales Outstanding)',
      values: effSeries.map(e => e.dso),
      format: 'days',
      showChange: true,
      invertChange: true,
      benchmark: { good: 30, warn: 45, bad: 60, direction: 'lower' },
    },
    {
      label: 'DPO (Days Payable Outstanding)',
      values: effSeries.map(e => e.dpo),
      format: 'days',
      showChange: true,
    },
    {
      label: 'DIO (Days Inventory Outstanding)',
      values: effSeries.map(e => e.dio),
      format: 'days',
      showChange: true,
    },
    {
      label: 'Cash Conversion Cycle',
      values: effSeries.map(e => e.cashConversionCycle),
      format: 'days',
      isHighlight: true,
      showChange: true,
      invertChange: true,
    },
    {
      label: 'Asset Turnover',
      values: effSeries.map(e => e.assetTurnover),
      format: 'ratio',
      showChange: true,
      benchmark: { good: 1, warn: 0.5, bad: 0.2, direction: 'higher' },
    },
    ...(hasInventory
      ? [
          {
            label: 'Inventory Turnover',
            values: effSeries.map(e => e.inventoryTurnover),
            format: 'ratio' as const,
            showChange: true,
            benchmark: { good: 6, warn: 3, bad: 1, direction: 'higher' as const },
          },
        ]
      : []),
  ];

  // ── Profitability ──
  const profitabilityRows: MetricRowProps[] = [
    {
      label: 'ROA %',
      values: profSeries.map(r => r.roa),
      format: 'percent',
      isHighlight: true,
      showChange: true,
      benchmark: { good: 0.1, warn: 0.05, bad: 0, direction: 'higher' },
    },
    {
      label: 'ROE %',
      values: profSeries.map(r => r.roe),
      format: 'percent',
      isHighlight: true,
      showChange: true,
      benchmark: { good: 0.15, warn: 0.08, bad: 0, direction: 'higher' },
    },
    sep(profSeries.length),
    {
      label: 'DuPont: Net Margin',
      values: profSeries.map(r => r.dupont.netMargin),
      format: 'percent',
      isSubtotal: true,
      showChange: true,
    },
    {
      label: 'DuPont: Asset Turnover',
      values: profSeries.map(r => r.dupont.assetTurnover),
      format: 'ratio',
      isSubtotal: true,
      showChange: true,
    },
    {
      label: 'DuPont: Equity Multiplier',
      values: profSeries.map(r => r.dupont.equityMultiplier),
      format: 'ratio',
      isSubtotal: true,
      showChange: true,
    },
  ];

  // ── Health ──
  const healthRows: MetricRowProps[] = [
    ...altmanZRows(healthSeries, healthPeriods),
  ];

  return (
    <div>
      {bsSeries.length > 0 && (
        <ReportTable title="Liquidity" periods={bsPeriods} rows={liquidityRows} showChange={false} />
      )}
      {bsSeries.length > 0 && (
        <ReportTable title="Leverage" periods={bsSeries.length > 0 ? bsPeriods : healthPeriods} rows={leverageRows} showChange={false} />
      )}
      {effSeries.length > 0 && (
        <ReportTable title="Efficiency" periods={effPeriods} rows={efficiencyRows} showChange={false} />
      )}
      {profSeries.length > 0 && (
        <ReportTable title="Profitability" periods={profPeriods} rows={profitabilityRows} showChange={false} />
      )}
      {healthSeries.length > 0 && (
        <ReportTable title="Financial Health" periods={healthPeriods} rows={healthRows} showChange={false} />
      )}
    </div>
  );
}
