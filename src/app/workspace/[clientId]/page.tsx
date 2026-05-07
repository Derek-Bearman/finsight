'use client';

import React, { use, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { TourOverlay, useTour, HelpButton, TOUR_STEPS } from '@/components/tutorial';
import { useWorkspaceStore } from '@/store/workspace-store';
import { ALL_PROFILES, getProfile } from '@/lib/profiles';
import { classifyAll, applyClassification } from '@/lib/classifiers';
import { projectWorkspace } from '@/lib/projections/workspace-projections';
import type { WorkspaceProjectionOptions } from '@/lib/projections/workspace-projections';
import type { ProjectionModel } from '@/types';
import { ProjectionChart, ProjectionControls } from '@/components/projections';
import type { HorizonKey } from '@/components/projections/ProjectionControls';
import type { ProjectionChartDataPoint } from '@/components/projections/ProjectionChart';
import { periodLabel, periodSortKey } from '@/lib/utils/period';
import { computePnL, toFinancialSummary } from '@/lib/calculations/pnl';
import { getUniquePeriods } from '@/lib/calculations/period-aggregation';
import { computeMetricsForPeriod } from '@/lib/operational';
import { PeriodSelector, MetricGrid } from '@/components/operational';
import {
  MappingToolbar,
  MappingViewA,
  MappingViewB,
} from '@/components/mapping';
import {
  applyScenario as _applyScenario,
  computeScenarioImpact,
  buildDefaultScenarios,
  SCENARIO_COLORS,
} from '@/lib/scenarios';
import {
  buildPeriodAggregations,
  computeBreakevenSeries,
  computeBalanceSheetSeries,
  computeHealthSeries,
  computeProfitabilitySeries,
} from '@/lib/calculations';
import type { Granularity } from '@/lib/calculations/period-aggregation';
import { PnLReport } from '@/components/reports';
import { formatCurrency, formatPercent, formatMetricValue } from '@/lib/utils/format';
import type { Account, AccountValue, AuditEntry, MappingMemoryEntry, BenchmarkRange } from '@/types';
import {
  RevenueBreakevenChart,
  CostStructureChart,
  MarginWaterfall,
  RatioDashboard,
  ScenarioComparisonChart,
} from '@/components/charts';
import type {
  RatioSparklineProps,
  WaterfallStep,
} from '@/components/charts';

// ── Helper: years available in values ────────────────────────────────────────

function getAvailableYears(values: AccountValue[]): number[] {
  if (values.length === 0) return [];
  const years = new Set(values.map((v) => v.period.year));
  return Array.from(years).sort((a, b) => b - a);
}

function getLatestYear(values: AccountValue[]): number | null {
  if (values.length === 0) return null;
  return Math.max(...values.map((v) => v.period.year));
}

// ── Nav tabs ─────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'mapping' | 'reports' | 'projections' | 'whatif' | 'operational';

const TABS: { id: Tab; label: string; phase: string | null }[] = [
  { id: 'overview', label: 'Overview', phase: null },
  { id: 'mapping', label: 'Mapping', phase: null },
  { id: 'reports', label: 'Reports', phase: null },
  { id: 'projections', label: 'Projections', phase: null },
  { id: 'whatif', label: 'What-If', phase: null },
  { id: 'operational', label: 'Operational', phase: null },
];

// ── Horizon months map ─────────────────────────────────────────────────────────

const HORIZON_MONTHS: Record<HorizonKey, number> = {
  '12m': 12,
  '1y': 12,
  '3y': 36,
  '5y': 60,
  '10y': 120,
};

// ── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  const color =
    positive === undefined
      ? 'hsl(var(--foreground))'
      : positive
      ? 'hsl(142 71% 45%)'
      : 'hsl(0 84% 60%)';
  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-1"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
    >
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
        {label}
      </p>
      <p className="text-xl font-bold leading-tight" style={{ color }}>
        {value}
      </p>
      {sub && (
        <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ── Placeholder tab ───────────────────────────────────────────────────────────

function PlaceholderTab({ label, phase }: { label: string; phase: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
      <div
        className="rounded-full h-12 w-12 flex items-center justify-center text-2xl"
        style={{ background: 'hsl(var(--muted))' }}
      >
        🔒
      </div>
      <p className="font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
        {label}
      </p>
      <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
        Coming in {phase}
      </p>
    </div>
  );
}

// ── Mapping tab wrapper ───────────────────────────────────────────────────────

function MappingTab({ clientId }: { clientId: string }) {
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === clientId));
  const batchUpdateAccounts = useWorkspaceStore((s) => s.batchUpdateAccounts);
  const appendAuditEntry = useWorkspaceStore((s) => s.appendAuditEntry);
  const rememberMapping = useWorkspaceStore((s) => s.rememberMapping);

  const [view, setView] = useState<'type' | 'behavior'>('type');
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleAccountsChange = useCallback(
    (accounts: Account[]) => {
      batchUpdateAccounts(clientId, accounts);
    },
    [clientId, batchUpdateAccounts]
  );

  const handleAuditEntry = useCallback(
    (entry: AuditEntry) => {
      appendAuditEntry(clientId, entry);
    },
    [clientId, appendAuditEntry]
  );

  const handleRememberMapping = useCallback(
    (entry: MappingMemoryEntry) => {
      rememberMapping(entry);
    },
    [rememberMapping]
  );

  const handleReset = useCallback(() => {
    if (!workspace) return;
    const profile = getProfile(workspace.industryProfileId);
    const results = classifyAll(workspace.accounts, profile);
    const updatedAccounts = workspace.accounts.map((account) => {
      if (!account.isManuallyClassified) return account;
      const result = results.get(account.id);
      if (!result) return { ...account, isManuallyClassified: false };
      const cleared: Account = { ...account, isManuallyClassified: false };
      return applyClassification(cleared, result);
    });

    const manualCount = workspace.accounts.filter((a) => a.isManuallyClassified).length;

    const resetEntry: AuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date().toISOString(),
      accountId: 'batch',
      accountName: `${manualCount} accounts`,
      action: 'reset_to_auto',
      previousValue: 'manual',
      newValue: 'auto',
      performedBy: 'user',
    };

    batchUpdateAccounts(clientId, updatedAccounts);
    appendAuditEntry(clientId, resetEntry);
    showToast(`${manualCount} account${manualCount !== 1 ? 's' : ''} reclassified`);
  }, [workspace, clientId, batchUpdateAccounts, appendAuditEntry]);

  if (!workspace) return null;

  const manualCount = workspace.accounts.filter((a) => a.isManuallyClassified).length;

  return (
    <div className="flex flex-col gap-4 relative">
      <MappingToolbar
        view={view}
        onViewChange={setView}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onReset={handleReset}
        totalAccounts={workspace.accounts.length}
        manualCount={manualCount}
        auditEntries={workspace.auditLog}
      />

      {view === 'type' ? (
        <MappingViewA
          workspace={workspace}
          onAccountsChange={handleAccountsChange}
          onAuditEntry={handleAuditEntry}
          onRememberMapping={handleRememberMapping}
        />
      ) : (
        <MappingViewB
          workspace={workspace}
          onAccountsChange={handleAccountsChange}
          onAuditEntry={handleAuditEntry}
          onRememberMapping={handleRememberMapping}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg border px-5 py-3 shadow-lg text-sm font-medium"
          style={{
            background: 'hsl(var(--card))',
            borderColor: 'hsl(142 76% 36% / 0.5)',
            color: 'hsl(142 76% 28%)',
          }}
          role="status"
          aria-live="polite"
        >
          ✓ {toast}
        </div>
      )}
    </div>
  );
}

