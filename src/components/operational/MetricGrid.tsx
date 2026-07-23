'use client';

import type { MetricResult } from '@/lib/operational/calculator';
import type { CustomMetricDef, OperationalDataPoint, Period } from '@/types';
import { MetricCard } from './MetricCard';
import { periodLabel } from '@/lib/utils/period';
import { formatMetricValue } from '@/lib/utils/format';

export interface MetricGridProps {
  results: MetricResult[];
  customMetrics: CustomMetricDef[];
  operationalData: OperationalDataPoint[];
  period: Period | null;
}

// Group metric results by category
function groupResultsByCategory(results: MetricResult[]): Map<string, MetricResult[]> {
  const map = new Map<string, MetricResult[]>();
  for (const r of results) {
    const cat = r.category ?? 'General';
    const existing = map.get(cat) ?? [];
    existing.push(r);
    map.set(cat, existing);
  }
  return map;
}

// Find the saved inputs for a custom metric for a given period
function getCustomMetricInputs(
  metricId: string,
  operationalData: OperationalDataPoint[],
  period: Period | null
): Record<string, number> | null {
  if (!period) return null;
  const dp = operationalData.find(
    (d) =>
      d.metricDefId === metricId &&
      d.period.year === period.year &&
      d.period.month === period.month
  );
  return dp?.inputs ?? null;
}

export function MetricGrid({ results, customMetrics, operationalData, period }: MetricGridProps) {
  if (results.length === 0 && customMetrics.length === 0) {
    return (
      <div
        className="rounded-xl border p-8 text-center"
        style={{ borderColor: 'hsl(var(--border))' }}
        data-tour="operational-metrics"
      >
        <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
          No metrics defined for this profile
        </p>
      </div>
    );
  }

  const grouped = groupResultsByCategory(results);
  const categories = Array.from(grouped.keys());

  return (
    <div className="flex flex-col gap-8" data-tour="operational-metrics">
      {/* Profile metrics grouped by category */}
      {categories.map((category) => {
        const categoryResults = grouped.get(category) ?? [];
        return (
          <section key={category}>
            <h3
              className="text-xs font-semibold uppercase tracking-wide mb-3 pb-1 border-b"
              style={{
                color: 'hsl(var(--muted-foreground))',
                borderColor: 'hsl(var(--border))',
              }}
            >
              {category}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {categoryResults.map((result) => (
                <MetricCard key={result.metricId} result={result} />
              ))}
            </div>
          </section>
        );
      })}

      {/* Custom metrics section */}
      {customMetrics.length > 0 && (
        <section>
          <h3
            className="text-xs font-semibold uppercase tracking-wide mb-3 pb-1 border-b"
            style={{
              color: 'hsl(var(--muted-foreground))',
              borderColor: 'hsl(var(--border))',
            }}
          >
            Custom Metrics
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {customMetrics.map((metric) => {
              const inputs = getCustomMetricInputs(metric.id, operationalData, period);
              return (
                <div
                  key={metric.id}
                  className="rounded-xl border p-4 flex flex-col gap-2"
                  style={{
                    borderColor: 'hsl(var(--border))',
                    background: 'hsl(var(--card))',
                  }}
                >
                  <p
                    className="text-sm font-semibold"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    {metric.label}
                  </p>
                  <p
                    className="text-xl font-bold"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    Manual tracking
                  </p>
                  {inputs && Object.keys(inputs).length > 0 ? (
                    <div className="flex flex-col gap-1 mt-1">
                      {metric.inputFields.map((f) => {
                        const val = inputs[f.id];
                        return val !== undefined ? (
                          <p
                            key={f.id}
                            className="text-xs"
                            style={{ color: 'hsl(var(--muted-foreground))' }}
                          >
                            {f.label}: {formatMetricValue(val, metric.format)} {f.unit}
                          </p>
                        ) : null;
                      })}
                    </div>
                  ) : (
                    <p
                      className="text-xs"
                      style={{ color: 'hsl(var(--muted-foreground))' }}
                    >
                      {period ? `No data for ${periodLabel(period)}` : 'No period selected'}
                    </p>
                  )}
                  <p
                    className="text-xs italic mt-1"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    {metric.formula}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
