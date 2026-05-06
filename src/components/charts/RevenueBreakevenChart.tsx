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
  Legend,
  ResponsiveContainer,
} from 'recharts';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface RevenueBreakevenChartDataPoint {
  label: string;
  revenue: number;
  breakeven: number;
  netIncome: number;
}

export interface RevenueBreakevenChartProps {
  data: RevenueBreakevenChartDataPoint[];
  height?: number;
  granularity: 'monthly' | 'quarterly' | 'annual';
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
// Computed data shape
// ─────────────────────────────────────────────

interface ChartPoint {
  label: string;
  revenue: number;
  breakeven: number;
  netIncome: number;
  /** Green zone: how far revenue is ABOVE breakeven */
  profitZone: number;
  /** Red zone base (= revenue when below breakeven) */
  lossBase: number;
  /** Red zone: how far breakeven is ABOVE revenue */
  lossZone: number;
}

function buildChartData(data: RevenueBreakevenChartDataPoint[]): ChartPoint[] {
  return data.map((d) => {
    const diff = d.revenue - d.breakeven;
    if (diff >= 0) {
      return {
        ...d,
        profitZone: diff,
        lossBase: d.breakeven,
        lossZone: 0,
      };
    } else {
      return {
        ...d,
        profitZone: 0,
        lossBase: d.revenue,
        lossZone: Math.abs(diff),
      };
    }
  });
}

// ─────────────────────────────────────────────
// Custom Tooltip
// ─────────────────────────────────────────────

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-md"
      style={{
        background: 'hsl(var(--card))',
        borderColor: 'hsl(var(--border))',
        color: 'hsl(var(--foreground))',
        minWidth: 160,
      }}
    >
      <p className="font-semibold mb-1.5">{label}</p>
      <div className="flex flex-col gap-0.5">
        <p>
          <span style={{ color: 'hsl(217 91% 55%)' }}>● </span>
          Revenue: {abbr(d.revenue)}
        </p>
        <p>
          <span style={{ color: 'hsl(38 92% 50%)' }}>● </span>
          Breakeven: {abbr(d.breakeven)}
        </p>
        <p>
          <span
            style={{
              color: d.netIncome >= 0 ? 'hsl(142 71% 45%)' : 'hsl(0 84% 60%)',
            }}
          >
            ●{' '}
          </span>
          Net Income: {abbr(d.netIncome)}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// RevenueBreakevenChart
// ─────────────────────────────────────────────

export function RevenueBreakevenChart({
  data,
  height = 300,
  granularity: _granularity,
}: RevenueBreakevenChartProps) {
  const chartData = buildChartData(data);
  const manyPoints = data.length >= 8;

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
        data={chartData}
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

        {/* Green profit zone: stacks from breakeven up to revenue */}
        <Area
          type="monotone"
          dataKey="lossBase"
          stackId="zone"
          fill="transparent"
          stroke="none"
          legendType="none"
          name="__base__"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="profitZone"
          stackId="zone"
          fill="hsl(142 71% 45% / 0.15)"
          stroke="none"
          legendType="none"
          name="Profit Zone"
          isAnimationActive={false}
        />

        {/* Red loss zone: stacks from revenue up to breakeven */}
        <Area
          type="monotone"
          dataKey="lossZone"
          stackId="zone"
          fill="hsl(0 84% 60% / 0.15)"
          stroke="none"
          legendType="none"
          name="Loss Zone"
          isAnimationActive={false}
        />

        {/* Revenue line: solid blue */}
        <Line
          type="monotone"
          dataKey="revenue"
          stroke="hsl(217 91% 55%)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          name="Revenue"
          isAnimationActive={false}
        />

        {/* Breakeven line: dashed amber */}
        <Line
          type="monotone"
          dataKey="breakeven"
          stroke="hsl(38 92% 50%)"
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          activeDot={{ r: 4 }}
          name="Breakeven"
          isAnimationActive={false}
        />

        {/* Net Income line: green when positive, otherwise red */}
        <Line
          type="monotone"
          dataKey="netIncome"
          stroke="hsl(142 71% 45%)"
          strokeWidth={2}
          dot={(props: { cx?: number; cy?: number; payload?: ChartPoint }) => {
            const { cx, cy, payload } = props;
            if (cx === undefined || cy === undefined || !payload) return <g key="empty" />;
            const fill =
              payload.netIncome >= 0 ? 'hsl(142 71% 45%)' : 'hsl(0 84% 60%)';
            return (
              <circle
                key={`dot-${cx}-${cy}`}
                cx={cx}
                cy={cy}
                r={3}
                fill={fill}
                stroke="none"
              />
            );
          }}
          name="Net Income"
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
