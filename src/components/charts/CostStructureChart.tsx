'use client';

import React from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface CostStructureChartDataPoint {
  label: string;
  revenue: number;
  variableCosts: number;
  fixedCosts: number;
}

export interface CostStructureChartProps {
  data: CostStructureChartDataPoint[];
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
// Custom Tooltip
// ─────────────────────────────────────────────

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: CostStructureChartDataPoint }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  // Extract values from payload
  const d = payload[0]?.payload;
  if (!d) return null;

  // Revenue left after the two cost buckets shown here (fixed + variable
  // OPERATING expenses). This deliberately excludes COGS, so it is NOT gross
  // margin — labeling it "Gross Margin" contradicted the P&L's real gross
  // margin. Name it for what it is: revenue net of the costs on this chart.
  const marginAfterCostsPct =
    d.revenue > 0
      ? (((d.revenue - d.fixedCosts - d.variableCosts) / d.revenue) * 100).toFixed(1)
      : '—';

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-md"
      style={{
        background: 'hsl(var(--card))',
        borderColor: 'hsl(var(--border))',
        color: 'hsl(var(--foreground))',
        minWidth: 170,
      }}
    >
      <p className="font-semibold mb-1.5">{label}</p>
      <div className="flex flex-col gap-0.5">
        <p>
          <span style={{ color: 'hsl(217 91% 55%)' }}>● </span>
          Revenue: {abbr(d.revenue)}
        </p>
        <p>
          <span style={{ color: 'hsl(221 83% 80%)' }}>● </span>
          Fixed Costs: {abbr(d.fixedCosts)}
        </p>
        <p>
          <span style={{ color: 'hsl(38 92% 60%)' }}>● </span>
          Variable Costs: {abbr(d.variableCosts)}
        </p>
        <p style={{ color: 'hsl(var(--muted-foreground))' }}>
          Margin after these costs: {marginAfterCostsPct}%
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CostStructureChart
// ─────────────────────────────────────────────

export function CostStructureChart({ data, height = 280 }: CostStructureChartProps) {
  const manyPoints = data.length > 12;

  if (data.length === 0) {
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

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 30, bottom: 8, left: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />

        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          angle={-45}
          textAnchor="end"
          interval={Math.max(0, Math.ceil(data.length / 6) - 1)}
          height={52}
        />

        <YAxis
          tickFormatter={abbr}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          width={64}
        />

        <Tooltip content={<CustomTooltip />} />

        <Legend
          wrapperStyle={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}
        />

        {/* Fixed costs: bottom stack */}
        <Area
          type="monotone"
          dataKey="fixedCosts"
          stackId="costs"
          fill="hsl(221 83% 80% / 0.7)"
          stroke="hsl(221 83% 70%)"
          strokeWidth={1}
          name="Fixed Costs"
          isAnimationActive={false}
        />

        {/* Variable costs: stacked on top */}
        <Area
          type="monotone"
          dataKey="variableCosts"
          stackId="costs"
          fill="hsl(38 92% 60% / 0.6)"
          stroke="hsl(38 92% 50%)"
          strokeWidth={1}
          name="Variable Costs"
          isAnimationActive={false}
        />

        {/* Revenue: solid blue line overlay */}
        <Line
          type="monotone"
          dataKey="revenue"
          stroke="hsl(217 91% 55%)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4 }}
          name="Revenue"
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
