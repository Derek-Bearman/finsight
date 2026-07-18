/**
 * Projection models: linear trend, seasonal decomposition, YoY growth rate.
 * Pure functions — no React, no side effects.
 */

import type { Period, ProjectionModel, ProjectionPoint } from '@/types';
import { addMonths } from '@/lib/utils/period';

// ─────────────────────────────────────────────
// Input / Output types
// ─────────────────────────────────────────────

export interface ProjectionInput {
  /** Historical monthly values, sorted chronologically */
  history: { period: Period; amount: number }[];
  /** How many months forward to project */
  horizonMonths: number;
  /** Which model to use */
  model: ProjectionModel;
  /** Override annual growth rate (0.05 = 5%). Used by 'linear' and 'yoy' models. */
  growthRateOverride?: number;
}

export interface ProjectionOutput {
  /** Projected points (not including historical) */
  projected: ProjectionPoint[];
  /** Model used */
  model: ProjectionModel;
  /** Annualized growth rate implied by this projection */
  impliedGrowthRate: number;
  /** Residual standard deviation of the model (used for confidence bands) */
  residualStdDev: number;
}

// ─────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────

/** Population standard deviation of an array of numbers */
function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Least-squares linear regression: returns { slope, intercept } */
function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: ys[0]! };

  const xMean = xs.reduce((s, v) => s + v, 0) / n;
  const yMean = ys.reduce((s, v) => s + v, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - xMean;
    numerator += dx * (ys[i]! - yMean);
    denominator += dx * dx;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

/**
 * Compute confidence band for a single projected step.
 * Uses ±zScore * stddev * sqrt(step) to widen uncertainty farther from history.
 */
export function computeConfidenceBand(
  value: number,
  stddevVal: number,
  steps: number,
  zScore = 1.282
): { lower: number; upper: number } {
  const margin = zScore * stddevVal * Math.sqrt(steps);
  return {
    lower: value - margin,
    upper: value + margin,
  };
}

/** Check if all values are zero */
function allZero(values: number[]): boolean {
  return values.every((v) => v === 0);
}

/** Fill gaps in the history — if a month is missing between min and max period, insert 0 */
function fillGaps(history: { period: Period; amount: number }[]): { period: Period; amount: number }[] {
  if (history.length === 0) return [];

  const sorted = [...history].sort(
    (a, b) => a.period.year * 12 + a.period.month - (b.period.year * 12 + b.period.month)
  );

  const first = sorted[0]!.period;
  const last = sorted[sorted.length - 1]!.period;

  // Build a lookup by period key
  const lookup = new Map<string, number>();
  for (const h of sorted) {
    lookup.set(`${h.period.year}-${h.period.month}`, h.amount);
  }

  const result: { period: Period; amount: number }[] = [];
  let cur = first;
  while (cur.year * 12 + cur.month <= last.year * 12 + last.month) {
    const key = `${cur.year}-${cur.month}`;
    result.push({ period: { ...cur }, amount: lookup.get(key) ?? 0 });
    cur = addMonths(cur, 1);
  }

  return result;
}

// ─────────────────────────────────────────────
// Model 1: Linear trend
// ─────────────────────────────────────────────

export function projectLinear(input: ProjectionInput): ProjectionOutput {
  const { horizonMonths, growthRateOverride } = input;
  const history = fillGaps(input.history);
  const n = history.length;

  // Edge cases
  if (n === 0) {
    return { projected: [], model: 'linear', impliedGrowthRate: 0, residualStdDev: 0 };
  }

  if (allZero(history.map((h) => h.amount))) {
    const lastPeriod = history[n - 1]!.period;
    const projected: ProjectionPoint[] = [];
    for (let i = 1; i <= horizonMonths; i++) {
      const p = addMonths(lastPeriod, i);
      projected.push({ period: p, value: 0, lower80: 0, upper80: 0, isProjected: true });
    }
    return { projected, model: 'linear', impliedGrowthRate: 0, residualStdDev: 0 };
  }

  // Recent-weighted regression: when history is longer than 12 months, duplicate
  // the last 12 months' data points to give them 2x weight. This makes the trend
  // more responsive to recent performance and prevents old weak data from dragging
  // down projections for growing businesses.
  let xs = history.map((_, i) => i);
  let ys = history.map((h) => h.amount);

  if (n > 12) {
    const recentXs = xs.slice(n - 12);
    const recentYs = ys.slice(n - 12);
    xs = [...xs, ...recentXs];
    ys = [...ys, ...recentYs];
  }

  let { slope, intercept } = linearRegression(xs, ys);

  // If growthRateOverride provided, adjust slope to match that annual growth rate
  if (growthRateOverride !== undefined) {
    const lastY = ys[n - 1]!;
    const monthlyRate = Math.pow(1 + growthRateOverride, 1 / 12) - 1;
    slope = lastY * monthlyRate;
    intercept = lastY - slope * (n - 1);
  }

  // Residuals for historical points — always computed on original (unweighted) history
  const origXs = history.map((_, i) => i);
  const origYs = history.map((h) => h.amount);
  const residuals = origYs.map((y, i) => y - (intercept + slope * i));
  const residualSd = stddev(residuals);

  const xMean = origXs.reduce((s, v) => s + v, 0) / n;
  const ssxx = origXs.reduce((s, x) => s + (x - xMean) ** 2, 0);

  const lastPeriod = history[n - 1]!.period;
  const lastHistorical = origYs[n - 1]!;
  const projected: ProjectionPoint[] = [];

  for (let i = 1; i <= horizonMonths; i++) {
    const xFuture = n - 1 + i;
    let yHat = intercept + slope * xFuture;

    // Floor at 0 for revenue-type projections (callers can decide, but this model always floors)
    yHat = Math.max(0, yHat);

    // Widening CI: use sqrt(i) factor
    const baseSd = residualSd * Math.sqrt(1 + 1 / n + (ssxx > 0 ? (xFuture - xMean) ** 2 / ssxx : 0));
    const widened = baseSd * Math.sqrt(i);
    const band = computeConfidenceBand(yHat, widened, 1, 1.282);

    const p = addMonths(lastPeriod, i);
    projected.push({
      period: p,
      value: yHat,
      lower80: Math.max(0, band.lower),
      upper80: band.upper,
      isProjected: true,
    });
  }

  const lastProjected = projected[projected.length - 1]?.value ?? lastHistorical;
  const impliedGrowthRate =
    lastHistorical > 0 && horizonMonths > 0
      ? Math.pow(lastProjected / lastHistorical, 12 / horizonMonths) - 1
      : 0;

  return { projected, model: 'linear', impliedGrowthRate, residualStdDev: residualSd };
}

// ─────────────────────────────────────────────
// Model 2: Seasonal trend (multiplicative decomposition)
// ─────────────────────────────────────────────

export function projectSeasonal(input: ProjectionInput): ProjectionOutput {
  const history = fillGaps(input.history);
  const n = history.length;

  // Need at least 24 months of history for reliable seasonal indices (each month
  // bucket needs ≥2 observations). Fall back to linear if fewer than 24.
  if (n < 24) {
    return projectLinear({ ...input, model: 'linear' });
  }

  const ys = history.map((h) => h.amount);

  // Step 1: Compute 12-month centered moving average (CMA)
  // For a 12-month CMA, use a 2×12 moving average (to get a centered value)
  const cma: (number | null)[] = new Array(n).fill(null);
  for (let t = 6; t < n - 6; t++) {
    // 2×12 MA: average of t-6..t+5 (12 points) averaged with t-5..t+6 (12 points)
    let sum1 = 0;
    let sum2 = 0;
    for (let k = -6; k <= 5; k++) sum1 += ys[t + k]!;
    for (let k = -5; k <= 6; k++) sum2 += ys[t + k]!;
    cma[t] = (sum1 / 12 + sum2 / 12) / 2;
  }

  // Step 2: Seasonal indices — for each month 1–12
  const monthBuckets: number[][] = Array.from({ length: 12 }, () => []);
  for (let t = 0; t < n; t++) {
    if (cma[t] !== null && cma[t]! > 0) {
      const monthIdx = (history[t]!.period.month - 1) % 12;
      monthBuckets[monthIdx]!.push(ys[t]! / cma[t]!);
    }
  }

  // Average each month's ratios
  let rawSeasonalIndices = monthBuckets.map((bucket) =>
    bucket.length > 0 ? bucket.reduce((s, v) => s + v, 0) / bucket.length : 1
  );

  // Normalize so they sum to 12
  const siSum = rawSeasonalIndices.reduce((s, v) => s + v, 0);
  if (siSum > 0) {
    rawSeasonalIndices = rawSeasonalIndices.map((si) => (si * 12) / siSum);
  }

  // Clamp seasonal indices to a plausible range: [0.3, 3.0].
  // A seasonal index below 0.3 (70%+ drop from average) or above 3.0 (3× spike)
  // almost always reflects noise from too few observations rather than real
  // seasonality. Extreme indices cause projected values to collapse or explode.
  const SEASONAL_INDEX_MIN = 0.3;
  const SEASONAL_INDEX_MAX = 3.0;
  rawSeasonalIndices = rawSeasonalIndices.map((si) =>
    Math.min(SEASONAL_INDEX_MAX, Math.max(SEASONAL_INDEX_MIN, si))
  );

  // Re-normalize after clamping so indices still sum to 12
  const siSumClamped = rawSeasonalIndices.reduce((s, v) => s + v, 0);
  if (siSumClamped > 0) {
    rawSeasonalIndices = rawSeasonalIndices.map((si) => (si * 12) / siSumClamped);
  }

  const seasonalIndices = rawSeasonalIndices;

  // Step 3: Deseasonalized series
  const deseasonalized = ys.map((y, t) => {
    const si = seasonalIndices[(history[t]!.period.month - 1) % 12]!;
    return si > 0 ? y / si : y;
  });

  // Step 4: Fit linear regression on deseasonalized series
  const xs = deseasonalized.map((_, i) => i);
  const { slope, intercept } = linearRegression(xs, deseasonalized);

  // Residuals on deseasonalized
  const residuals = deseasonalized.map((y, i) => y - (intercept + slope * i));
  const residualSd = stddev(residuals);

  // Widen bands if < 24 months of history (seasonal indices less reliable)
  const bandWidthMultiplier = n < 24 ? 1.5 : 1.0;

  const lastPeriod = history[n - 1]!.period;
  const lastHistorical = ys[n - 1]!;
  const projected: ProjectionPoint[] = [];

  for (let i = 1; i <= input.horizonMonths; i++) {
    const xFuture = n - 1 + i;
    const futurePeriod = addMonths(lastPeriod, i);
    const si = seasonalIndices[(futurePeriod.month - 1) % 12]!;

    const trendValue = intercept + slope * xFuture;
    let yHat = trendValue * si;
    yHat = Math.max(0, yHat);

    const widened = residualSd * bandWidthMultiplier * Math.sqrt(i);
    const band = computeConfidenceBand(yHat, widened, 1, 1.282);

    projected.push({
      period: futurePeriod,
      value: yHat,
      lower80: Math.max(0, band.lower),
      upper80: band.upper,
      isProjected: true,
    });
  }

  const lastProjected = projected[projected.length - 1]?.value ?? lastHistorical;
  const impliedGrowthRate =
    lastHistorical > 0 && input.horizonMonths > 0
      ? Math.pow(lastProjected / lastHistorical, 12 / input.horizonMonths) - 1
      : 0;

  return { projected, model: 'seasonal', impliedGrowthRate, residualStdDev: residualSd };
}

/**
 * Best-available annualized growth rate from history — never assumes 0%.
 *   ≥24 months  → true YoY (trailing 12 vs prior 12)
 *   6–23 months → CAGR of the 3-month averages at each end of the series
 *   3–5 months  → annualized first→last monthly change
 * Returns 0 only when there's genuinely no signal (flat or <2 points).
 */
export function historicalAnnualGrowth(history: { period: Period; amount: number }[]): number {
  const filled = fillGaps(history);
  const ys = filled.map((h) => h.amount);
  const n = ys.length;
  if (n < 2) return 0;

  if (n >= 24) {
    const trailing12 = ys.slice(-12).reduce((s, v) => s + v, 0);
    const prior12 = ys.slice(-24, -12).reduce((s, v) => s + v, 0);
    if (prior12 > 0) return clampGrowth(trailing12 / prior12 - 1);
  }

  if (n >= 6) {
    const w = Math.min(3, Math.floor(n / 2));
    const startAvg = ys.slice(0, w).reduce((s, v) => s + v, 0) / w;
    const endAvg = ys.slice(-w).reduce((s, v) => s + v, 0) / w;
    // Months between the two window centers, annualized.
    const monthsApart = n - w;
    if (startAvg > 0 && monthsApart > 0) {
      return clampGrowth(Math.pow(endAvg / startAvg, 12 / monthsApart) - 1);
    }
  }

  const first = ys[0]!;
  const last = ys[n - 1]!;
  if (first > 0 && n > 1) return clampGrowth(Math.pow(last / first, 12 / (n - 1)) - 1);
  return 0;
}

function clampGrowth(rate: number): number {
  // Guard against runaway extrapolation from a single anomalous month.
  if (rate < -0.5) return -0.5;
  if (rate > 3) return 3;
  return rate;
}

// ─────────────────────────────────────────────
// Model 3: YoY growth rate
// ─────────────────────────────────────────────

export function projectYoY(input: ProjectionInput): ProjectionOutput {
  const history = fillGaps(input.history);
  const n = history.length;

  if (n < 12) {
    return projectLinear({ ...input, model: 'linear' });
  }

  const ys = history.map((h) => h.amount);

  // Trailing 12-month totals
  const trailing12 = ys.slice(-12).reduce((s, v) => s + v, 0);
  const prior12 = n >= 24 ? ys.slice(-24, -12).reduce((s, v) => s + v, 0) : ys.slice(0, 12).reduce((s, v) => s + v, 0);

  let annualRate: number;
  if (input.growthRateOverride !== undefined) {
    annualRate = input.growthRateOverride;
  } else if (n >= 24 && prior12 > 0) {
    annualRate = trailing12 / prior12 - 1;
  } else {
    // No full prior year to compare — derive growth from the available history
    // (partial-year windows) instead of collapsing to 0%.
    void prior12;
    annualRate = historicalAnnualGrowth(history);
  }

  // Cap negative (decline) projections at -30% annually to prevent runaway
  // extrapolation from a single bad year. Only floor the downside; no cap on upside.
  if (annualRate < -0.3) {
    annualRate = -0.3;
  }

  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;

  // Build a lookup for same-month values, keeping each anchor's period so we
  // can compound from the anchor's actual date (not the last historical month).
  const byMonthLookup = new Map<number, { amount: number; period: Period }[]>();
  for (const h of history) {
    const m = h.period.month;
    if (!byMonthLookup.has(m)) byMonthLookup.set(m, []);
    byMonthLookup.get(m)!.push({ amount: h.amount, period: h.period });
  }

  // Monthly growth rates (for stddev computation)
  const monthlyGrowthRates: number[] = [];
  for (let t = 1; t < n; t++) {
    const prev = ys[t - 1]!;
    if (prev > 0) {
      monthlyGrowthRates.push(ys[t]! / prev - 1);
    }
  }
  const growthStddev = stddev(monthlyGrowthRates);

  const lastPeriod = history[n - 1]!.period;
  const lastHistorical = ys[n - 1]!;
  const projected: ProjectionPoint[] = [];

  for (let i = 1; i <= input.horizonMonths; i++) {
    const futurePeriod = addMonths(lastPeriod, i);
    const targetMonth = futurePeriod.month;

    // Find the most recent historical value for this calendar month (the
    // seasonal anchor). Compound from the anchor's OWN date — e.g. next
    // January is projected from last January by a full 12 months of growth,
    // not by 1 month from the last historical period. Falling back to the
    // last historical value means no seasonal anchor, so step from there (i).
    const monthHistory = byMonthLookup.get(targetMonth);
    const anchor = monthHistory && monthHistory.length > 0 ? monthHistory[monthHistory.length - 1]! : null;
    const sameMonthLast = anchor ? anchor.amount : lastHistorical;
    const stepsForward = anchor
      ? (futurePeriod.year - anchor.period.year) * 12 + (futurePeriod.month - anchor.period.month)
      : i;

    // Number of full years forward (for confidence-band widening).
    const yearsForward = Math.ceil(i / 12);

    let yHat = sameMonthLast * Math.pow(1 + monthlyRate, stepsForward);
    yHat = Math.max(0, yHat);

    const band = computeConfidenceBand(yHat, growthStddev * yHat, Math.max(1, yearsForward), 1.282);

    projected.push({
      period: futurePeriod,
      value: yHat,
      lower80: Math.max(0, band.lower),
      upper80: band.upper,
      isProjected: true,
    });
  }

  const lastProjected = projected[projected.length - 1]?.value ?? lastHistorical;
  const impliedGrowthRate =
    lastHistorical > 0 && input.horizonMonths > 0
      ? Math.pow(lastProjected / lastHistorical, 12 / input.horizonMonths) - 1
      : 0;

  return { projected, model: 'yoy', impliedGrowthRate, residualStdDev: growthStddev };
}

// ─────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────

/**
 * Route to the appropriate model function, falling back to linear
 * if history is too short for the requested model.
 */
export function project(input: ProjectionInput): ProjectionOutput {
  if (input.history.length === 0) {
    return { projected: [], model: input.model, impliedGrowthRate: 0, residualStdDev: 0 };
  }

  switch (input.model) {
    case 'seasonal':
      return projectSeasonal(input);
    case 'yoy':
      return projectYoY(input);
    case 'linear':
    default:
      return projectLinear(input);
  }
}
