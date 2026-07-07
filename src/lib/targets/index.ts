/**
 * KPI targets + the financial-ratio registry (Bob feature c/e).
 *
 * One place defines every headline ratio: label, format, FinSight's default
 * benchmark, and a plain-English explainer. Per-workspace KpiTargets
 * (corporate franchise mandates or custom goals) override the defaults, and
 * every rendering surface labels the provenance — a corporate mandate is a
 * different animal from a loose industry default, and Bob explicitly
 * distrusts unlabeled benchmarks.
 *
 * Pure data + pure functions. No I/O, no React.
 */

import type { BenchmarkRange, KpiTarget, MetricFormat, WorkspaceTargets } from '@/types';
import { formatMetricValue } from '@/lib/utils/format';

// ─────────────────────────────────────────────
// Ratio registry
// ─────────────────────────────────────────────

export type RatioKey =
  | 'gross_margin'
  | 'net_margin'
  | 'contribution_margin'
  | 'current_ratio'
  | 'debt_to_equity'
  | 'roe'
  | 'altman_z';

export interface RatioDef {
  key: RatioKey;
  label: string;
  format: MetricFormat;
  /** FinSight's default benchmark — clearly labeled, never authoritative. */
  defaultBenchmark: BenchmarkRange;
  /** What this means + why it matters, in plain English. */
  explainer: string;
  /** Sensible direction preset for the target editor. */
  defaultDirection: KpiTarget['direction'];
}

export const RATIO_DEFS: RatioDef[] = [
  {
    key: 'gross_margin',
    label: 'Gross Margin %',
    format: 'percent',
    defaultBenchmark: { good: 0.4, warn: 0.2, bad: 0, direction: 'higher' },
    explainer:
      'What is left of each revenue dollar after direct costs (COGS). Falling gross margin means pricing or input costs are moving against you.',
    defaultDirection: 'at_least',
  },
  {
    key: 'net_margin',
    label: 'Net Margin %',
    format: 'percent',
    defaultBenchmark: { good: 0.1, warn: 0.03, bad: 0, direction: 'higher' },
    explainer:
      'Profit kept from each revenue dollar after ALL expenses. The single best one-number health check.',
    defaultDirection: 'at_least',
  },
  {
    key: 'contribution_margin',
    label: 'Contribution Margin %',
    format: 'percent',
    defaultBenchmark: { good: 0.4, warn: 0.2, bad: 0, direction: 'higher' },
    explainer:
      'Revenue minus variable costs — what each additional sale contributes toward fixed costs and profit. Drives breakeven.',
    defaultDirection: 'at_least',
  },
  {
    key: 'current_ratio',
    label: 'Current Ratio',
    format: 'ratio',
    defaultBenchmark: { good: 2, warn: 1, bad: 0.5, direction: 'higher' },
    explainer:
      'Current assets ÷ current liabilities. Below 1.0 means bills due soon exceed the liquid assets available to pay them.',
    defaultDirection: 'at_least',
  },
  {
    key: 'debt_to_equity',
    label: 'Debt / Equity',
    format: 'ratio',
    defaultBenchmark: { good: 1, warn: 2, bad: 4, direction: 'lower' },
    explainer:
      'How much the business is financed by debt versus owner equity. Higher means more leverage and more risk when revenue dips.',
    defaultDirection: 'at_most',
  },
  {
    key: 'roe',
    label: 'Return on Equity %',
    format: 'percent',
    defaultBenchmark: { good: 0.15, warn: 0.05, bad: 0, direction: 'higher' },
    explainer:
      'Net income ÷ average owner equity — the return the owners earn on the money they keep in the business.',
    defaultDirection: 'at_least',
  },
  {
    key: 'altman_z',
    label: "Altman Z'' Score",
    format: 'number',
    defaultBenchmark: { good: 2.6, warn: 1.1, bad: 0, direction: 'higher' },
    explainer:
      'A composite solvency score (private-company variant). Above 2.6 = safe zone, 1.1–2.6 = grey zone, below 1.1 = distress signals.',
    defaultDirection: 'at_least',
  },
];

export const RATIO_DEF_MAP: Record<string, RatioDef> = Object.fromEntries(
  RATIO_DEFS.map((d) => [d.key, d])
);

// ─────────────────────────────────────────────
// Target helpers
// ─────────────────────────────────────────────

export type TargetProvenance = 'corporate' | 'custom' | 'default' | 'none';

export const PROVENANCE_LABELS: Record<TargetProvenance, string> = {
  corporate: 'Corporate target',
  custom: 'Custom target',
  default: 'FinSight default benchmark',
  none: '',
};

/**
 * Convert a single-threshold target into the app's BenchmarkRange shape so
 * every existing status/color pipeline works unchanged. Within 10% on the
 * wrong side of the target = warn; beyond 25% = bad.
 */
export function targetToBenchmark(t: KpiTarget): BenchmarkRange {
  if (t.direction === 'at_least') {
    return { good: t.value, warn: t.value * 0.9, bad: t.value * 0.75, direction: 'higher' };
  }
  return { good: t.value, warn: t.value * 1.1, bad: t.value * 1.25, direction: 'lower' };
}

/** "≥ 30.0%" / "≤ 1.50" — the target restated in the metric's own format. */
export function formatTargetThreshold(t: KpiTarget, format: MetricFormat): string {
  const symbol = t.direction === 'at_least' ? '≥' : '≤';
  return `${symbol} ${formatMetricValue(t.value, format)}`;
}

export interface ResolvedRatioBenchmark {
  benchmark: BenchmarkRange;
  provenance: TargetProvenance;
  /** e.g. "Target ≥ 30.0%" when a target exists, else null. */
  targetText: string | null;
  target: KpiTarget | null;
}

/** Resolve what benchmark applies to a ratio for THIS workspace. */
export function resolveRatioBenchmark(
  key: RatioKey,
  targets: WorkspaceTargets | undefined
): ResolvedRatioBenchmark {
  const def = RATIO_DEF_MAP[key]!;
  const target = targets?.ratios?.[key];
  if (target) {
    return {
      benchmark: targetToBenchmark(target),
      provenance: target.source,
      targetText: `Target ${formatTargetThreshold(target, def.format)}`,
      target,
    };
  }
  return { benchmark: def.defaultBenchmark, provenance: 'default', targetText: null, target: null };
}

/** Is a value on the right side of a target? */
export function meetsTarget(value: number, t: KpiTarget): boolean {
  return t.direction === 'at_least' ? value >= t.value : value <= t.value;
}

/** Count met/total across all ratio targets that have a computed value. */
export function scoreTargets(
  targets: WorkspaceTargets | undefined,
  ratioValues: Partial<Record<RatioKey, number | null>>
): {
  total: number;
  met: number;
  misses: { key: RatioKey; label: string; value: number; target: KpiTarget }[];
} {
  const misses: { key: RatioKey; label: string; value: number; target: KpiTarget }[] = [];
  let total = 0;
  let met = 0;
  if (!targets?.ratios) return { total, met, misses };
  for (const [key, target] of Object.entries(targets.ratios)) {
    const def = RATIO_DEF_MAP[key];
    const value = ratioValues[key as RatioKey];
    if (!def || value === null || value === undefined) continue;
    total++;
    if (meetsTarget(value, target)) met++;
    else misses.push({ key: key as RatioKey, label: def.label, value, target });
  }
  return { total, met, misses };
}
