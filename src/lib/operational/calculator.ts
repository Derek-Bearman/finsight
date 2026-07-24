import type {
  OperationalMetricDef,
  OperationalDataPoint,
  OperationalInputPool,
  FinancialSummary,
  KpiTarget,
  Period,
  MetricFormat,
} from '@/types';
import { targetToBenchmark, formatTargetThreshold, type TargetProvenance } from '@/lib/targets';

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
  /** Plain-English "what this means" from the metric definition. */
  description?: string;
  /** Where the active benchmark comes from (client target vs FinSight default). */
  provenance: TargetProvenance;
  /** "Target ≤ 30.0%" when a client target is set for this metric. */
  targetText: string | null;
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

export function findInputPool(
  pools: OperationalInputPool[] | undefined,
  period: Period
): OperationalInputPool | undefined {
  return pools?.find(
    (p) => p.period.year === period.year && p.period.month === period.month
  );
}

/**
 * Resolve a metric's inputs for a period: shared-input pool values win over
 * legacy per-metric data-point values (pre-refactor workspaces keep working;
 * anything newly entered flows through the pool).
 */
export function resolveMetricInputs(
  def: OperationalMetricDef,
  dataPoint: OperationalDataPoint | undefined,
  pool: OperationalInputPool | undefined
): Record<string, number> {
  const merged: Record<string, number> = { ...(dataPoint?.inputs ?? {}) };
  if (pool) {
    for (const field of def.inputFields) {
      const v = pool.sharedInputs[field.id];
      if (v !== undefined) merged[field.id] = v;
    }
  }
  return merged;
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

/**
 * Run a metric's calculate() defensively: swallow throws AND coerce any
 * non-finite result (Infinity/NaN from an unguarded division) to null, so a
 * card never renders ∞/NaN once the required-input gate allows genuine zeros.
 */
function safeCalculate(
  def: OperationalMetricDef,
  inputs: Record<string, number>,
  financials: FinancialSummary
): number | null {
  try {
    const v = def.calculate(inputs, financials);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// computeMetricsForPeriod
// ─────────────────────────────────────────────

export function computeMetricsForPeriod(
  metricDefs: OperationalMetricDef[],
  operationalData: OperationalDataPoint[],
  financialSummary: FinancialSummary,
  period: Period,
  inputPools?: OperationalInputPool[],
  metricTargets?: Record<string, KpiTarget>
): MetricResult[] {
  const pool = findInputPool(inputPools, period);

  return metricDefs.map((def): MetricResult => {
    const dataPoint = findDataPoint(operationalData, def.id, period);
    const inputs = resolveMetricInputs(def, dataPoint, pool);
    const hasAnyInput = Object.keys(inputs).length > 0;

    let value: number | null = null;

    if (def.inputFields.length === 0) {
      // No inputs needed — calculate from financials only
      value = safeCalculate(def, {}, financialSummary);
    } else if (hasAnyInput) {
      // Presence-only gate: a legitimately-zero required input (0 churned,
      // 0 returns, 0 appointments — a real "perfect month") is DATA, not
      // missing. The old `&& inputs[f.id] !== 0` suppressed the metric as
      // "No data" and forfeited its benchmark verdict. Each metric's
      // calculate() guards its own zero DENOMINATORS; safeCalculate additionally
      // nulls any non-finite result so a genuine zero can never render ∞/NaN.
      const requiredFields = def.inputFields.filter((f) => !f.optional);
      const allRequiredFilled = requiredFields.every(
        (f) => inputs[f.id] !== undefined
      );

      if (allRequiredFilled) {
        value = safeCalculate(def, inputs, financialSummary);
      }
    }

    // Client target (corporate/custom) overrides the profile's default
    // benchmark; provenance is carried so the card can label it.
    const target = metricTargets?.[def.id];
    const activeBenchmark = target ? targetToBenchmark(target) : def.benchmark;
    const provenance: TargetProvenance = target
      ? target.source
      : def.benchmark
        ? 'default'
        : 'none';

    const { status, color } = getBenchmarkStatus(value, activeBenchmark);

    return {
      metricId: def.id,
      label: def.label,
      value,
      format: def.format,
      benchmarkStatus: status,
      benchmarkColor: color,
      formula: def.formula,
      category: def.category,
      description: def.description,
      provenance,
      targetText: target ? `Target ${formatTargetThreshold(target, def.format)}` : null,
    };
  });
}
