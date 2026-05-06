'use client';

import React from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ProjectionChartDataPoint {
  label: string;
  actual?: number;
  projected?: number;
  lower80?: number;
  upper80?: number;
  isProjected: boolean;
}

export interface ProjectionChartProps {
  data: ProjectionChartDataPoint[];
  metric: 'revenue' | 'netIncome' | 'grossProfit';
  height?: number;
}

// ─────────────────────────────────────────────
// Y-axis currency abbreviation
// ─────────────────────────────────────────────

function abbreviateCurrency(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

// ─────────────────────────────────────────────
// Custom tooltip
// ─────────────────────────────────────────────

interface TooltipPayloadItem {
  name: string;
  value: number | null;
  payload: ProjectionChartDataPoint;
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const isProj = payload[0]?.payload?.isProjected ?? false;
  const value = payload[0]?.payload?.projected ?? payload[0]?.payload?.actual;
  const lower = payload[0]?.payload?.lower80;
  const upper = payload[0]?.payload?.upper80;

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
      {value !== undefined && (
        <p>{abbreviateCurrency(value)}</p>
      )}
      {isProj && lower !== undefined && upper !== undefined && (
        <p style={{ color: 'hsl(var(--muted-foreground))' }}>
          80% CI: {abbreviateCurrency(lower)} – {abbreviateCurrency(upper)}
        </p>
      )}
      {isProj && (
        <span
          className="inline-block mt-1 rounded px-1.5 py-0.5 text-xs font-medium"
          style={{
            background: 'hsl(217 91% 60% / 0.15)',
            color: 'hsl(217 91% 55%)',
          }}
        >
          Projected
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Find the first projected label for reference line
// ─────────────────────────────────────────────

function findFirstProjectedLabel(data: ProjectionChartDataPoint[]): string | null {
  const idx = data.findIndex((d) => d.isProjected);
  if (idx < 0) return null;
  // Put reference line at the boundary (end of last actual)
  if (idx > 0) return data[idx - 1]!.label;
  return data[idx]!.label;
}

// ─────────────────────────────────────────────
// ProjectionChart
// ─────────────────────────────────────────────

export function ProjectionChart({ data, metric: _metric, height = 320 }: ProjectionChartProps) {
  const boundaryLabel = findFirstProjectedLabel(data);
  const manyPoints = data.length > 12;

  // Build merged data: for the confidence band we use [lower80, upper80] as a range area
  // Recharts Area with type="monotone" on `upper80` requires the lower bound as the baseline
  // We pass both lower80 and upper80 and use Area with dataKey="upper80" and baseValue via a custom approach
  // Best approach: use two Area components with same fill/stroke, one for upper, one for lower, overlapping
  // Actually the standard pattern is: Area for band range = [lower, upper] using a custom shape or
  // pass an array [lower, upper] as data — but easiest with recharts: pass `lower80` as the "base" of upper band
  // We'll use: Area with `dataKey="upper80"` and Area with `dataKey="lower80"` filled with same color,
  // then a white fill on lower80 to create the "band" effect. A simpler approach:
  // Use Area with dataKey="bandArea" where bandArea = [lower80, upper80] in array form for recharts.
  // Recharts supports this natively in newer versions.

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: manyPoints ? 48 : 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />

        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          angle={manyPoints ? -45 : 0}
          textAnchor={manyPoints ? 'end' : 'middle'}
          interval={manyPoints ? Math.floor(data.length / 10) : 0}
          height={manyPoints ? 56 : 30}
        />

        <YAxis
          tickFormatter={abbreviateCurrency}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          width={64}
        />

        <Tooltip content={<CustomTooltip />} />

        {/* Confidence band — area between lower80 and upper80 */}
        {/* Use two areas: upper fills from 0 to upper80, lower fills from 0 to lower80 in card color to mask */}
        <Area
          type="monotone"
          dataKey="upper80"
          fill="hsl(217 91% 60% / 0.12)"
          stroke="none"
          isAnimationActive={false}
          legendType="none"
          name="Upper 80%"
          connectNulls
        />
        <Area
          type="monotone"
          dataKey="lower80"
          fill="hsl(var(--card))"
          stroke="none"
          isAnimationActive={false}
          legendType="none"
          name="Lower 80%"
          connectNulls
        />

        {/* Historical actuals — solid blue */}
        <Line
          type="monotone"
          dataKey="actual"
          stroke="hsl(217 91% 55%)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          connectNulls
          name="Actual"
          isAnimationActive={false}
        />

        {/* Projected — dashed lighter blue */}
        <Line
          type="monotone"
          dataKey="projected"
          stroke="hsl(217 91% 70%)"
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          activeDot={{ r: 4 }}
          connectNulls
          name="Projected"
          isAnimationActive={false}
        />

        {/* Reference line at history/projection boundary */}
        {boundaryLabel && (
          <ReferenceLine
            x={boundaryLabel}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="4 2"
            opacity={0.6}
            label={{
              value: 'Forecast →',
              position: 'insideTopRight',
              fontSize: 10,
              fill: 'hsl(var(--muted-foreground))',
            }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
