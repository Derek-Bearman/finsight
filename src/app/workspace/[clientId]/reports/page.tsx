'use client';

import React, { use, useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useWorkspaceStore } from '@/store/workspace-store';
import {
  buildPeriodAggregations,
  computeBreakevenSeries,
  computeBalanceSheetSeries,
  computeEfficiencySeries,
  computeProfitabilitySeries,
  computeHealthSeries,
} from '@/lib/calculations';
import type { Granularity } from '@/lib/calculations/period-aggregation';
import type { Period } from '@/types';
import { periodLabel, quarterLabel } from '@/lib/utils/period';
import {
  PnLReport,
  BreakevenReport,
  RatiosReport,
  PeriodComparisonTable,
} from '@/components/reports';
import { getUniquePeriods } from '@/lib/calculations/period-aggregation';
import { ExecutiveSummary } from '@/components/insights/ExecutiveSummary';

// ── Types ──────────────────────────────────────────────────────────────────

type ReportTab = 'pnl' | 'breakeven' | 'ratios' | 'comparison';

interface PageProps {
  params: Promise<{ clientId: string }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getPeriodSelectLabel(p: Period, granularity: Granularity): string {
  switch (granularity) {
    case 'monthly':   return periodLabel(p);
    case 'quarterly': return quarterLabel(p);
    case 'annual':    return `FY${p.year}`;
    case 'ttm':       return 'TTM';
  }
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function ReportsPage({ params }: PageProps) {
  const { clientId } = use(params);
  const workspace = useWorkspaceStore(s => s.workspaces.find(w => w.id === clientId));
  const [hydrated, setHydrated] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>('annual');
  const [activeTab, setActiveTab] = useState<ReportTab>('pnl');

  // Comparison period selectors
  const [compPeriodAIdx, setCompPeriodAIdx] = useState(0);
  const [compPeriodBIdx, setCompPeriodBIdx] = useState(1);

  useEffect(() => {
    if (useWorkspaceStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useWorkspaceStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);

  // ── Compute all series ──────────────────────────────────────────────────
  const { aggregations, breakevenSeries, bsSeries, effSeries, profSeries, healthSeries } = useMemo(() => {
    if (!workspace || workspace.accounts.length === 0) {
      return {
        aggregations: [],
        breakevenSeries: [],
        bsSeries: [],
        effSeries: [],
        profSeries: [],
        healthSeries: [],
      };
    }
    return {
      aggregations: buildPeriodAggregations(workspace.accounts, workspace.values, granularity, workspace.fiscalYearStart),
      breakevenSeries: computeBreakevenSeries(workspace.accounts, workspace.values, granularity),
      bsSeries: computeBalanceSheetSeries(workspace.accounts, workspace.values, granularity),
      effSeries: computeEfficiencySeries(workspace.accounts, workspace.values, granularity),
      profSeries: computeProfitabilitySeries(workspace.accounts, workspace.values, granularity),
      healthSeries: computeHealthSeries(workspace.accounts, workspace.values, granularity),
    };
  }, [workspace?.accounts, workspace?.values, granularity]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Available periods for comparison
  const comparisonPeriods = useMemo(() => {
    if (!workspace) return [];
    return getUniquePeriods(workspace.values);
  }, [workspace?.values]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading / empty states ─────────────────────────────────────────────
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
          <Link href="/" className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-2" style={{ color: 'hsl(var(--primary))' }}>
            ← Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const hasData = workspace.accounts.length > 0 && workspace.values.length > 0;

  const periodA = comparisonPeriods[compPeriodAIdx] ?? comparisonPeriods[0];
  const periodB = comparisonPeriods[compPeriodBIdx] ?? comparisonPeriods[1];

  const GRANULARITIES: { id: Granularity; label: string }[] = [
    { id: 'monthly', label: 'Monthly' },
    { id: 'quarterly', label: 'Quarterly' },
    { id: 'annual', label: 'Annual' },
  ];

  const REPORT_TABS: { id: ReportTab; label: string }[] = [
    { id: 'pnl', label: 'P&L' },
    { id: 'breakeven', label: 'Breakeven' },
    { id: 'ratios', label: 'Ratios' },
    { id: 'comparison', label: 'Period Comparison' },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--background))' }}>
      {/* Header */}
      <header
        className="border-b px-6 py-4"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      >
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={`/workspace/${clientId}`}
              className="text-sm font-medium transition-colors"
              style={{ color: 'hsl(var(--muted-foreground))' }}
            >
              ← Workspace
            </Link>
            <span style={{ color: 'hsl(var(--border))' }}>/</span>
            <h1 className="text-base font-bold" style={{ color: 'hsl(var(--foreground))' }}>
              {workspace.name} — Reports
            </h1>
          </div>

          {/* PDF export (print) */}
          <button
            onClick={() => window.print()}
            className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
            style={{
              borderColor: 'hsl(var(--border))',
              color: 'hsl(var(--foreground))',
              background: 'hsl(var(--muted))',
            }}
          >
            Export PDF
          </button>
        </div>
      </header>

      {/* Controls */}
      <div
        className="border-b px-6 py-3"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      >
        <div className="mx-auto max-w-6xl flex items-center gap-6 flex-wrap">
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

          {/* Report sub-tabs */}
          <div className="flex gap-1">
            {REPORT_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                style={{
                  background: activeTab === t.id ? 'hsl(var(--primary))' : 'transparent',
                  color: activeTab === t.id ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                  borderColor: activeTab === t.id ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        {!hasData ? (
          <div
            className="rounded-xl border p-12 text-center"
            style={{ borderColor: 'hsl(var(--border))' }}
          >
            <p className="text-lg font-semibold mb-2" style={{ color: 'hsl(var(--foreground))' }}>
              No Financial Data
            </p>
            <p className="text-sm mb-4" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Import financial data to generate reports.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-2"
              style={{ color: 'hsl(var(--primary))' }}
            >
              Import data
            </Link>
          </div>
        ) : (
          <>
            {activeTab === 'pnl' && (
              <div className="flex flex-col gap-6">
                <ExecutiveSummary workspace={workspace} />
                <PnLReport aggregations={aggregations} granularity={granularity} />
              </div>
            )}

            {activeTab === 'breakeven' && (
              <BreakevenReport series={breakevenSeries} granularity={granularity} />
            )}

            {activeTab === 'ratios' && (
              <RatiosReport
                bsSeries={bsSeries}
                effSeries={effSeries}
                profSeries={profSeries}
                healthSeries={healthSeries}
                granularity={granularity}
              />
            )}

            {activeTab === 'comparison' && (
              <div>
                {/* Period selectors */}
                <div className="flex items-center gap-4 mb-6 flex-wrap">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                      Period A:
                    </label>
                    <select
                      value={compPeriodAIdx}
                      onChange={e => setCompPeriodAIdx(Number(e.target.value))}
                      className="rounded-lg border px-3 py-1.5 text-sm"
                      style={{
                        borderColor: 'hsl(var(--border))',
                        background: 'hsl(var(--card))',
                        color: 'hsl(var(--foreground))',
                      }}
                    >
                      {comparisonPeriods.map((p, i) => (
                        <option key={i} value={i}>
                          {periodLabel(p)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                      Period B:
                    </label>
                    <select
                      value={compPeriodBIdx}
                      onChange={e => setCompPeriodBIdx(Number(e.target.value))}
                      className="rounded-lg border px-3 py-1.5 text-sm"
                      style={{
                        borderColor: 'hsl(var(--border))',
                        background: 'hsl(var(--card))',
                        color: 'hsl(var(--foreground))',
                      }}
                    >
                      {comparisonPeriods.map((p, i) => (
                        <option key={i} value={i}>
                          {periodLabel(p)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {periodA && periodB ? (
                  <PeriodComparisonTable
                    accounts={workspace.accounts}
                    values={workspace.values}
                    periodA={periodA}
                    periodB={periodB}
                    labelA={periodLabel(periodA)}
                    labelB={periodLabel(periodB)}
                  />
                ) : (
                  <div className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    Select two periods to compare.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
