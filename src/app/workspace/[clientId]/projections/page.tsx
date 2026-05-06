'use client';

import React, { use, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useWorkspaceStore } from '@/store/workspace-store';
import { getProfile } from '@/lib/profiles';
import { projectWorkspace } from '@/lib/projections/workspace-projections';
import type { WorkspaceProjectionOptions } from '@/lib/projections/workspace-projections';
import type { ProjectionModel, ClientWorkspace } from '@/types';
import {
  ProjectionChart,
  ProjectionControls,
  AnnualSummaryTable,
} from '@/components/projections';
import type { HorizonKey } from '@/components/projections/ProjectionControls';
import type { ProjectionChartDataPoint } from '@/components/projections/ProjectionChart';
import { periodLabel } from '@/lib/utils/period';
import { formatPercent } from '@/lib/utils/format';

const HORIZON_MONTHS: Record<HorizonKey, number> = {
  '12m': 12,
  '1y': 12,
  '3y': 36,
  '5y': 60,
  '10y': 120,
};

function abbreviateCurrency(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function MetricCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <div className="rounded-xl border p-4 flex flex-col gap-1"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
      <p className="text-xs font-medium uppercase tracking-wide"
        style={{ color: 'hsl(var(--muted-foreground))' }}>{label}</p>
      <p className="text-xl font-bold"
        style={{ color: accent ? 'hsl(217 91% 55%)' : 'hsl(var(--foreground))' }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{sub}</p>}
    </div>
  );
}

// ─── Inner component — all useMemo calls live here, no early returns ──────────

