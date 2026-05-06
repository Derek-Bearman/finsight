import type {
  OperationalMetricDef,
  OperationalDataPoint,
  FinancialSummary,
  Period,
  MetricFormat,
} from '@/types';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface MetricResult {
  metricId: string;
  label: string;
  value: number | null;
  format: MetricFormat;
  benchmarkStatus: 'good' | 'warn' | 'bad' | 'none';
  benchmarkColor: string;
  formula: string;
  category?: string;
}

// ─────────────────────────────────────────────
// Benchmark colors
// ─────────────────────────────────────────────

const BENCHMARK_COLORS = {
  good: 'hsl(142 71% 45%)',
  warn: 'hsl(38 92% 50%)',
  bad: 'hsl(0 84% 60%)',
  none: 'hsl(var(--muted-foreground))',
} as const;

// ─────────────────────────────────────────────
// Data point lookup
// ─────────────────────────────────────────────

function findDataPoint(
  data: OperationalDataPoint[],
  metricId: string,
  period: Period
): OperationalDataPoint | undefined {
  return data.find(
    (d) =>
      d.metricDefId === metricId &&
      d.period.year === period.year &&
      d.period.month === period.month
  );
}

// ─────────────────────────────────────────────
// getBenchmarkStatus
// ─────────────────────────────────────────────

export function getBenchmarkStatus(
  value: number | null,
  benchmark: OperationalMetricDef['benchmark']
): { status: 'good' | 'warn' | 'bad' | 'none'; color: string } {
  if (value === null || benchmark === undefined) {
    return { status: 'none', color: BENCHMARK_COLORS.none };
  }

  const { good, warn, bad, direction } = benchmark;

  let status: 'good' | 'warn' | 'bad';

  if (direction === 'higher') {
    if (value >= good) {
      status = 'good';
    } else if (value >= warn) {
      status = 'warn';
    } else {
      status = 'bad';
    }
  } else {
    // lower is better
    if (value <= good) {
      status = 'good';
    } else if (value <= warn) {
      status = 'warn';
    } else {
      status = 'bad';
    }
  }

  return { status, color: BENCHMARK_COLORS[status] };
}

// ─────────────────────────────────────────────
// computeMetricsForPeriod
// ─────────────────────────────────────────────

export function computeMetricsForPeriod(
  metricDefs: OperationalMetricDef[],
  operationalData: OperationalDataPoint[],
  financialSummary: FinancialSummary,
  period: Period
): MetricResult[] {
  return metricDefs.map((def): MetricResult => {
    const dataPoint = findDataPoint(operationalData, def.id, period);

    let value: number | null = null;

    if (dataPoint !== undefined) {
      // Check that all required fields have values
      const requiredFields = def.inputFields.filter((f) => !f.optional);
      const allRequiredFilled = requiredFields.every(
        (f) => dataPoint.inputs[f.id] !== undefined && dataPoint.inputs[f.id] !== 0
      );

      if (allRequiredFilled || def.inputFields.length === 0) {
        try {
          value = def.calculate(dataPoint.inputs, financialSummary);
        } catch {
          value = null;
        }
      }
    } else if (def.inputFields.length === 0) {
      // No inputs needed — calculate from financials only
      try {
        value = def.calculate({}, financialSummary);
      } catch {
        value = null;
      }
    }

    const { status, color } = getBenchmarkStatus(value, def.benchmark);

    return {
      metricId: def.id,
      label: def.label,
      value,
      format: def.format,
      benchmarkStatus: status,
      benchmarkColor: color,
      formula: def.formula,
      category: def.category,
    };
  });
}
