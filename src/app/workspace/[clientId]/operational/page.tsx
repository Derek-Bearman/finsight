'use client';

import { use, useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useWorkspaceStore } from '@/store/workspace-store';
import { getProfile } from '@/lib/profiles';
import { computePnL, toFinancialSummary } from '@/lib/calculations/pnl';
import { getUniquePeriods } from '@/lib/calculations/period-aggregation';
import { computeMetricsForPeriod } from '@/lib/operational';
import { periodLabel, periodSortKey } from '@/lib/utils/period';
import {
  PeriodSelector,
  MetricGrid,
  DataEntryForm,
  CustomMetricBuilder,
  FunnelChart,
} from '@/components/operational';
import type { DataEntrySave } from '@/components/operational';
import { ReadOnlyGuard } from '@/components/app/ReadOnlyGuard';
import type { ClientWorkspace, Period, CustomMetricDef } from '@/types';

// ── Inner content — all hooks here ─────────────────────────────────────────

interface OperationalContentProps {
  clientId: string;
  workspace: ClientWorkspace;
}

function OperationalContent({ clientId, workspace }: OperationalContentProps) {
  const upsertOperationalDataPoint = useWorkspaceStore((s) => s.upsertOperationalDataPoint);
  const upsertOperationalInputs = useWorkspaceStore((s) => s.upsertOperationalInputs);
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);

  const profile = getProfile(workspace.industryProfileId);

  // ── Available periods from financial data ─────────────────────────────────
  const availablePeriods = useMemo(() => {
    const periods = getUniquePeriods(workspace.values);
    return [...periods].sort((a, b) => periodSortKey(b) - periodSortKey(a));
  }, [workspace.values]);

  // ── Selected period — default to most recent ──────────────────────────────
  const defaultPeriod = availablePeriods[0] ?? null;
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(defaultPeriod);

  // Keep selectedPeriod in sync if workspace data changes (e.g., initial load)
  useEffect(() => {
    if (selectedPeriod === null && availablePeriods.length > 0) {
      setSelectedPeriod(availablePeriods[0] ?? null);
    }
  }, [availablePeriods.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const [showDataEntry, setShowDataEntry] = useState(false);
  const [showCustomBuilder, setShowCustomBuilder] = useState(false);

  // ── Financial summary for selected period ────────────────────────────────
  const financialSummary = useMemo(() => {
    if (!selectedPeriod) {
      return toFinancialSummary(
        computePnL(workspace.accounts, workspace.values, { year: 0, month: 0 }),
        undefined
      );
    }
    const pnl = computePnL(workspace.accounts, workspace.values, selectedPeriod);
    return toFinancialSummary(pnl, selectedPeriod);
  }, [workspace.accounts, workspace.values, selectedPeriod]);

  // ── Compute metric results ────────────────────────────────────────────────
  const metricResults = useMemo(() => {
    if (!selectedPeriod) return [];
    return computeMetricsForPeriod(
      profile.operationalMetrics,
      workspace.operationalData,
      financialSummary,
      selectedPeriod,
      workspace.operationalInputs
    );
  }, [
    profile.operationalMetrics,
    workspace.operationalData,
    workspace.operationalInputs,
    financialSummary,
    selectedPeriod,
  ]);

  // ── Summary bar stats ─────────────────────────────────────────────────────
  const metricsWithData = metricResults.filter((r) => r.value !== null).length;
  const totalMetrics = metricResults.length;

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSaveData = useCallback(
    ({ pool, points }: DataEntrySave) => {
      upsertOperationalInputs(clientId, pool);
      // Legacy fan-out keeps per-metric consumers + older workspaces coherent.
      for (const point of points) {
        upsertOperationalDataPoint(clientId, point);
      }
      setShowDataEntry(false);
    },
    [clientId, upsertOperationalDataPoint, upsertOperationalInputs]
  );

  const handleAddCustomMetric = useCallback(
    (metric: CustomMetricDef) => {
      const updated: CustomMetricDef[] = [...workspace.customMetrics, metric];
      updateWorkspace(clientId, { customMetrics: updated });
      setShowCustomBuilder(false);
    },
    [clientId, workspace.customMetrics, updateWorkspace]
  );

  const noFinancialData = workspace.values.length === 0;

  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--background))' }}>
      {/* Header */}
      <header
        className="border-b px-6 py-4"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      >
        <div className="mx-auto max-w-6xl flex items-center gap-3">
          <Link
            href={`/workspace/${clientId}`}
            className="text-sm font-medium transition-colors"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            ← Workspace
          </Link>
          <span style={{ color: 'hsl(var(--border))' }}>/</span>
          <span className="text-sm font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {workspace.name}
          </span>
          <span style={{ color: 'hsl(var(--border))' }}>/</span>
          <h1 className="text-base font-bold" style={{ color: 'hsl(var(--foreground))' }}>
            Operational Metrics
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 flex flex-col gap-6">
        <ReadOnlyGuard>
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <PeriodSelector
            availablePeriods={availablePeriods}
            selectedPeriod={selectedPeriod}
            onChange={setSelectedPeriod}
            label="Period"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCustomBuilder(true)}
              disabled={showCustomBuilder}
              className="px-3 py-1.5 rounded-lg border text-sm font-medium"
              style={{
                borderColor: 'hsl(var(--border))',
                color: 'hsl(var(--foreground))',
                background: 'hsl(var(--card))',
              }}
            >
              + Add Custom Metric
            </button>
            <button
              onClick={() => setShowDataEntry(true)}
              disabled={showDataEntry || !selectedPeriod || noFinancialData}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={{
                background: 'hsl(var(--primary))',
                color: 'hsl(var(--primary-foreground))',
                opacity: !selectedPeriod || noFinancialData ? 0.5 : 1,
              }}
            >
              Enter Data
            </button>
          </div>
        </div>

        {/* Profile banner */}
        <div
          className="rounded-xl border px-5 py-4 flex items-center justify-between gap-4"
          style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">
              {profile.icon ?? '🏢'}
            </span>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                {profile.name} metrics
                <span
                  className="ml-2 font-normal text-xs"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  {profile.operationalMetrics.length} metrics defined
                </span>
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {profile.description}
              </p>
            </div>
          </div>
        </div>

        {/* No financial data warning */}
        {noFinancialData && (
          <div
            className="rounded-xl border p-5 text-center"
            style={{ borderColor: 'hsl(var(--border))' }}
          >
            <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Import financial data to see metrics.
            </p>
            <Link
              href="/"
              className="inline-flex mt-2 text-sm font-medium underline underline-offset-2"
              style={{ color: 'hsl(var(--primary))' }}
            >
              Import data
            </Link>
          </div>
        )}

        {/* Summary progress bar */}
        {!noFinancialData && selectedPeriod && totalMetrics > 0 && (
          <div
            className="rounded-xl border px-5 py-4 flex flex-col gap-2"
            style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                {metricsWithData} of {totalMetrics} metrics have data for{' '}
                <span className="font-semibold">{periodLabel(selectedPeriod)}</span>
              </p>
              <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {totalMetrics > 0
                  ? Math.round((metricsWithData / totalMetrics) * 100)
                  : 0}
                % complete
              </span>
            </div>
            <div
              className="rounded-full h-2"
              style={{ background: 'hsl(var(--muted))' }}
            >
              <div
                className="rounded-full h-2 transition-all"
                style={{
                  width: `${totalMetrics > 0 ? (metricsWithData / totalMetrics) * 100 : 0}%`,
                  background:
                    metricsWithData === totalMetrics
                      ? 'hsl(142 71% 45%)'
                      : 'hsl(var(--primary))',
                }}
              />
            </div>
          </div>
        )}

        {/* Data entry form (inline) */}
        {showDataEntry && selectedPeriod && (
          <DataEntryForm
            metricDefs={profile.operationalMetrics}
            existingData={workspace.operationalData}
            existingPools={workspace.operationalInputs}
            period={selectedPeriod}
            onSave={handleSaveData}
            onCancel={() => setShowDataEntry(false)}
          />
        )}

        {/* Marketing funnel visualization (renders once funnel data exists) */}
        {!noFinancialData && selectedPeriod && (
          <FunnelChart
            pools={workspace.operationalInputs ?? []}
            period={selectedPeriod}
            marketingSpendFromPnL={financialSummary.marketingSpend}
          />
        )}

        {/* Custom metric builder */}
        {showCustomBuilder && (
          <CustomMetricBuilder
            profileId={profile.id}
            onAdd={handleAddCustomMetric}
            onClose={() => setShowCustomBuilder(false)}
          />
        )}

        {/* Metric grid */}
        {!noFinancialData && (
          <MetricGrid
            results={metricResults}
            customMetrics={workspace.customMetrics}
            operationalData={workspace.operationalData}
            period={selectedPeriod}
          />
        )}
        </ReadOnlyGuard>
      </main>
    </div>
  );
}

// ── Outer shell — hydration guard + null check ──────────────────────────────

interface PageProps {
  params: Promise<{ clientId: string }>;
}

export default function OperationalPage({ params }: PageProps) {
  const { clientId } = use(params);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (useWorkspaceStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useWorkspaceStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);

  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === clientId));

  if (!hydrated) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'hsl(var(--background))' }}
      >
        <div
          className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'hsl(var(--primary))' }}
        />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'hsl(var(--background))' }}
      >
        <div className="text-center space-y-4">
          <p className="text-4xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
            404
          </p>
          <p className="text-lg font-medium" style={{ color: 'hsl(var(--foreground))' }}>
            Workspace not found
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

  return <OperationalContent clientId={clientId} workspace={workspace} />;
}