function ProjectionsContent({
  clientId,
  workspace,
}: {
  clientId: string;
  workspace: ClientWorkspace;
}) {
  const profile = getProfile(workspace.industryProfileId);

  const [model, setModel] = useState<ProjectionModel>(profile.defaultProjectionModel);
  const [horizon, setHorizon] = useState<HorizonKey>('12m');
  const [growthRateOverride, setGrowthRateOverride] = useState<number | null>(null);

  const horizonMonths = HORIZON_MONTHS[horizon];
  const uniqueMonths = new Set(workspace.values.map((v) => `${v.period.year}-${v.period.month}`)).size;
  const hasEnoughData = uniqueMonths >= 3;

  const projectionOptions: WorkspaceProjectionOptions = useMemo(() => ({
    model,
    horizonMonths,
    growthRateOverride: growthRateOverride ?? undefined,
  }), [model, horizonMonths, growthRateOverride]);

  const projectionResult = useMemo(() => {
    if (!hasEnoughData || workspace.accounts.length === 0) return null;
    return projectWorkspace(workspace.accounts, workspace.values, projectionOptions, profile.defaultProjectionModel);
  }, [workspace.accounts, workspace.values, projectionOptions, hasEnoughData, profile.defaultProjectionModel]);

  const useAnnualGranularity = horizonMonths > 24;

  const revenueChartData = useMemo((): ProjectionChartDataPoint[] => {
    if (!projectionResult) return [];
    if (useAnnualGranularity) {
      return projectionResult.annualSummary.map((row) => ({
        label: String(row.year),
        actual: row.isProjected ? undefined : row.revenue,
        projected: row.isProjected ? row.revenue : undefined,
        lower80: row.revenuePoint?.lower80,
        upper80: row.revenuePoint?.upper80,
        isProjected: row.isProjected,
      }));
    }
    return projectionResult.rolledUp.map((row) => ({
      label: periodLabel(row.period),
      actual: row.isProjected ? undefined : row.revenue,
      projected: row.isProjected ? row.revenue : undefined,
      lower80: row.revenueProjected?.lower80,
      upper80: row.revenueProjected?.upper80,
      isProjected: row.isProjected,
    }));
  }, [projectionResult, useAnnualGranularity]);

  const netIncomeChartData = useMemo((): ProjectionChartDataPoint[] => {
    if (!projectionResult) return [];
    if (useAnnualGranularity) {
      return projectionResult.annualSummary.map((row) => ({
        label: String(row.year),
        actual: row.isProjected ? undefined : row.netIncome,
        projected: row.isProjected ? row.netIncome : undefined,
        lower80: undefined,
        upper80: undefined,
        isProjected: row.isProjected,
      }));
    }
    return projectionResult.rolledUp.map((row) => ({
      label: periodLabel(row.period),
      actual: row.isProjected ? undefined : row.netIncome,
      projected: row.isProjected ? row.netIncome : undefined,
      lower80: row.netIncomeProjected?.lower80,
      upper80: row.netIncomeProjected?.upper80,
      isProjected: row.isProjected,
    }));
  }, [projectionResult, useAnnualGranularity]);

  const projectedRevenue12m = useMemo(() => {
    if (!projectionResult) return null;
    return projectionResult.rolledUp.filter((r) => r.isProjected).slice(0, 12).reduce((s, r) => s + r.revenue, 0);
  }, [projectionResult]);

  const projectedNetIncome12m = useMemo(() => {
    if (!projectionResult) return null;
    return projectionResult.rolledUp.filter((r) => r.isProjected).slice(0, 12).reduce((s, r) => s + r.netIncome, 0);
  }, [projectionResult]);

  const impliedGrowthRate = useMemo(() => {
    if (!projectionResult) return undefined;
    const historical = projectionResult.rolledUp.filter((r) => !r.isProjected);
    const projected = projectionResult.rolledUp.filter((r) => r.isProjected);
    if (!historical.length || !projected.length) return undefined;
    const lastHistRev = historical[historical.length - 1]!.revenue;
    const lastProjRev = projected[projected.length - 1]!.revenue;
    const months = projected.length;
    if (lastHistRev > 0 && months > 0) return Math.pow(lastProjRev / lastHistRev, 12 / months) - 1;
    return undefined;
  }, [projectionResult]);

  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--background))' }}>
      <header className="border-b px-6 py-4"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/workspace/${clientId}`}
              className="text-sm font-medium transition-colors"
              style={{ color: 'hsl(var(--muted-foreground))' }}>← Workspace</Link>
            <span style={{ color: 'hsl(var(--border))' }}>/</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg">{profile.icon ?? '🏢'}</span>
                <h1 className="text-base font-bold" style={{ color: 'hsl(var(--foreground))' }}>{workspace.name}</h1>
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Projections · {profile.name}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 flex flex-col gap-8">
        <div className="rounded-xl border p-4"
          style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
          <ProjectionControls
            model={model}
            onModelChange={setModel}
            horizon={horizon}
            onHorizonChange={setHorizon}
            growthRateOverride={growthRateOverride}
            onGrowthRateChange={setGrowthRateOverride}
            profileDefaultModel={profile.defaultProjectionModel}
            impliedGrowthRate={impliedGrowthRate}
          />
        </div>

        {!hasEnoughData ? (
          <div className="rounded-xl border p-10 text-center" style={{ borderColor: 'hsl(var(--border))' }}>
            <p className="text-base font-medium mb-1" style={{ color: 'hsl(var(--foreground))' }}>
              Not enough data to project
            </p>
            <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
              At least 3 months of financial data is required.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard label="Projected Revenue (12 mo)"
                value={projectedRevenue12m !== null ? abbreviateCurrency(projectedRevenue12m) : '—'}
                sub="Next 12 projected months" accent />
              <MetricCard label="Projected Net Income (12 mo)"
                value={projectedNetIncome12m !== null ? abbreviateCurrency(projectedNetIncome12m) : '—'}
                sub="Next 12 projected months"
                accent={(projectedNetIncome12m ?? 0) >= 0} />
              <MetricCard label="Implied Growth Rate"
                value={impliedGrowthRate !== undefined ? formatPercent(impliedGrowthRate) : '—'}
                sub={`Annualized · ${model} model`} />
            </div>

            <div className="rounded-xl border p-4"
              style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: 'hsl(var(--foreground))' }}>
                Revenue Projection
              </h2>
              <ProjectionChart data={revenueChartData} metric="revenue" height={360} />
            </div>

            <div className="rounded-xl border p-4"
              style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: 'hsl(var(--foreground))' }}>
                Net Income Projection
              </h2>
              <ProjectionChart data={netIncomeChartData} metric="netIncome" height={260} />
            </div>

            <div>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'hsl(var(--foreground))' }}>
                Annual Summary
              </h2>
              <AnnualSummaryTable annualSummary={projectionResult?.annualSummary ?? []} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ─── Outer shell — only hydration guard + workspace lookup ────────────────────

interface PageProps {
  params: Promise<{ clientId: string }>;
}

export default function ProjectionsPage({ params }: PageProps) {
  const { clientId } = use(params);
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === clientId));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (useWorkspaceStore.persist.hasHydrated()) { setHydrated(true); return; }
    const unsub = useWorkspaceStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'hsl(var(--background))' }}>
        <div className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'hsl(var(--primary))' }} />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'hsl(var(--background))' }}>
        <div className="text-center space-y-4">
          <p className="text-4xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>404</p>
          <p className="text-lg font-medium" style={{ color: 'hsl(var(--foreground))' }}>Workspace not found</p>
          <Link href="/"
            className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-2"
            style={{ color: 'hsl(var(--primary))' }}>← Back to Home</Link>
        </div>
      </div>
    );
  }

  return <ProjectionsContent clientId={clientId} workspace={workspace} />;
}
