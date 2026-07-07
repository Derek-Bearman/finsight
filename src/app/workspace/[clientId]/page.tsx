'use client';

import React, { use, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { TourOverlay, useTour, HelpButton, WORKSPACE_TOUR_STEPS } from '@/components/tutorial';
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
import { computeMetricsForPeriod, getBenchmarkStatus } from '@/lib/operational';
import { PeriodSelector, MetricGrid, FunnelChart } from '@/components/operational';
import {
  MappingToolbar,
  MappingViewA,
  MappingViewB,
  computeSourceCounts,
} from '@/components/mapping';
import type { SourceFilter } from '@/components/mapping';
import { downloadWorkspaceJSON } from '@/lib/utils/workspace-io';
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
import type { Account, AccountType, AccountValue, AuditEntry, MappingMemoryEntry, BenchmarkRange, StatementType } from '@/types';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ProfileIcon } from '@/components/ui/profile-icon';
import { useFirmContext, useReadOnly } from '@/components/app/firm-context';
import { ReadOnlyGuard } from '@/components/app/ReadOnlyGuard';
import { AppNav } from '@/components/app/AppNav';
import { BillingBanner } from '@/components/billing/BillingBanner';
import { ExecutiveSummary } from '@/components/insights/ExecutiveSummary';
import { TargetsEditor } from '@/components/app/TargetsEditor';
import { RATIO_DEF_MAP, resolveRatioBenchmark, type RatioKey } from '@/lib/targets';

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
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
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

  /** See mirror in /workspace/[clientId]/mapping/page.tsx for the same logic */
  const inferStatementType = useCallback((accounts: Account[]): StatementType | undefined => {
    const pnlTypes: AccountType[] = ['revenue', 'cogs', 'expense'];
    const bsTypes: AccountType[] = ['asset', 'liability', 'equity'];
    let pnlCount = 0;
    let bsCount = 0;
    for (const a of accounts) {
      if (pnlTypes.includes(a.type)) pnlCount++;
      else if (bsTypes.includes(a.type)) bsCount++;
    }
    if (pnlCount > 0 && bsCount === 0) return 'pnl';
    if (bsCount > 0 && pnlCount === 0) return 'balance_sheet';
    return undefined;
  }, []);

  const handleRefreshAuto = useCallback(() => {
    if (!workspace) return;
    const profile = getProfile(workspace.industryProfileId);
    const statementType = inferStatementType(workspace.accounts);
    const inputs = workspace.accounts.map((a) => {
      const ci: { id: string; name: string; number?: string; section?: AccountType } = { id: a.id, name: a.name };
      if (a.number !== undefined) ci.number = a.number;
      if (a.detectedSection !== undefined) ci.section = a.detectedSection;
      return ci;
    });
    const results = classifyAll(inputs, profile, statementType);

    let refreshed = 0;
    const updatedAccounts = workspace.accounts.map((account) => {
      if (account.isManuallyClassified) return account;
      const result = results.get(account.id);
      if (!result) return account;
      const newAccount = applyClassification(account, result);
      if (
        newAccount.type !== account.type ||
        newAccount.costBehavior !== account.costBehavior ||
        newAccount.classificationConfidence !== account.classificationConfidence
      ) {
        refreshed++;
      }
      return newAccount;
    });

    if (refreshed === 0) {
      showToast('All auto-classified accounts already up to date');
      return;
    }

    const refreshEntry: AuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date().toISOString(),
      accountId: 'batch',
      accountName: `${refreshed} auto-classified accounts`,
      action: 'reset_to_auto',
      previousValue: 'stale',
      newValue: 'refreshed',
      performedBy: 'user',
    };

    batchUpdateAccounts(clientId, updatedAccounts);
    appendAuditEntry(clientId, refreshEntry);
    showToast(`${refreshed} account${refreshed !== 1 ? 's' : ''} refreshed (manual overrides preserved)`);
  }, [workspace, clientId, batchUpdateAccounts, appendAuditEntry, inferStatementType]);

  const handleReset = useCallback(() => {
    if (!workspace) return;
    const profile = getProfile(workspace.industryProfileId);
    const statementType = inferStatementType(workspace.accounts);
    const inputs = workspace.accounts.map((a) => {
      const ci: { id: string; name: string; number?: string; section?: AccountType } = { id: a.id, name: a.name };
      if (a.number !== undefined) ci.number = a.number;
      if (a.detectedSection !== undefined) ci.section = a.detectedSection;
      return ci;
    });
    const results = classifyAll(inputs, profile, statementType);
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
  }, [workspace, clientId, batchUpdateAccounts, appendAuditEntry, inferStatementType]);

  if (!workspace) return null;

  const manualCount = workspace.accounts.filter((a) => a.isManuallyClassified).length;
  const sourceCounts = computeSourceCounts(workspace.accounts);

  return (
    <div className="flex flex-col gap-4 relative">
      <MappingToolbar
        view={view}
        onViewChange={setView}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onReset={handleReset}
        onRefreshAuto={handleRefreshAuto}
        totalAccounts={workspace.accounts.length}
        manualCount={manualCount}
        auditEntries={workspace.auditLog}
        sourceFilter={sourceFilter}
        onSourceFilterChange={setSourceFilter}
        sourceCounts={sourceCounts}
      />

      {view === 'type' ? (
        <MappingViewA
          workspace={workspace}
          onAccountsChange={handleAccountsChange}
          onAuditEntry={handleAuditEntry}
          onRememberMapping={handleRememberMapping}
          searchQuery={searchQuery}
          sourceFilter={sourceFilter}
        />
      ) : (
        <MappingViewB
          workspace={workspace}
          onAccountsChange={handleAccountsChange}
          onAuditEntry={handleAuditEntry}
          onRememberMapping={handleRememberMapping}
          searchQuery={searchQuery}
          sourceFilter={sourceFilter}
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
            No financial data yet — import a P&amp;L with at least 3 months of history to run projections.
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
          <p className="mt-2 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Solid line = actuals · dashed = projection · shaded band = 80% confidence range. Forecast uses the {model} model — switch models above to compare.
          </p>
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
  sub,
}: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
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
      {sub && (
        <p className="text-xs leading-snug" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {sub}
        </p>
      )}
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

/** Reports-tab ratio card with target/provenance awareness. */
function reportRatioCard(
  key: RatioKey,
  value: number | null,
  targets: import('@/types').WorkspaceTargets | undefined
): { label: string; value: string; color?: string; sub: string } {
  const def = RATIO_DEF_MAP[key]!;
  const resolved = resolveRatioBenchmark(key, targets);
  const status = getBenchmarkStatus(value, resolved.benchmark);
  return {
    label: def.label,
    value: value != null ? formatMetricValue(value, def.format) : '—',
    color: value != null ? status.color : undefined,
    sub: resolved.targetText
      ? `${resolved.targetText} · ${resolved.provenance === 'corporate' ? 'Corporate' : 'Custom'}`
      : 'FinSight default benchmark',
  };
}

function ReportsTab({
  clientId,
  granularity,
  onGranularityChange,
}: {
  clientId: string;
  granularity: Granularity;
  onGranularityChange: (g: Granularity) => void;
}) {
  const workspace = useWorkspaceStore(s => s.workspaces.find(w => w.id === clientId));
  const setGranularity = onGranularityChange;

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
            No financial data yet — import a P&amp;L or balance sheet to see reports.
          </p>
        </div>
      ) : (
        <>
          {/* Plain-English read first */}
          <ExecutiveSummary workspace={workspace} />

          {/* P&L Table */}
          <PnLReport aggregations={aggregations} granularity={granularity} />

          {/* Key Ratios summary cards */}
          {(latestBS || latestProf || latestHealth || latestAgg) && (
            <div>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'hsl(var(--foreground))' }}>
                Key Ratios (Latest Period)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <RatioCard {...reportRatioCard('gross_margin', latestAgg?.grossMarginPct ?? null, workspace.targets)} />
                <RatioCard {...reportRatioCard('net_margin', latestAgg?.netMarginPct ?? null, workspace.targets)} />
                <RatioCard {...reportRatioCard('current_ratio', latestBS?.currentRatio ?? null, workspace.targets)} />
                <RatioCard {...reportRatioCard('debt_to_equity', latestBS?.debtToEquity ?? null, workspace.targets)} />
                <RatioCard {...reportRatioCard('roe', latestProf?.roe ?? null, workspace.targets)} />
                <RatioCard
                  label="Altman Z''"
                  value={zScoreZoneLabel(latestHealth?.altmanZScore ?? null)}
                  color={zScoreZoneColor(latestHealth?.altmanZScore ?? null)}
                  sub={resolveRatioBenchmark('altman_z', workspace.targets).targetText ?? 'FinSight default benchmark'}
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

// Ratio benchmarks now come from the lib/targets registry, resolved per
// workspace so client targets (corporate mandates) override the defaults.

function OverviewTab({
  clientId,
  granularity,
  onGranularityChange,
}: {
  clientId: string;
  granularity: Granularity;
  onGranularityChange: (g: Granularity) => void;
}) {
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === clientId));

  const availableYears = useMemo(
    () => (workspace ? getAvailableYears(workspace.values) : []),
    [workspace?.values] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const defaultYear = availableYears[0] ?? null;
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const setGranularity = onGranularityChange;

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

    const card = (
      key: RatioKey,
      value: number | null,
      trend: number[]
    ): RatioSparklineProps => {
      const def = RATIO_DEF_MAP[key]!;
      const resolved = resolveRatioBenchmark(key, workspace?.targets);
      return {
        label: def.label,
        value,
        format: def.format,
        trend,
        benchmark: resolved.benchmark,
        targetText: resolved.targetText,
        provenance: resolved.provenance,
        explainer: def.explainer,
      };
    };

    return [
      card('gross_margin', latestAgg?.grossMarginPct ?? null, aggs.map((a) => a.grossMarginPct)),
      card('net_margin', latestAgg?.netMarginPct ?? null, aggs.map((a) => a.netMarginPct)),
      card('current_ratio', latestBS?.currentRatio ?? null, bsSlice.map((b) => b.currentRatio ?? 0)),
      card('debt_to_equity', latestBS?.debtToEquity ?? null, bsSlice.map((b) => b.debtToEquity ?? 0)),
      card('contribution_margin', latestAgg?.contributionMarginPct ?? null, aggs.map((a) => a.contributionMarginPct)),
      card('altman_z', latestHealth?.altmanZScore ?? null, healthSlice.map((h) => h.altmanZScore ?? 0)),
    ];
  }, [periodAggs, bsSeries, healthSeries, workspace?.targets]);

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

      {/* Section 1.5: Executive summary — the plain-English read first */}
      {hasData && <ExecutiveSummary workspace={workspace} />}

      {/* Section 2: KPI Cards */}
      {!hasData ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
            No financial data yet — import a P&amp;L or balance sheet to see summary metrics.
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
  const readOnly = useReadOnly();

  // Initialize default scenarios on first mount (skipped while read-only —
  // the seed mutation could never persist and would dirty the sync state)
  useEffect(() => {
    if (readOnly) return;
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
        <p className="text-xs -mt-2" style={{ color: 'hsl(var(--muted-foreground))' }}>
          Drag a slider to model a % change against this client&apos;s actuals. The dollar impact updates below. (Pick a non-baseline scenario to enable.)
        </p>
        {/* Revenue slider */}
        <div className="flex items-center gap-3">
          <span className="text-sm w-28 flex-shrink-0" style={{ color: 'hsl(var(--foreground))' }}>
            Revenue
            <span className="block text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>% change</span>
          </span>
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
          <span className="text-sm w-28 flex-shrink-0" style={{ color: 'hsl(var(--foreground))' }}>
            Costs
            <span className="block text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>% change</span>
          </span>
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
          <h3 className="text-sm font-semibold mb-0.5" style={{ color: 'hsl(var(--foreground))' }}>
            Impact vs Base Case
          </h3>
          <p className="text-xs mb-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Projected annual figures under this scenario vs the client&apos;s actual baseline. Green = improvement.
          </p>
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
  // Sliders without data produce no result and look broken. Show an empty
  // state instead until accounts + values exist.
  if (workspace.accounts.length === 0 || workspace.values.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center">
        <h2 className="text-lg font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
          What-If scenarios need data
        </h2>
        <p className="mt-2 text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
          Import a P&amp;L or balance sheet to model revenue/cost changes against your actuals. Sliders will activate once accounts are loaded.
        </p>
      </div>
    );
  }
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
      selectedPeriod,
      workspace.operationalInputs,
      workspace.targets?.metrics
    );
  }, [profile?.id, workspace?.operationalData, workspace?.operationalInputs, workspace?.targets, financialSummary, selectedPeriod]); // eslint-disable-line react-hooks/exhaustive-deps

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
          {noFinancialData
            ? `${profile.name} profile · operational metrics will appear once data is imported`
            : `${metricsWithData} of ${metricResults.length} ${profile.name} metrics have data this period`}
        </p>
      </div>

      {noFinancialData ? (
        <div
          className="rounded-xl border p-6 text-center"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
            No financial data yet — import a P&amp;L or balance sheet to see operational metrics.
          </p>
        </div>
      ) : (
        <>
          {selectedPeriod && (
            <FunnelChart
              pools={workspace.operationalInputs ?? []}
              period={selectedPeriod}
              marketingSpendFromPnL={financialSummary.marketingSpend}
            />
          )}
          <MetricGrid
            results={metricResults}
            customMetrics={workspace.customMetrics}
            operationalData={workspace.operationalData}
            period={selectedPeriod}
          />
        </>
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
  const updateWorkspaceOuter = useWorkspaceStore((s) => s.updateWorkspace);
  const cloudMode = useWorkspaceStore((s) => s.cloudMode);
  const cloudHydrated = useWorkspaceStore((s) => s.cloudHydrated);
  const firm = useFirmContext();
  const readOnly = firm?.readOnly ?? false;
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [hydrated, setHydrated] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showTargets, setShowTargets] = useState(false);
  const [headerToast, setHeaderToast] = useState<string | null>(null);
  // Shared period granularity across Overview + Reports so switching tabs
  // doesn't silently reset the period a user is reviewing.
  const [sharedGranularity, setSharedGranularity] = useState<Granularity>('monthly');
  const tourHook = useTour();

  const showHeaderToast = useCallback((msg: string) => {
    setHeaderToast(msg);
    setTimeout(() => setHeaderToast(null), 3000);
  }, []);

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

  // Wait for the store to be ready. In cloud (firm) mode the app gate hydrates
  // the store from Postgres; fall back to the localStorage-persist signal for
  // any non-cloud path.
  const ready = cloudMode ? cloudHydrated : hydrated;

  // Show loading skeleton until hydration completes
  if (!ready) {
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
          steps={WORKSPACE_TOUR_STEPS}
          onComplete={tourHook.completeTour}
          onSkip={tourHook.skipTour}
          startAtStep={tourHook.startStep}
          tourLabel="Workspace tour"
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
              <div className="flex items-center gap-2" style={{ color: 'hsl(var(--foreground))' }}>
                <ProfileIcon profileId={profile?.id} size={20} />
                <h1 className="text-base font-bold">
                  {workspace.name}
                </h1>
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {profile?.name} · {workspace.accounts.length} accounts · Created {new Date(workspace.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <AppNav />
            <HelpButton onOpen={() => tourHook.openTour(0)} />
            {/* Scenarios count — informational badge, intentionally non-button styling */}
            <span
              className="inline-flex items-center gap-1 px-2 py-1 text-xs"
              style={{ color: 'hsl(var(--muted-foreground))' }}
              aria-label={`${workspace.scenarios.length} scenarios configured`}
            >
              <span style={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}>
                {workspace.scenarios.length}
              </span>
              <span>scenarios</span>
            </span>
            <button
              type="button"
              data-testid="targets-btn"
              disabled={readOnly}
              onClick={() => setShowTargets(true)}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
              title={
                readOnly
                  ? 'Read-only while billing is resolved'
                  : "Set this client's corporate or custom KPI targets — they override FinSight's default benchmarks everywhere."
              }
            >
              ⌖ Targets
            </button>
            <button
              type="button"
              data-testid="export-pdf-btn"
              onClick={() => {
                // Opens a new tab on the dedicated print route; that page
                // auto-fires window.print() after Recharts settles.
                window.open(`/workspace/${clientId}/print`, '_blank', 'noopener');
              }}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
              style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
              title="Open a print-ready client report — use the browser's Save as PDF in the print dialog."
            >
              ↓ PDF
            </button>
            <button
              type="button"
              data-testid="export-workspace-btn"
              disabled={workspace.accounts.length === 0}
              onClick={() => {
                downloadWorkspaceJSON(workspace);
                showHeaderToast('Workspace exported as .finsight.json');
              }}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
              title={
                workspace.accounts.length === 0
                  ? 'Import accounts before exporting'
                  : 'Download this workspace as a .finsight.json file you can re-import on another machine'
              }
            >
              ↓ JSON
            </button>
            <button
              type="button"
              data-testid="clear-data-btn"
              disabled={readOnly}
              onClick={() => setShowClearConfirm(true)}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--destructive))' }}
              title={readOnly ? 'Read-only while billing is resolved' : undefined}
            >
              Clear Data
            </button>
          </div>
        </div>
      </header>

      {firm?.access.banner && (
        <div className="mx-auto max-w-6xl px-6 pt-4">
          <BillingBanner
            decision={firm.access}
            onManageBilling={() => window.location.assign('/billing')}
          />
        </div>
      )}

      {/* Targets editor */}
      <TargetsEditor
        workspace={workspace}
        open={showTargets}
        onOpenChange={setShowTargets}
        onSave={(targets) => {
          updateWorkspaceOuter(clientId, { targets });
          showHeaderToast('Client targets saved');
        }}
      />

      {/* Clear Data confirmation */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all imported data?</DialogTitle>
            <DialogDescription>
              All accounts and values for <strong>{workspace.name}</strong>
              {' '}will be removed. Your scenarios (Base, Best, Worst) are kept so you can re-import
              data later. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearConfirm(false)} data-testid="clear-data-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="clear-data-confirm"
              onClick={() => {
                clearWorkspaceData(clientId);
                setShowClearConfirm(false);
                showHeaderToast('Imported data cleared');
              }}
            >
              Clear data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Header-scoped toast (Export, Clear) — sits above tab content */}
      {headerToast && (
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
          ✓ {headerToast}
        </div>
      )}

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
        {activeTab === 'overview' && (
          <OverviewTab
            clientId={clientId}
            granularity={sharedGranularity}
            onGranularityChange={setSharedGranularity}
          />
        )}
        {activeTab === 'mapping' && (
          <ReadOnlyGuard>
            <MappingTab clientId={clientId} />
          </ReadOnlyGuard>
        )}
        {activeTab === 'reports' && (
          <ReportsTab
            clientId={clientId}
            granularity={sharedGranularity}
            onGranularityChange={setSharedGranularity}
          />
        )}
        {activeTab === 'projections' && <ProjectionsTab clientId={clientId} />}
        {activeTab === 'whatif' && (
          <ReadOnlyGuard>
            <WhatIfTab clientId={clientId} />
          </ReadOnlyGuard>
        )}
        {activeTab === 'operational' && (
          <ReadOnlyGuard>
            <OperationalTab clientId={clientId} />
          </ReadOnlyGuard>
        )}
      </main>
    </div>
  );
}
