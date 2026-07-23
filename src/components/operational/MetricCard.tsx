'use client';

import type { MetricResult } from '@/lib/operational/calculator';
import { formatMetricValue } from '@/lib/utils/format';
import { PROVENANCE_LABELS } from '@/lib/targets';
import { INDUSTRY_BENCHMARK_DISCLAIMER } from '@/lib/benchmarks/packs';

export interface MetricCardProps {
  result: MetricResult;
}

const BENCHMARK_LABELS: Record<string, string> = {
  good: 'On Target',
  warn: 'Needs Attention',
  // Direction-neutral: a ≤-style target that's exceeded is not "below" anything.
  bad: 'Off Target',
  none: '',
};

export function MetricCard({ result }: MetricCardProps) {
  const hasValue = result.value !== null;
  const displayValue = hasValue ? formatMetricValue(result.value, result.format) : '—';
  const valueColor = hasValue ? result.benchmarkColor : 'hsl(var(--muted-foreground))';

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-2 relative"
      style={{
        borderColor: 'hsl(var(--border))',
        background: 'hsl(var(--card))',
      }}
      data-testid={`metric-card-${result.metricId}`}
      title={result.description}
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

      {/* Target / benchmark provenance — a corporate mandate must never be
          confused with a loose FinSight default. Industry benchmarks render
          with an asterisk + hover disclaimer. */}
      {result.provenance !== 'none' && (
        <p className="text-xs leading-snug" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {result.targetText ? (
            <>
              <span className="font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                {result.targetText}
              </span>
              {' · '}
            </>
          ) : null}
          <span title={result.provenance === 'industry' ? INDUSTRY_BENCHMARK_DISCLAIMER : undefined}>
            {PROVENANCE_LABELS[result.provenance]}
            {result.provenance === 'industry' ? '*' : ''}
          </span>
        </p>
      )}

      {/* No data state */}
      {!hasValue && (
        <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
          No data for this period
        </p>
      )}

      {/* Formula — always visible so the metric is self-explaining */}
      <p
        className="text-xs italic mt-auto pt-1"
        style={{ color: 'hsl(var(--muted-foreground))' }}
      >
        {result.formula}
      </p>
    </div>
  );
}
