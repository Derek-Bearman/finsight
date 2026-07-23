'use client';

import React, { useMemo, useState } from 'react';
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
import type { ClientWorkspace, Scenario } from '@/types';
import { applyScenario } from '@/lib/scenarios';
import { projectWorkspace } from '@/lib/projections/workspace-projections';
import { getProfile } from '@/lib/profiles';
import { formatCurrency } from '@/lib/utils/format';
import { periodLabel } from '@/lib/utils/period';

// ─────────────────────────────────────────────
// Forward horizon for the live preview — the next 12 projected months.
// ─────────────────────────────────────────────

const HORIZON_MONTHS = 12;

const POSITIVE = 'hsl(142 71% 45%)';
const NEGATIVE = 'hsl(0 84% 60%)';
const BASE_LINE = 'hsl(var(--muted-foreground))';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function abbr(v: number): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(0)}K`;
  return `${sign}$${Math.round(a)}`;
}

function DeltaText({ value }: { value: number }) {
  // Sub-dollar deltas read as "no change" — the base and scenario paths match.
  if (Math.abs(value) < 1) {
    return <span style={{ color: 'hsl(var(--muted-foreground))' }}>no change</span>;
  }
  const positive = value > 0;
  const color = positive ? POSITIVE : NEGATIVE;
  const sign = positive ? '+' : '';
  return (
    <span style={{ color }}>
      {sign}
      {formatCurrency(value)} vs Base
    </span>
  );
}

// ─────────────────────────────────────────────
// Custom tooltip
// ─────────────────────────────────────────────

interface TooltipItem {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const scenario = payload.find((p) => p.dataKey === 'scenario');
  const base = payload.find((p) => p.dataKey === 'base');
  const delta =
    scenario && base ? scenario.value - base.value : undefined;
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
        <p key={item.dataKey} className="flex items-center gap-1.5">
          <span style={{ color: item.color }}>●</span>
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>{item.name}:</span>
          <span className="font-medium tabular-nums">{abbr(item.value)}</span>
        </p>
      ))}
      {delta !== undefined && Math.abs(delta) >= 1 && (
        <p
          className="mt-1 tabular-nums"
          style={{ color: delta > 0 ? POSITIVE : NEGATIVE }}
        >
          {delta > 0 ? '+' : ''}
          {abbr(delta)} vs Base
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// WhatIfLivePreview
// ─────────────────────────────────────────────

interface WhatIfLivePreviewProps {
  workspace: ClientWorkspace;
  /**
   * The LIVE scenario — slider values already merged into its adjustments by
   * the editor. Adjustments are applied to the base history, then the whole
   * workspace is re-projected 12 months forward, so the panel reflects the
   * current slider positions in real time.
   */
  scenario: Scenario;
  /** Accent color for the scenario line — matches the scenario's card color. */
  accentColor?: string;
}

export function WhatIfLivePreview({
  workspace,
  scenario,
  accentColor = 'hsl(217 91% 55%)',
}: WhatIfLivePreviewProps) {
  const [metric, setMetric] = useState<'revenue' | 'netIncome'>('revenue');

  const profileDefaultModel = getProfile(workspace.industryProfileId).defaultProjectionModel;

  // Persisted projection settings win over the profile default. When the user
  // has selected Driver-based on the Projections view, the What-If preview
  // projects in driver mode too, so the mixed fixed/variable split and the
  // scenario sliders both flow into the projected numbers. Fields absent =
  // profile default = today's behavior.
  const effectiveModel = workspace.projectionModel ?? profileDefaultModel;
  const growthOverride = workspace.projectionGrowthOverride ?? undefined;

  // Value signature of every mixed account's fixed/variable split. Added to the
  // projection memo deps so the preview recomputes when a split changes.
  const mixedSplitKey = workspace.accounts
    .filter((a) => a.costBehavior === 'mixed')
    .map((a) => `${a.id}:${a.mixedFixedPercent ?? 0.5}`)
    .join('|');

  const uniqueMonths = useMemo(
    () => new Set(workspace.values.map((v) => `${v.period.year}-${v.period.month}`)).size,
    [workspace.values]
  );
  const hasEnoughData = uniqueMonths >= 3 && workspace.accounts.length > 0;

  // Straight projection of the unadjusted history. Independent of the sliders,
  // so it only recomputes when the underlying data or model changes.
  const baseProjection = useMemo(() => {
    if (!hasEnoughData) return null;
    return projectWorkspace(
      workspace.accounts,
      workspace.values,
      { horizonMonths: HORIZON_MONTHS, model: effectiveModel, growthRateOverride: growthOverride }
    );
  }, [
    workspace.accounts,
    workspace.values,
    hasEnoughData,
    effectiveModel,
    growthOverride,
    mixedSplitKey,
  ]);

  // A content signature of the adjustments — the scenario object identity
  // changes every parent render (the editor rebuilds it from slider state), so
  // key the heavy projection on the adjustment CONTENT to recompute only when a
  // slider actually moves.
  const adjustmentsKey = useMemo(
    () => `${scenario.isBaseline ? 1 : 0}|${JSON.stringify(scenario.adjustments)}`,
    [scenario.isBaseline, scenario.adjustments]
  );

  // Adjusted projection — apply the live scenario to the base history, then
  // re-project. Recomputes synchronously as the adjustments change.
  const scenarioProjection = useMemo(() => {
    if (!hasEnoughData) return null;
    const adjustedValues = applyScenario(workspace.values, scenario, workspace.accounts);
    return projectWorkspace(
      workspace.accounts,
      adjustedValues,
      { horizonMonths: HORIZON_MONTHS, model: effectiveModel, growthRateOverride: growthOverride }
    );
    // scenario is intentionally read through adjustmentsKey to avoid recomputing
    // on unrelated parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspace.accounts,
    workspace.values,
    adjustmentsKey,
    hasEnoughData,
    effectiveModel,
    growthOverride,
    mixedSplitKey,
  ]);

  const summary = useMemo(() => {
    if (!baseProjection || !scenarioProjection) return null;
    const baseRows = baseProjection.rolledUp.filter((r) => r.isProjected).slice(0, HORIZON_MONTHS);
    const scenRows = scenarioProjection.rolledUp.filter((r) => r.isProjected).slice(0, HORIZON_MONTHS);
    const sum = (rows: typeof baseRows, key: 'revenue' | 'netIncome') =>
      rows.reduce((s, r) => s + r[key], 0);
    const baseRevenue = sum(baseRows, 'revenue');
    const scenarioRevenue = sum(scenRows, 'revenue');
    const baseNetIncome = sum(baseRows, 'netIncome');
    const scenarioNetIncome = sum(scenRows, 'netIncome');
    return {
      baseRevenue,
      scenarioRevenue,
      revenueDelta: scenarioRevenue - baseRevenue,
      baseNetIncome,
      scenarioNetIncome,
      netIncomeDelta: scenarioNetIncome - baseNetIncome,
    };
  }, [baseProjection, scenarioProjection]);

  const chartData = useMemo(() => {
    if (!baseProjection || !scenarioProjection) return [];
    const baseRows = baseProjection.rolledUp.filter((r) => r.isProjected).slice(0, HORIZON_MONTHS);
    const scenRows = scenarioProjection.rolledUp.filter((r) => r.isProjected).slice(0, HORIZON_MONTHS);
    return baseRows.map((row, i) => {
      const scen = scenRows[i];
      return {
        label: periodLabel(row.period),
        base: metric === 'revenue' ? row.revenue : row.netIncome,
        scenario: scen ? (metric === 'revenue' ? scen.revenue : scen.netIncome) : undefined,
      };
    });
  }, [baseProjection, scenarioProjection, metric]);

  const isBaseline = scenario.isBaseline ?? false;

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-4"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      data-testid="whatif-live-preview"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
            Live Projection
            <span className="block text-xs font-normal" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Next 12 months, adjustments applied
            </span>
          </h4>
        </div>
        {/* Metric toggle */}
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'hsl(var(--muted))' }}>
          {(['revenue', 'netIncome'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className="px-2 py-0.5 rounded-md text-xs font-medium transition-colors"
              style={{
                background: metric === m ? 'hsl(var(--primary))' : 'transparent',
                color: metric === m ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
              }}
              data-testid={`whatif-live-metric-${m}`}
            >
              {m === 'revenue' ? 'Revenue' : 'Net Income'}
            </button>
          ))}
        </div>
      </div>

      {!hasEnoughData || !summary ? (
        <div className="flex items-center justify-center" style={{ minHeight: 160 }}>
          <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
            At least 3 months of financial data is required to project.
          </p>
        </div>
      ) : (
        <>
          {/* Numeric tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              className="rounded-lg border p-3 flex flex-col gap-1"
              style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted) / 0.3)' }}
            >
              <span className="text-xs font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Projected Revenue
              </span>
              <span
                className="text-lg font-bold tabular-nums"
                style={{ color: 'hsl(var(--foreground))' }}
                data-testid="whatif-live-revenue"
              >
                {formatCurrency(summary.scenarioRevenue)}
              </span>
              <span className="text-xs tabular-nums">
                <DeltaText value={summary.revenueDelta} />
              </span>
            </div>

            <div
              className="rounded-lg border p-3 flex flex-col gap-1"
              style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted) / 0.3)' }}
            >
              <span className="text-xs font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Projected Net Income
              </span>
              <span
                className="text-lg font-bold tabular-nums"
                style={{ color: 'hsl(var(--foreground))' }}
                data-testid="whatif-live-net-income"
              >
                {formatCurrency(summary.scenarioNetIncome)}
              </span>
              <span className="text-xs tabular-nums">
                <DeltaText value={summary.netIncomeDelta} />
              </span>
            </div>
          </div>

          {/* Baseline note — the two paths coincide when there are no adjustments. */}
          {isBaseline && (
            <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Base Case shows the straight projection. Pick or adjust a scenario to compare an
              adjusted path against it.
            </p>
          )}

          {/* Chart */}
          <div data-testid="whatif-live-chart">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 40, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                  height={48}
                />
                <YAxis
                  tickFormatter={abbr}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  width={64}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }} />
                <Line
                  type="monotone"
                  dataKey="base"
                  name="Base"
                  stroke={BASE_LINE}
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="scenario"
                  name={scenario.name}
                  stroke={accentColor}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