// ── Projections Tab ─────────────────────────────────────────────────────────

function ProjectionsTab({ clientId }: { clientId: string }) {
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === clientId));

  const [model, setModel] = useState<ProjectionModel>('linear');
  const [horizon, setHorizon] = useState<HorizonKey>('12m');
  const [growthRateOverride, setGrowthRateOverride] = useState<number | null>(null);

  const profile = workspace ? getProfile(workspace.industryProfileId) : null;

  // Set default model from profile on mount
  useEffect(() => {
    if (profile) setModel(profile.defaultProjectionModel);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const horizonMonths = HORIZON_MONTHS[horizon];

  const uniqueMonths = workspace
    ? new Set(workspace.values.map((v) => `${v.period.year}-${v.period.month}`)).size
    : 0;
  const hasEnoughData = uniqueMonths >= 3;

  const projectionOptions: WorkspaceProjectionOptions = useMemo(
    () => ({ model, horizonMonths, growthRateOverride: growthRateOverride ?? undefined }),
    [model, horizonMonths, growthRateOverride]
  );

  const projectionResult = useMemo(() => {
    if (!hasEnoughData || !workspace || workspace.accounts.length === 0) return null;
    return projectWorkspace(
      workspace.accounts,
      workspace.values,
      projectionOptions,
      profile?.defaultProjectionModel
    );
  }, [workspace?.accounts, workspace?.values, projectionOptions, hasEnoughData]); // eslint-disable-line react-hooks/exhaustive-deps

  const impliedGrowthRate = useMemo(() => {
    if (!projectionResult) return undefined;
    const historical = projectionResult.rolledUp.filter((r) => !r.isProjected);
    const projected = projectionResult.rolledUp.filter((r) => r.isProjected);
    if (historical.length === 0 || projected.length === 0) return undefined;
    const lastHistRev = historical[historical.length - 1]!.revenue;
    const lastProjRev = projected[projected.length - 1]!.revenue;
    const months = projected.length;
    if (lastHistRev > 0 && months > 0) {
      return Math.pow(lastProjRev / lastHistRev, 12 / months) - 1;
    }
    return undefined;
  }, [projectionResult]);

  const revenueChartData = useMemo((): ProjectionChartDataPoint[] => {
    if (!projectionResult) return [];
    return projectionResult.rolledUp.map((row) => ({
      label: periodLabel(row.period),
      actual: row.isProjected ? undefined : row.revenue,
      projected: row.isProjected ? row.revenue : undefined,
      lower80: row.revenueProjected?.lower80,
      upper80: row.revenueProjected?.upper80,
      isProjected: row.isProjected,
    }));
  }, [projectionResult]);

  if (!workspace) return null;

  return (
    <div className="flex flex-col gap-6">
      {/* Controls row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <ProjectionControls
          model={model}
          onModelChange={setModel}
          horizon={horizon}
          onHorizonChange={setHorizon}
          growthRateOverride={growthRateOverride}
          onGrowthRateChange={setGrowthRateOverride}
          profileDefaultModel={profile?.defaultProjectionModel ?? 'linear'}
          impliedGrowthRate={impliedGrowthRate}
        />
        <Link
          href={`/workspace/${clientId}/projections`}
          className="text-sm font-medium underline underline-offset-2 whitespace-nowrap"
          style={{ color: 'hsl(var(--primary))' }}
        >
          View Full Projections →
        </Link>
      </div>

      {!hasEnoughData ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
            At least 3 months of financial data is required to run projections.
          </p>
        </div>
      ) : (
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'hsl(var(--foreground))' }}>
            Revenue Projection
          </h3>
          <ProjectionChart data={revenueChartData} metric="revenue" height={300} />
        </div>
      )}
    </div>
  );
}

// ── Reports Tab ─────────────────────────────────────────────────────────────

function RatioCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-1"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
    >
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
        {label}
      </p>
      <p className="text-xl font-bold" style={{ color: color ?? 'hsl(var(--foreground))' }}>
        {value}
      </p>
    </div>
  );
}

function zScoreZoneColor(z: number | null): string {
  if (z === null) return 'hsl(var(--muted-foreground))';
  if (z >= 2.6) return 'hsl(142 71% 45%)';
  if (z >= 1.1) return 'hsl(38 92% 50%)';
  return 'hsl(0 84% 60%)';
}

function zScoreZoneLabel(z: number | null): string {
  if (z === null) return '—';
  if (z >= 2.6) return `${z.toFixed(2)} (Safe)`;
  if (z >= 1.1) return `${z.toFixed(2)} (Grey Zone)`;
  return `${z.toFixed(2)} (Distress)`;
}

function ReportsTab({ clientId }: { clientId: string }) {
  const workspace = useWorkspaceStore(s => s.workspaces.find(w => w.id === clientId));
  const [granularity, setGranularity] = useState<Granularity>('annual');

  const { aggregations, bsSeries, profSeries, healthSeries } = useMemo(() => {
    if (!workspace || workspace.accounts.length === 0) {
      return { aggregations: [], bsSeries: [], profSeries: [], healthSeries: [] };
    }
    return {
      aggregations: buildPeriodAggregations(workspace.accounts, workspace.values, granularity, workspace.fiscalYearStart),
      bsSeries: computeBalanceSheetSeries(workspace.accounts, workspace.values, granularity),
      profSeries: computeProfitabilitySeries(workspace.accounts, workspace.values, granularity),
      healthSeries: computeHealthSeries(workspace.accounts, workspace.values, granularity),
    };
  }, [workspace?.accounts, workspace?.values, granularity]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!workspace) return null;

  const hasData = workspace.accounts.length > 0 && workspace.values.length > 0;

  // Latest period key ratios
  const latestBS = bsSeries.length > 0 ? bsSeries[bsSeries.length - 1] : null;
  const latestProf = profSeries.length > 0 ? profSeries[profSeries.length - 1] : null;
  const latestHealth = healthSeries.length > 0 ? healthSeries[healthSeries.length - 1] : null;
  const latestAgg = aggregations.length > 0 ? aggregations[aggregations.length - 1] : null;

  const GRANULARITIES: { id: Granularity; label: string }[] = [
    { id: 'monthly', label: 'Monthly' },
    { id: 'quarterly', label: 'Quarterly' },
    { id: 'annual', label: 'Annual' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Granularity toggle */}
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'hsl(var(--muted))' }}>
          {GRANULARITIES.map(g => (
            <button
              key={g.id}
              onClick={() => setGranularity(g.id)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{
                background: granularity === g.id ? 'hsl(var(--primary))' : 'transparent',
                color: granularity === g.id ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
              }}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Full reports link */}
        <Link
          href={`/workspace/${clientId}/reports`}
          className="text-sm font-medium underline underline-offset-2"
          style={{ color: 'hsl(var(--primary))' }}
        >
          View Full Reports →
        </Link>
      </div>

      {!hasData ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
            No financial data available. Import data to see reports.
          </p>
        </div>
      ) : (
        <>
          {/* P&L Table */}
          <PnLReport aggregations={aggregations} granularity={granularity} />

          {/* Key Ratios summary cards */}
          {(latestBS || latestProf || latestHealth || latestAgg) && (
            <div>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'hsl(var(--foreground))' }}>
                Key Ratios (Latest Period)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <RatioCard
                  label="Gross Margin %"
                  value={latestAgg ? formatMetricValue(latestAgg.grossMarginPct, 'percent') : '—'}
                />
                <RatioCard
                  label="Net Margin %"
                  value={latestAgg ? formatMetricValue(latestAgg.netMarginPct, 'percent') : '—'}
                />
                <RatioCard
                  label="Current Ratio"
                  value={latestBS?.currentRatio != null ? formatMetricValue(latestBS.currentRatio, 'ratio') : '—'}
                />
                <RatioCard
                  label="Debt / Equity"
                  value={latestBS?.debtToEquity != null ? formatMetricValue(latestBS.debtToEquity, 'ratio') : '—'}
                />
                <RatioCard
                  label="ROE %"
                  value={latestProf?.roe != null ? formatMetricValue(latestProf.roe, 'percent') : '—'}
                />
                <RatioCard
                  label="Altman Z''"
                  value={zScoreZoneLabel(latestHealth?.altmanZScore ?? null)}
                  color={zScoreZoneColor(latestHealth?.altmanZScore ?? null)}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

const GRANULARITIES: { id: Granularity; label: string }[] = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annual', label: 'Annual' },
];

// Benchmarks for ratio dashboard cards
const GROSS_MARGIN_BENCHMARK: BenchmarkRange = { good: 0.4, warn: 0.2, bad: 0, direction: 'higher' };
const NET_MARGIN_BENCHMARK: BenchmarkRange = { good: 0.1, warn: 0.03, bad: 0, direction: 'higher' };
const CURRENT_RATIO_BENCHMARK: BenchmarkRange = { good: 2, warn: 1, bad: 0.5, direction: 'higher' };
const DEBT_EQUITY_BENCHMARK: BenchmarkRange = { good: 1, warn: 2, bad: 4, direction: 'lower' };
const CONTRIBUTION_MARGIN_BENCHMARK: BenchmarkRange = { good: 0.4, warn: 0.2, bad: 0, direction: 'higher' };
const ZSCORE_BENCHMARK: BenchmarkRange = { good: 2.6, warn: 1.1, bad: 0, direction: 'higher' };

function OverviewTab({ clientId }: { clientId: string }) {
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === clientId));

  const availableYears = useMemo(
    () => (workspace ? getAvailableYears(workspace.values) : []),
    [workspace?.values] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const defaultYear = availableYears[0] ?? null;
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [granularity, setGranularity] = useState<Granularity>('monthly');

  const effectiveYear = selectedYear ?? defaultYear;

  // ── Filter values to selected year ──────────────────────────────────────
  const yearValues = useMemo(() => {
    if (!workspace || effectiveYear === null) return [];
    return workspace.values.filter((v) => v.period.year === effectiveYear);
  }, [workspace?.values, effectiveYear]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Period aggregations for charts ──────────────────────────────────────
  const periodAggs = useMemo(() => {
    if (!workspace || workspace.accounts.length === 0 || yearValues.length === 0) return [];
    return buildPeriodAggregations(workspace.accounts, yearValues, granularity, workspace.fiscalYearStart);
  }, [workspace?.accounts, yearValues, granularity, workspace?.fiscalYearStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Annual KPI totals ────────────────────────────────────────────────────
  const annualPnL = useMemo(() => {
    if (periodAggs.length === 0) {
      return { revenue: 0, cogs: 0, grossProfit: 0, grossMarginPct: 0, operatingExpenses: 0, netIncome: 0 };
    }
    const revenue = periodAggs.reduce((s, a) => s + a.revenue, 0);
    const cogs = periodAggs.reduce((s, a) => s + a.cogs, 0);
    const grossProfit = periodAggs.reduce((s, a) => s + a.grossProfit, 0);
    const operatingExpenses = periodAggs.reduce((s, a) => s + a.operatingExpenses, 0);
    const netIncome = periodAggs.reduce((s, a) => s + a.netIncome, 0);
    const grossMarginPct = revenue > 0 ? grossProfit / revenue : 0;
    return { revenue, cogs, grossProfit, grossMarginPct, operatingExpenses, netIncome };
  }, [periodAggs]);

  // ── Breakeven series ─────────────────────────────────────────────────────
  const breakevenSeries = useMemo(() => {
    if (!workspace || workspace.accounts.length === 0 || yearValues.length === 0) return [];
    return computeBreakevenSeries(workspace.accounts, yearValues, granularity);
  }, [workspace?.accounts, yearValues, granularity]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Revenue/Breakeven chart data ─────────────────────────────────────────
  const revenueBreakevenData = useMemo(() => {
    if (periodAggs.length === 0 || breakevenSeries.length === 0) return [];
    return periodAggs.map((agg, i) => ({
      label: agg.label,
      revenue: agg.revenue,
      breakeven: breakevenSeries[i]?.breakevenRevenue ?? 0,
      netIncome: agg.netIncome,
    }));
  }, [periodAggs, breakevenSeries]);

  // ── Cost structure chart data ────────────────────────────────────────────
  const costStructureData = useMemo(() => {
    return periodAggs.map((agg) => ({
      label: agg.label,
      revenue: agg.revenue,
      fixedCosts: agg.totalFixedCosts,
      variableCosts: agg.totalVariableCosts,
    }));
  }, [periodAggs]);

  // ── Waterfall for latest period ──────────────────────────────────────────
  const waterfallSteps = useMemo((): WaterfallStep[] => {
    if (periodAggs.length === 0) return [];
    const latest = periodAggs[periodAggs.length - 1]!;
    return [
      { label: 'Revenue', value: latest.revenue, isTotal: true, isNegative: false },
      { label: 'COGS', value: latest.cogs, isTotal: false, isNegative: true },
      { label: 'Gross Profit', value: latest.grossProfit, isTotal: true, isNegative: false },
      { label: 'OpEx', value: latest.operatingExpenses, isTotal: false, isNegative: true },
      { label: 'Op. Income', value: latest.operatingIncome, isTotal: true, isNegative: false },
      { label: 'Net Income', value: latest.netIncome, isTotal: true, isNegative: false },
    ];
  }, [periodAggs]);

  // ── Balance sheet + health for ratio dashboard ───────────────────────────
  const { bsSeries, healthSeries } = useMemo(() => {
    if (!workspace || workspace.accounts.length === 0 || yearValues.length === 0) {
      return { bsSeries: [], healthSeries: [] };
    }
    return {
      bsSeries: computeBalanceSheetSeries(workspace.accounts, yearValues, granularity),
      healthSeries: computeHealthSeries(workspace.accounts, yearValues, granularity),
    };
  }, [workspace?.accounts, yearValues, granularity]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ratio dashboard cards ────────────────────────────────────────────────
  const ratioCards = useMemo((): RatioSparklineProps[] => {
    const N = 6;
    const aggs = periodAggs.slice(-N);
    const bsSlice = bsSeries.slice(-N);
    const healthSlice = healthSeries.slice(-N);

    const latestAgg = aggs[aggs.length - 1];
    const latestBS = bsSlice[bsSlice.length - 1];
    const latestHealth = healthSlice[healthSlice.length - 1];

    return [
      {
        label: 'Gross Margin %',
        value: latestAgg?.grossMarginPct ?? null,
        format: 'percent',
        trend: aggs.map((a) => a.grossMarginPct),
        benchmark: GROSS_MARGIN_BENCHMARK,
      },
      {
        label: 'Net Margin %',
        value: latestAgg?.netMarginPct ?? null,
        format: 'percent',
        trend: aggs.map((a) => a.netMarginPct),
        benchmark: NET_MARGIN_BENCHMARK,
      },
      {
        label: 'Current Ratio',
        value: latestBS?.currentRatio ?? null,
        format: 'ratio',
        trend: bsSlice.map((b) => b.currentRatio ?? 0).filter((v, i, a) => a.length > 0 ? true : false),
        benchmark: CURRENT_RATIO_BENCHMARK,
      },
      {
        label: 'Debt / Equity',
        value: latestBS?.debtToEquity ?? null,
        format: 'ratio',
        trend: bsSlice.map((b) => b.debtToEquity ?? 0),
        benchmark: DEBT_EQUITY_BENCHMARK,
      },
      {
        label: 'Contribution Margin %',
        value: latestAgg?.contributionMarginPct ?? null,
        format: 'percent',
        trend: aggs.map((a) => a.contributionMarginPct),
        benchmark: CONTRIBUTION_MARGIN_BENCHMARK,
      },
      {
        label: "Altman Z'' Score",
        value: latestHealth?.altmanZScore ?? null,
        format: 'number',
        trend: healthSlice.map((h) => h.altmanZScore ?? 0),
        benchmark: ZSCORE_BENCHMARK,
      },
    ];
  }, [periodAggs, bsSeries, healthSeries]);

  // ── Scenario comparison data ─────────────────────────────────────────────
  const scenarioChartData = useMemo(() => {
    if (!workspace) return [];
    const scenariosWithAdjustments = workspace.scenarios.filter(
      (sc) => !sc.isBaseline && sc.adjustments.length > 0
    );
    if (scenariosWithAdjustments.length === 0) return [];

    const SCENARIO_COLORS = [
      'hsl(38 92% 50%)',
      'hsl(270 70% 55%)',
      'hsl(186 70% 45%)',
    ];

    // Baseline scenario data (actuals)
    const baselineData = periodAggs.map((agg) => ({
      label: agg.label,
      revenue: agg.revenue,
      netIncome: agg.netIncome,
    }));

    if (baselineData.length === 0) return [];

    const baselineScenario = {
      name: 'Baseline (Actuals)',
      color: 'hsl(217 91% 55%)',
      data: baselineData,
      isBaseline: true,
    };

    return [baselineScenario];
  }, [workspace?.scenarios, periodAggs]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!workspace) return null;

  const hasData = workspace.values.length > 0 && workspace.accounts.length > 0;
  const latestPeriodLabel =
    periodAggs.length > 0 ? periodAggs[periodAggs.length - 1]!.label : null;

  return (
    <div className="flex flex-col gap-8">

      {/* Section 1: Header row — Year selector + Granularity */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {/* FY Selector */}
          {availableYears.length > 0 && (
            <div className="flex items-center gap-2">
              <label
                className="text-xs font-medium"
                style={{ color: 'hsl(var(--muted-foreground))' }}
              >
                Fiscal Year:
              </label>
              <select
                value={effectiveYear ?? ''}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="rounded-md border px-2 py-1 text-sm font-medium"
                style={{
                  borderColor: 'hsl(var(--border))',
                  background: 'hsl(var(--card))',
                  color: 'hsl(var(--foreground))',
                }}
              >
                {availableYears.map((yr) => (
                  <option key={yr} value={yr}>
                    FY{yr}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Granularity toggle */}
          <div
            className="flex items-center gap-1 rounded-lg p-1"
            style={{ background: 'hsl(var(--muted))' }}
          >
            {GRANULARITIES.map((g) => (
              <button
                key={g.id}
                onClick={() => setGranularity(g.id)}
                className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: granularity === g.id ? 'hsl(var(--primary))' : 'transparent',
                  color:
                    granularity === g.id
                      ? 'hsl(var(--primary-foreground))'
                      : 'hsl(var(--muted-foreground))',
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {effectiveYear && (
          <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {workspace.accounts.length} accounts · {workspace.values.length} data points
          </span>
        )}
      </div>

      {/* Section 2: KPI Cards */}
      {!hasData ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
            No financial data imported. Upload a P&amp;L to see summary metrics.
          </p>
          <Link
            href="/"
            className="inline-flex mt-3 text-sm font-medium underline underline-offset-2"
            style={{ color: 'hsl(var(--primary))' }}
          >
            Import data
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <SummaryCard
            label="Revenue"
            value={formatCurrency(annualPnL.revenue)}
          />
          <SummaryCard
            label="COGS"
            value={formatCurrency(annualPnL.cogs)}
          />
          <SummaryCard
            label="Gross Profit"
            value={formatCurrency(annualPnL.grossProfit)}
            sub={formatPercent(annualPnL.grossMarginPct) + ' margin'}
            positive={annualPnL.grossProfit >= 0}
          />
          <SummaryCard
            label="Operating Expenses"
            value={formatCurrency(annualPnL.operatingExpenses)}
          />
          <SummaryCard
            label="Net Income"
            value={formatCurrency(annualPnL.netIncome)}
            positive={annualPnL.netIncome >= 0}
          />
        </div>
      )}

      {/* Section 3: Revenue vs Breakeven chart */}
      {hasData && revenueBreakevenData.length > 0 && (
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
        >
          <h3
            className="text-sm font-semibold mb-4"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Revenue vs. Breakeven
          </h3>
          <RevenueBreakevenChart
            data={revenueBreakevenData}
            height={300}
            granularity={granularity === 'ttm' ? 'monthly' : granularity}
          />
        </div>
      )}

      {/* Section 4: Cost Structure + Waterfall */}
      {hasData && periodAggs.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Cost Structure */}
          <div
            className="rounded-xl border p-4"
            style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
          >
            <h3
              className="text-sm font-semibold mb-4"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              Cost Structure
            </h3>
            <CostStructureChart data={costStructureData} height={280} />
          </div>

          {/* Right: Waterfall */}
          <div
            className="rounded-xl border p-4"
            style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
          >
            <h3
              className="text-sm font-semibold mb-1"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              P&amp;L Waterfall
            </h3>
            {latestPeriodLabel && (
              <p
                className="text-xs mb-3"
                style={{ color: 'hsl(var(--muted-foreground))' }}
              >
                Latest period: {latestPeriodLabel}
              </p>
            )}
            <MarginWaterfall steps={waterfallSteps} height={280} />
          </div>
        </div>
      )}

      {/* Section 5: Ratio Dashboard */}
      {hasData && periodAggs.length > 0 && (
        <div>
          <h3
            className="text-sm font-semibold mb-4"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Key Ratios
          </h3>
          <RatioDashboard cards={ratioCards} />
        </div>
      )}

      {/* Section 6: Scenario comparison (only if >1 scenario with adjustments) */}
      {hasData && scenarioChartData.length > 1 && (
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
        >
          <h3
            className="text-sm font-semibold mb-4"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Scenario Comparison — Revenue
          </h3>
          <ScenarioComparisonChart
            scenarios={scenarioChartData}
            metric="revenue"
            height={280}
          />
        </div>
      )}

      {/* Scenarios list (keep from original) */}
      {workspace.scenarios.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'hsl(var(--foreground))' }}>
            Scenarios
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {workspace.scenarios.map((sc) => (
              <div
                key={sc.id}
                className="rounded-xl border p-4"
                style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                    {sc.name}
                  </p>
                  {sc.isBaseline && (
                    <span
                      className="rounded px-1 py-0.5 text-xs"
                      style={{ background: 'hsl(var(--accent))', color: 'hsl(var(--accent-foreground))' }}
                    >
                      Baseline
                    </span>
                  )}
                </div>
                {sc.description && (
                  <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {sc.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── What-If Tab ─────────────────────────────────────────────────────────────

function WhatIfTabContent({ clientId }: { clientId: string }) {
  const workspace = useWorkspaceStore(s => s.workspaces.find(w => w.id === clientId));
  const addScenario = useWorkspaceStore(s => s.addScenario);
  const updateScenario = useWorkspaceStore(s => s.updateScenario);
  const activeScenarioId = useWorkspaceStore(s => s.activeScenarioId);
  const setActiveScenario = useWorkspaceStore(s => s.setActiveScenario);

  // Initialize default scenarios on first mount
  useEffect(() => {
    if (!workspace || workspace.scenarios.length > 0) return;
    const firstPeriod: import('@/types').Period = (() => {
      if (workspace.values.length === 0) {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() + 1 };
      }
      const sorted = [...workspace.values].sort(
        (a, b) => a.period.year * 12 + a.period.month - (b.period.year * 12 + b.period.month)
      );
      return sorted[0]!.period;
    })();
    const defaults = buildDefaultScenarios(firstPeriod);
    defaults.forEach(sc => addScenario(clientId, sc));
    if (defaults[0]) setActiveScenario(defaults[0].id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!workspace) return null;

  const scenarios = workspace.scenarios;
  const activeScenario = scenarios.find(s => s.id === activeScenarioId) ?? scenarios[0] ?? null;
  const baseScenario = scenarios.find(s => s.isBaseline) ?? null;
  const nonBaseScenario = activeScenario?.isBaseline ? null : activeScenario;

  // Compute quick impact for the active scenario
  const impact = useMemo(() => {
    if (!nonBaseScenario || !baseScenario) return null;
    if (workspace.accounts.length === 0 || workspace.values.length === 0) return null;
    return computeScenarioImpact(workspace.accounts, workspace.values, nonBaseScenario);
  }, [workspace.accounts, workspace.values, nonBaseScenario, baseScenario]); // eslint-disable-line react-hooks/exhaustive-deps

  // Slider state (local)
  const [revSlider, setRevSlider] = useState(0);
  const [costSlider, setCostSlider] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync sliders from active scenario
  useEffect(() => {
    if (!activeScenario) return;
    const r = activeScenario.adjustments.find(a => a.accountId === '_all_revenue_' && a.type === 'percent');
    const c = activeScenario.adjustments.find(a => a.accountId === '_all_costs_' && a.type === 'percent');
    setRevSlider(r?.value ?? 0);
    setCostSlider(c?.value ?? 0);
  }, [activeScenario?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstPeriod = useMemo((): import('@/types').Period => {
    if (!workspace || workspace.values.length === 0) {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }
    const sorted = [...workspace.values].sort(
      (a, b) => a.period.year * 12 + a.period.month - (b.period.year * 12 + b.period.month)
    );
    return sorted[0]!.period;
  }, [workspace?.values]); // eslint-disable-line react-hooks/exhaustive-deps

  const persistSliders = useCallback((rv: number, cv: number) => {
    if (!activeScenario || activeScenario.isBaseline) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const baseAdjs = activeScenario.adjustments.filter(
        a => !(a.accountId === '_all_revenue_' && a.type === 'percent') &&
             !(a.accountId === '_all_costs_' && a.type === 'percent')
      );
      const sliderAdjs: import('@/types').ScenarioAdjustment[] = [];
      if (rv !== 0) sliderAdjs.push({ accountId: '_all_revenue_', type: 'percent', value: rv, appliesFrom: firstPeriod });
      if (cv !== 0) sliderAdjs.push({ accountId: '_all_costs_', type: 'percent', value: cv, appliesFrom: firstPeriod });
      updateScenario(clientId, { ...activeScenario, adjustments: [...sliderAdjs, ...baseAdjs] });
    }, 150);
  }, [activeScenario, clientId, firstPeriod, updateScenario]);

  const isBaselineActive = activeScenario?.isBaseline ?? true;

  return (
    <div className="flex flex-col gap-6">
      {/* Scenario selector pills */}
      {scenarios.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {scenarios.map((sc, idx) => {
            const color = SCENARIO_COLORS[idx % SCENARIO_COLORS.length]!;
            const isActive = sc.id === (activeScenario?.id ?? null);
            return (
              <button
                key={sc.id}
                onClick={() => setActiveScenario(sc.id)}
                className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
                style={{
                  borderColor: isActive ? color : 'hsl(var(--border))',
                  color: isActive ? color : 'hsl(var(--muted-foreground))',
                  background: isActive ? `${color.slice(0, -1)} / 0.08)`.replace('hsl(', 'hsl(') : 'transparent',
                }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                {sc.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Quick Sliders */}
      <div
        className="rounded-xl border p-4 flex flex-col gap-4"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      >
        <h3 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
          Quick Adjustments — {activeScenario?.name ?? 'No scenario'}
        </h3>
        {/* Revenue slider */}
        <div className="flex items-center gap-3">
          <span className="text-sm w-28 flex-shrink-0" style={{ color: 'hsl(var(--foreground))' }}>Revenue</span>
          <input
            type="range" min={-50} max={50} step={5}
            value={revSlider}
            disabled={isBaselineActive}
            onChange={e => { const v = Number(e.target.value); setRevSlider(v); persistSliders(v, costSlider); }}
            className="flex-1"
            style={{ accentColor: 'hsl(var(--primary))', opacity: isBaselineActive ? 0.4 : 1 }}
          />
          <span
            className="text-sm font-semibold w-12 text-right tabular-nums"
            style={{ color: revSlider > 0 ? 'hsl(142 71% 45%)' : revSlider < 0 ? 'hsl(0 84% 60%)' : 'hsl(var(--muted-foreground))' }}
          >
            {revSlider >= 0 ? '+' : ''}{revSlider}%
          </span>
        </div>
        {/* Cost slider */}
        <div className="flex items-center gap-3">
          <span className="text-sm w-28 flex-shrink-0" style={{ color: 'hsl(var(--foreground))' }}>Costs</span>
          <input
            type="range" min={-30} max={30} step={5}
            value={costSlider}
            disabled={isBaselineActive}
            onChange={e => { const v = Number(e.target.value); setCostSlider(v); persistSliders(revSlider, v); }}
            className="flex-1"
            style={{ accentColor: 'hsl(var(--primary))', opacity: isBaselineActive ? 0.4 : 1 }}
          />
          <span
            className="text-sm font-semibold w-12 text-right tabular-nums"
            style={{ color: costSlider > 0 ? 'hsl(0 84% 60%)' : costSlider < 0 ? 'hsl(142 71% 45%)' : 'hsl(var(--muted-foreground))' }}
          >
            {costSlider >= 0 ? '+' : ''}{costSlider}%
          </span>
        </div>
      </div>

      {/* Impact panel */}
      {impact && !isBaselineActive && (
        <div
          className="rounded-xl border p-4 flex flex-col gap-2"
          style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
        >
          <h3 className="text-sm font-semibold mb-1" style={{ color: 'hsl(var(--foreground))' }}>
            Impact vs Base Case
          </h3>
          {[{
            label: 'Revenue',
            base: impact.baseRevenue,
            scenario: impact.scenarioRevenue,
            delta: impact.revenueDelta,
          }, {
            label: 'Net Income',
            base: impact.baseNetIncome,
            scenario: impact.scenarioNetIncome,
            delta: impact.netIncomeDelta,
          }].map(row => (
            <div key={row.label} className="flex items-center justify-between text-sm">
              <span style={{ color: 'hsl(var(--muted-foreground))' }}>{row.label}</span>
              <div className="flex items-center gap-2">
                <span style={{ color: 'hsl(var(--muted-foreground))' }}>{formatCurrency(row.base)}</span>
                <span style={{ color: 'hsl(var(--muted-foreground))' }}>→</span>
                <span className="font-semibold" style={{ color: 'hsl(var(--foreground))' }}>{formatCurrency(row.scenario)}</span>
                <span style={{ color: row.delta >= 0 ? 'hsl(142 71% 45%)' : 'hsl(0 84% 60%)' }}>
                  {row.delta >= 0 ? '+' : ''}{formatCurrency(row.delta)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Link to full What-If page */}
      <div className="flex justify-end">
        <Link
          href={`/workspace/${clientId}/whatif`}
          className="text-sm font-medium underline underline-offset-2"
          style={{ color: 'hsl(var(--primary))' }}
        >
          View Full What-If →
        </Link>
      </div>
    </div>
  );
}

function WhatIfTab({ clientId }: { clientId: string }) {
  const workspace = useWorkspaceStore(s => s.workspaces.find(w => w.id === clientId));
  if (!workspace) return null;
  return <WhatIfTabContent clientId={clientId} />;
}

// ── Operational Tab ────────────────────────────────────────────────────────

function OperationalTabContent({ clientId }: { clientId: string }) {
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === clientId));
  const profile = workspace ? getProfile(workspace.industryProfileId) : null;

  const availablePeriods = useMemo(() => {
    if (!workspace) return [];
    const periods = getUniquePeriods(workspace.values);
    return [...periods].sort((a, b) => periodSortKey(b) - periodSortKey(a));
  }, [workspace?.values]); // eslint-disable-line react-hooks/exhaustive-deps

  const defaultPeriod = availablePeriods[0] ?? null;
  const [selectedPeriod, setSelectedPeriod] = useState<import('@/types').Period | null>(defaultPeriod);

  useEffect(() => {
    if (selectedPeriod === null && availablePeriods.length > 0) {
      setSelectedPeriod(availablePeriods[0] ?? null);
    }
  }, [availablePeriods.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const financialSummary = useMemo(() => {
    if (!workspace || !selectedPeriod) {
      return toFinancialSummary(
        computePnL(workspace?.accounts ?? [], workspace?.values ?? [], { year: 0, month: 0 }),
        undefined
      );
    }
    const pnl = computePnL(workspace.accounts, workspace.values, selectedPeriod);
    return toFinancialSummary(pnl, selectedPeriod);
  }, [workspace?.accounts, workspace?.values, selectedPeriod]); // eslint-disable-line react-hooks/exhaustive-deps

  const metricResults = useMemo(() => {
    if (!workspace || !profile || !selectedPeriod) return [];
    return computeMetricsForPeriod(
      profile.operationalMetrics,
      workspace.operationalData,
      financialSummary,
      selectedPeriod
    );
  }, [profile?.id, workspace?.operationalData, financialSummary, selectedPeriod]); // eslint-disable-line react-hooks/exhaustive-deps

  const metricsWithData = metricResults.filter((r) => r.value !== null).length;

  if (!workspace || !profile) return null;

  const noFinancialData = workspace.values.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Period selector + summary line */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PeriodSelector
          availablePeriods={availablePeriods}
          selectedPeriod={selectedPeriod}
          onChange={setSelectedPeriod}
          label="Period"
        />
        <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {metricResults.length} metrics · {metricsWithData} with data · Profile: {profile.name}
        </p>
      </div>

      {noFinancialData ? (
        <div
          className="rounded-xl border p-6 text-center"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Import financial data to see operational metrics.
          </p>
        </div>
      ) : (
        <MetricGrid
          results={metricResults}
          customMetrics={workspace.customMetrics}
          operationalData={workspace.operationalData}
          period={selectedPeriod}
        />
      )}

      <div className="flex justify-end">
        <Link
          href={`/workspace/${clientId}/operational`}
          className="text-sm font-medium underline underline-offset-2"
          style={{ color: 'hsl(var(--primary))' }}
        >
          View Full Operational Metrics →
        </Link>
      </div>
    </div>
  );
}

function OperationalTab({ clientId }: { clientId: string }) {
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === clientId));
  if (!workspace) return null;
  return <OperationalTabContent clientId={clientId} />;
}

// ── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ clientId: string }>;
}

export default function WorkspacePage({ params }: PageProps) {
  const { clientId } = use(params);
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === clientId));
  const batchUpdateAccountsOuter = useWorkspaceStore((s) => s.batchUpdateAccounts);
  const setValuesOuter = useWorkspaceStore((s) => s.setValues);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [hydrated, setHydrated] = useState(false);
  const tourHook = useTour();

  const clearWorkspaceData = useCallback((wsId: string) => {
    batchUpdateAccountsOuter(wsId, []);
    setValuesOuter(wsId, []);
  }, [batchUpdateAccountsOuter, setValuesOuter]);
  useEffect(() => {
    // If already hydrated (e.g. store was reused), skip waiting
    if (useWorkspaceStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useWorkspaceStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);

  // Show loading skeleton until Zustand localStorage hydration completes
  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'hsl(var(--background))' }}>
        <div className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'hsl(var(--primary))' }} />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'hsl(var(--background))' }}>
        <div className="text-center space-y-4">
          <p className="text-4xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>404</p>
          <p className="text-lg font-medium" style={{ color: 'hsl(var(--foreground))' }}>Workspace not found</p>
          <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
            No workspace with ID <code className="font-mono text-xs">{clientId}</code> exists.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-2"
            style={{ color: 'hsl(var(--primary))' }}
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const profile = ALL_PROFILES.find((p) => p.id === workspace.industryProfileId);
  const isMappingTab = activeTab === 'mapping';

  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--background))' }}>
      {tourHook.isOpen && (
        <TourOverlay
          steps={TOUR_STEPS}
          onComplete={tourHook.completeTour}
          onSkip={tourHook.skipTour}
          startAtStep={tourHook.startStep}
        />
      )}
      {/* Header */}
      <header
        className="border-b px-6 py-4"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      >
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm font-medium transition-colors"
              style={{ color: 'hsl(var(--muted-foreground))' }}
              data-testid="back-to-home"
            >
              ← Home
            </Link>
            <span style={{ color: 'hsl(var(--border))' }}>/</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg">{profile?.icon ?? '🏢'}</span>
                <h1 className="text-base font-bold" style={{ color: 'hsl(var(--foreground))' }}>
                  {workspace.name}
                </h1>
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {profile?.name} · {workspace.accounts.length} accounts · Created {new Date(workspace.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <HelpButton onOpen={() => tourHook.openTour(6)} />
            <div
              className="rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{
                borderColor: 'hsl(var(--border))',
                color: 'hsl(var(--muted-foreground))',
              }}
            >
              {workspace.scenarios.length} scenarios
            </div>
            <button
              type="button"
              data-testid="clear-data-btn"
              onClick={() => {
                if (window.confirm('Clear all imported data? Accounts and values will be removed. Scenarios are kept.')) {
                  clearWorkspaceData(clientId);
                }
              }}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-red-50"
              style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--destructive))' }}
            >
              Clear Data
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div
        className="border-b"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--background))' }}
      >
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex gap-0 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                data-testid={`tab-${tab.id}`}
                className="px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors"
                style={{
                  borderColor: activeTab === tab.id ? 'hsl(var(--primary))' : 'transparent',
                  color:
                    activeTab === tab.id
                      ? 'hsl(var(--primary))'
                      : 'hsl(var(--muted-foreground))',
                }}
              >
                {tab.label}
                {tab.phase && (
                  <span
                    className="ml-1.5 rounded px-1 py-0.5 text-xs"
                    style={{
                      background: 'hsl(var(--muted))',
                      color: 'hsl(var(--muted-foreground))',
                    }}
                  >
                    {tab.phase}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main
        className={isMappingTab ? 'px-6 py-6' : 'mx-auto max-w-6xl px-6 py-8'}
      >
        {activeTab === 'overview' && <OverviewTab clientId={clientId} />}
        {activeTab === 'mapping' && <MappingTab clientId={clientId} />}
        {activeTab === 'reports' && <ReportsTab clientId={clientId} />}
        {activeTab === 'projections' && <ProjectionsTab clientId={clientId} />}
        {activeTab === 'whatif' && <WhatIfTab clientId={clientId} />}
        {activeTab === 'operational' && <OperationalTab clientId={clientId} />}
      </main>
    </div>
  );
}
