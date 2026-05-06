'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  LabelList,
  ResponsiveContainer,
} from 'recharts';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface WaterfallStep {
  label: string;
  value: number;       // absolute value for this bar
  isTotal: boolean;    // true = reset to absolute (Revenue, Gross Profit, etc.)
  isNegative: boolean; // true = this is a cost/deduction (COGS, OpEx)
}

export interface MarginWaterfallProps {
  steps: WaterfallStep[];
  height?: number;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function abbr(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

// ─────────────────────────────────────────────
// Waterfall data computation
// ─────────────────────────────────────────────

interface BarData {
  label: string;
  start: number;
  size: number;
  total: number;
  isNegative: boolean;
  isTotal: boolean;
}

function buildWaterfallData(steps: WaterfallStep[]): BarData[] {
  const result: BarData[] = [];
  let running = 0;

  for (const step of steps) {
    if (step.isTotal) {
      // Total bars start from 0 with full absolute value
      const size = step.value;
      result.push({
        label: step.label,
        start: 0,
        size: Math.abs(size),
        total: size,
        isNegative: size < 0,
        isTotal: true,
      });
      running = size;
    } else if (step.isNegative) {
      // Deduction: bar goes down from current running
      const deduction = Math.abs(step.value);
      const newRunning = running - deduction;
      // Render from new (lower) position upward by deduction amount
      result.push({
        label: step.label,
        start: Math.min(running, newRunning),
        size: deduction,
        total: step.value,
        isNegative: true,
        isTotal: false,
      });
      running = newRunning;
    } else {
      // Addition: bar goes up from current running
      const addition = step.value;
      const newRunning = running + addition;
      result.push({
        label: step.label,
        start: Math.min(running, newRunning),
        size: Math.abs(addition),
        total: step.value,
        isNegative: false,
        isTotal: false,
      });
      running = newRunning;
    }
  }

  return result;
}

function getBarColor(d: BarData): string {
  if (d.isTotal) {
    if (d.total < 0) return 'hsl(0 84% 60% / 0.8)';
    return 'hsl(217 91% 55% / 0.85)'; // blue for totals
  }
  if (d.isNegative) return 'hsl(0 84% 60% / 0.75)'; // red for deductions
  return 'hsl(142 71% 45% / 0.8)'; // green for positive subtotals
}

// ─────────────────────────────────────────────
// Custom Tooltip
// ─────────────────────────────────────────────

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: BarData }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[payload.length - 1]?.payload;
  if (!d) return null;

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-md"
      style={{
        background: 'hsl(var(--card))',
        borderColor: 'hsl(var(--border))',
        color: 'hsl(var(--foreground))',
      }}
    >
      <p className="font-semibold mb-1">{label}</p>
      <p style={{ color: getBarColor(d) }}>{abbr(d.total)}</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// MarginWaterfall
// ─────────────────────────────────────────────

export function MarginWaterfall({ steps, height = 300 }: MarginWaterfallProps) {
  if (steps.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border"
        style={{
          height,
          borderColor: 'hsl(var(--border))',
          color: 'hsl(var(--muted-foreground))',
          fontSize: 13,
        }}
      >
        No data available
      </div>
    );
  }

  const barData = buildWaterfallData(steps);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={barData}
        margin={{ top: 24, right: 30, bottom: 8, left: 8 }}
        barCategoryGap="20%"
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} vertical={false} />

        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          height={30}
        />

        <YAxis
          tickFormatter={abbr}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          width={64}
        />

        <Tooltip content={<CustomTooltip />} />

        {/* Invisible spacer bar to float the visible bar */}
        <Bar dataKey="start" stackId="wf" fill="transparent" isAnimationActive={false} legendType="none" />

        {/* Visible waterfall bar */}
        <Bar dataKey="size" stackId="wf" isAnimationActive={false} name="Value" radius={[3, 3, 0, 0]}>
          {barData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={getBarColor(entry)} />
          ))}
          <LabelList
            dataKey="total"
            position="top"
            formatter={(v: unknown) => abbr(Number(v))}
            style={{ fontSize: 10, fill: 'hsl(var(--foreground))', fontWeight: 500 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
