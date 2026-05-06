'use client';

import React from 'react';
import {
  LineChart,
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

export interface ScenarioData {
  name: string;
  color: string;
  data: { label: string; revenue: number; netIncome: number }[];
  isBaseline?: boolean;
}

export interface ScenarioComparisonChartProps {
  scenarios: ScenarioData[];
  metric: 'revenue' | 'netIncome';
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
// Merged data shape
// ─────────────────────────────────────────────

function mergeScenarioData(
  scenarios: ScenarioData[],
  metric: 'revenue' | 'netIncome'
): Record<string, number | string>[] {
  if (scenarios.length === 0) return [];

  // Use the first scenario's labels as the x-axis
  const labels = scenarios[0]!.data.map((d) => d.label);

  return labels.map((label, i) => {
    const row: Record<string, number | string> = { label };
    for (const scenario of scenarios) {
      const point = scenario.data[i];
      if (point) {
        row[scenario.name] = point[metric];
      }
    }
    return row;
  });
}

// ─────────────────────────────────────────────
// Custom Tooltip
// ─────────────────────────────────────────────

interface TooltipItem {
  name: string;
  value: number;
  color: string;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-md"
      style={{
        background: 'hsl(var(--card))',
        borderColor: 'hsl(var(--border))',
        color: 'hsl(var(--foreground))',
        minWidth: 150,
      }}
    >
      <p className="font-semibold mb-1.5">{label}</p>
      {payload.map((item) => (
        <p key={item.name} className="flex items-center gap-1.5">
          <span style={{ color: item.color }}>●</span>
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>{item.name}:</span>
          <span className="font-medium">{abbr(item.value)}</span>
        </p>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// ScenarioComparisonChart
// ─────────────────────────────────────────────

export function ScenarioComparisonChart({
  scenarios,
  metric,
  height = 280,
}: ScenarioComparisonChartProps) {
  const mergedData = mergeScenarioData(scenarios, metric);
  const manyPoints = mergedData.length >= 8;

  if (scenarios.length === 0 || mergedData.length === 0) {
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
        No scenario data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart
        data={mergedData}
        margin={{ top: 8, right: 30, bottom: manyPoints ? 52 : 8, left: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />

        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          angle={manyPoints ? -45 : 0}
          textAnchor={manyPoints ? 'end' : 'middle'}
          interval={manyPoints ? Math.ceil(mergedData.length / 8) - 1 : 0}
          height={manyPoints ? 60 : 30}
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

        {scenarios.map((scenario) => (
          <Line
            key={scenario.name}
            type="monotone"
            dataKey={scenario.name}
            stroke={scenario.color}
            strokeWidth={scenario.isBaseline ? 2.5 : 2}
            strokeDasharray={scenario.isBaseline ? undefined : '6 3'}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
