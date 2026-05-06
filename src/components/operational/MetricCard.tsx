'use client';

import { useState } from 'react';
import type { MetricResult } from '@/lib/operational/calculator';
import { formatMetricValue } from '@/lib/utils/format';

export interface MetricCardProps {
  result: MetricResult;
  showFormula?: boolean;
}

const BENCHMARK_LABELS: Record<string, string> = {
  good: 'Good',
  warn: 'Needs Attention',
  bad: 'Below Target',
  none: '',
};

export function MetricCard({ result, showFormula = false }: MetricCardProps) {
  const [hovered, setHovered] = useState(false);

  const hasValue = result.value !== null;
  const displayValue = hasValue ? formatMetricValue(result.value, result.format) : '—';
  const valueColor = hasValue ? result.benchmarkColor : 'hsl(var(--muted-foreground))';
  const showFormulaText = showFormula || hovered;

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-2 relative"
      style={{
        borderColor: 'hsl(var(--border))',
        background: 'hsl(var(--card))',
      }}
      data-testid={`metric-card-${result.metricId}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Category label */}
      {result.category && (
        <p
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          {result.category}
        </p>
      )}

      {/* Metric label */}
      <p
        className="text-sm font-semibold leading-snug"
        style={{ color: 'hsl(var(--foreground))' }}
      >
        {result.label}
      </p>

      {/* Large value */}
      <p
        className="text-2xl font-bold leading-tight tabular-nums"
        style={{ color: valueColor }}
      >
        {displayValue}
      </p>

      {/* Benchmark indicator */}
      {hasValue && result.benchmarkStatus !== 'none' && (
        <div className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full flex-shrink-0"
            style={{ background: result.benchmarkColor }}
          />
          <span
            className="text-xs font-medium"
            style={{ color: result.benchmarkColor }}
          >
            {BENCHMARK_LABELS[result.benchmarkStatus]}
          </span>
        </div>
      )}

      {/* No data state */}
      {!hasValue && (
        <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
          No data for this period
        </p>
      )}

      {/* Formula */}
      {showFormulaText && (
        <p
          className="text-xs italic mt-1"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          {result.formula}
        </p>
      )}
    </div>
  );
}
