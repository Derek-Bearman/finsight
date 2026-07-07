'use client';

import React from 'react';
import { LineChart, Line } from 'recharts';
import type { MetricFormat, BenchmarkRange } from '@/types';
import { formatMetricValue } from '@/lib/utils/format';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface RatioSparklineProps {
  label: string;
  value: number | null;
  format: MetricFormat;
  trend: number[];        // last N values for the sparkline (oldest first)
  benchmark?: BenchmarkRange;
  periodLabels?: string[];
  /** "Target ≥ 30.0%" when a client target overrides the default benchmark. */
  targetText?: string | null;
  /** Threshold of the ACTIVE benchmark (target or default) — always shown so
   *  the default reads like a settable target. */
  thresholdText?: string | null;
  /** Where the active benchmark comes from — always shown so a corporate
   *  mandate is never confused with a loose FinSight default. */
  provenance?: 'corporate' | 'custom' | 'default' | 'none';
  /** Plain-English "what this means" — surfaces as a hover tooltip. */
  explainer?: string;
}

export interface RatioDashboardProps {
  cards: RatioSparklineProps[];
}

// ─────────────────────────────────────────────
// Benchmark color helper
// ─────────────────────────────────────────────

function getBenchmarkColor(value: number, benchmark: BenchmarkRange): string {
  const { good, warn, direction } = benchmark;
  if (direction === 'higher') {
    if (value >= good) return 'hsl(142 71% 45%)';
    if (value >= warn) return 'hsl(38 92% 50%)';
    return 'hsl(0 84% 60%)';
  } else {
    if (value <= good) return 'hsl(142 71% 45%)';
    if (value <= warn) return 'hsl(38 92% 50%)';
    return 'hsl(0 84% 60%)';
  }
}

// ─────────────────────────────────────────────
// Period-over-period change
// ─────────────────────────────────────────────

function computeChange(trend: number[], format: MetricFormat): { text: string; positive: boolean } | null {
  if (trend.length < 2) return null;
  const prev = trend[trend.length - 2]!;
  const curr = trend[trend.length - 1]!;
  if (prev === 0) return null;

  const delta = curr - prev;
  const pct = delta / Math.abs(prev);
  const positive = delta >= 0;

  let text: string;
  if (format === 'percent') {
    // Show absolute change in percentage points
    const pts = (delta * 100).toFixed(1);
    text = `${positive ? '+' : ''}${pts} pp`;
  } else if (format === 'currency') {
    const sign = positive ? '+' : '';
    if (Math.abs(delta) >= 1_000_000) {
      text = `${sign}$${(delta / 1_000_000).toFixed(1)}M`;
    } else if (Math.abs(delta) >= 1_000) {
      text = `${sign}$${(delta / 1_000).toFixed(0)}K`;
    } else {
      text = `${sign}$${Math.round(delta)}`;
    }
  } else {
    const pctStr = (pct * 100).toFixed(1);
    text = `${positive ? '+' : ''}${pctStr}%`;
  }

  return { text, positive };
}

// ─────────────────────────────────────────────
// Single Ratio Card
// ─────────────────────────────────────────────

const PROVENANCE_TEXT: Record<string, string> = {
  corporate: 'Corporate target',
  custom: 'Custom target',
  default: 'FinSight default benchmark',
};

function RatioCard({ label, value, format, trend, benchmark, targetText, thresholdText, provenance, explainer }: RatioSparklineProps) {
  const valueColor =
    value !== null && benchmark
      ? getBenchmarkColor(value, benchmark)
      : 'hsl(var(--foreground))';

  const displayValue = value !== null ? formatMetricValue(value, format) : '—';
  const change = computeChange(trend, format);

  const trendData = trend.map((v, i) => ({ i, v }));
  const sparkColor =
    value !== null && benchmark
      ? getBenchmarkColor(value, benchmark)
      : 'hsl(217 91% 55%)';

  const isClientTarget = provenance === 'corporate' || provenance === 'custom';

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-2"
      style={{
        borderColor: isClientTarget ? 'hsl(217 91% 55% / 0.45)' : 'hsl(var(--border))',
        background: 'hsl(var(--card))',
      }}
      title={explainer}
    >
      {/* Label */}
      <p
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: 'hsl(var(--muted-foreground))' }}
      >
        {label}
      </p>

      {/* Value + change row */}
      <div className="flex items-end justify-between gap-2">
        <p className="text-2xl font-bold leading-none" style={{ color: valueColor }}>
          {displayValue}
        </p>
        {change && (
          <span
            className="text-xs font-medium mb-0.5"
            style={{ color: change.positive ? 'hsl(142 71% 45%)' : 'hsl(0 84% 60%)' }}
          >
            {change.positive ? '↑' : '↓'} {change.text}
          </span>
        )}
      </div>

      {/* Sparkline */}
      {trendData.length >= 2 && (
        <div style={{ height: 40 }}>
          <LineChart width={120} height={40} data={trendData}>
            <Line
              type="monotone"
              dataKey="v"
              stroke={sparkColor}
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </LineChart>
        </div>
      )}

      {/* Null fallback */}
      {trendData.length < 2 && (
        <div style={{ height: 40 }} />
      )}

      {/* Target / benchmark provenance — always shows the active threshold so
          the FinSight default reads like a target the user can override */}
      {provenance && provenance !== 'none' && (
        <p className="text-xs leading-snug" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {thresholdText ? (
            <>
              <span className="font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                {targetText ?? thresholdText}
              </span>
              {' · '}
            </>
          ) : null}
          {PROVENANCE_TEXT[provenance]}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// RatioDashboard
// ─────────────────────────────────────────────

export function RatioDashboard({ cards }: RatioDashboardProps) {
  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <RatioCard key={card.label} {...card} />
      ))}
    </div>
  );
}
