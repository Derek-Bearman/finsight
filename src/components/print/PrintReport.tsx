'use client';

/**
 * PrintReport — full client report rendered as one long scroll, designed to
 * print to PDF via the browser's print dialog (Cmd/Ctrl-P → Save as PDF).
 *
 * Sections (each one skips gracefully if its data isn't available):
 *   1. Cover         — client name, profile, generation date
 *   2. Exec Summary  — 5 latest-year KPIs
 *   3. P&L           — income statement table (PnLReport)
 *   4. Key Ratios    — current-period financial ratios table
 *   5. Projection    — 12-month forward revenue chart
 *   6. Operational   — industry-profile-specific MetricGrid
 *
 * Page breaks are CSS-driven (.page-break-before) so the browser handles
 * pagination during the print render.
 */

import React, { useEffect } from 'react';
import type { ClientWorkspace, Period, WorkspaceTargets } from '@/types';
import { ALL_PROFILES, getProfile } from '@/lib/profiles';
import { ProfileIcon } from '@/components/ui/profile-icon';
import { buildPeriodAggregations, computeBalanceSheetRatios } from '@/lib/calculations';
import { computePnL, toFinancialSummary } from '@/lib/calculations/pnl';
import { PnLReport } from '@/components/reports';
import { projectWorkspace } from '@/lib/projections/workspace-projections';
import type { ProjectionChartDataPoint } from '@/components/projections/ProjectionChart';
import { ProjectionChart } from '@/components/projections';
import { MetricGrid } from '@/components/operational';
import { computeMetricsForPeriod } from '@/lib/operational';
import { getUniquePeriods } from '@/lib/calculations/period-aggregation';
import { formatCurrency, formatPercent, formatRatio } from '@/lib/utils/format';
import { buildExecutiveSummary } from '@/lib/insights/executive-summary';
import {
  PROVENANCE_LABELS,
  RATIO_DEF_MAP,
  resolveRatioBenchmark,
  meetsTarget,
  type RatioKey,
} from '@/lib/targets';
import { useEffectiveTargets } from '@/lib/franchise/useEffectiveTargets';
import { INDUSTRY_BENCHMARK_DISCLAIMER } from '@/lib/benchmarks/packs';

interface PrintReportProps {
  workspace: ClientWorkspace;
  /**
   * Fired once the franchise benchmark data behind useEffectiveTargets has
   * loaded (immediately for workspaces where none applies). The print page
   * uses it to hold auto-print until the corporate tier is in the render.
   */
  onBenchmarksReady?: () => void;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function periodLabel(p: Period): string {
  return `${MONTH_NAMES[p.month - 1]} ${p.year}`;
}

// ─────────────────────────────────────────────
// Cover
// ─────────────────────────────────────────────

function CoverSection({ workspace, profileName }: { workspace: ClientWorkspace; profileName: string }) {
  const today = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return (
    <section className="avoid-break" style={{ minHeight: '8in', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div style={{ borderTop: '4px solid hsl(var(--primary))', paddingTop: '1.5rem' }}>
        <p style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'hsl(var(--muted-foreground))', fontWeight: 600 }}>
          FinSight, Financial Analysis Report
        </p>
        <h1 style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1, margin: '0.5rem 0 0.25rem', color: 'hsl(var(--foreground))' }}>
          {workspace.name}
        </h1>
        <p style={{ fontSize: 18, color: 'hsl(var(--muted-foreground))', margin: '0.25rem 0 2rem' }}>
          {profileName}
        </p>
        <dl style={{ display: 'grid', gridTemplateColumns: '8rem 1fr', gap: '0.5rem', fontSize: 13 }}>
          <dt style={{ color: 'hsl(var(--muted-foreground))' }}>Workspace</dt>
          <dd style={{ color: 'hsl(var(--foreground))' }}>{workspace.name}</dd>
          <dt style={{ color: 'hsl(var(--muted-foreground))' }}>Profile</dt>
          <dd style={{ color: 'hsl(var(--foreground))' }}>{profileName}</dd>
          <dt style={{ color: 'hsl(var(--muted-foreground))' }}>Accounts</dt>
          <dd style={{ color: 'hsl(var(--foreground))' }}>{workspace.accounts.length}</dd>
          <dt style={{ color: 'hsl(var(--muted-foreground))' }}>Generated</dt>
          <dd style={{ color: 'hsl(var(--foreground))' }}>{today}</dd>
        </dl>
        <p style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: '3rem', maxWidth: '32em', lineHeight: 1.5 }}>
          This report answers four questions: where is this business today, where
          is it headed if nothing changes, what would actually move the needle,
          and how does it compare to where it should be.
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────
// Executive Summary
// ─────────────────────────────────────────────

function KpiTile({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div
      style={{
        border: '1px solid hsl(var(--border))',
        borderRadius: 8,
        padding: '0.75rem 1rem',
      }}
    >
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'hsl(var(--muted-foreground))', fontWeight: 600, margin: 0 }}>
        {label}
      </p>
      <p style={{ fontSize: 20, fontWeight: 700, color: 'hsl(var(--foreground))', margin: '0.25rem 0 0' }}>
        {value}
      </p>
      {sublabel && (
        <p style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', margin: '0.125rem 0 0' }}>
          {sublabel}
        </p>
      )}
    </div>
  );
}

// getUniquePeriods sorts ASCENDING — the latest period is the LAST element.
// (Using [0] rendered the whole report "as of" the oldest month.)
function latestPeriod(periods: Period[]): Period {
  return periods[periods.length - 1]!;
}

/**
 * Latest period that actually carries P&L (revenue/cogs/expense) data. A later
 * balance-sheet-only month (a BS snapshot imported after the last full P&L
 * month) must NOT become the report year — that collapsed the Exec Summary and
 * Income Statement to an all-$0 year. Falls back to null when there is no P&L.
 */
function latestPnLPeriod(workspace: ClientWorkspace): Period | null {
  const pnlIds = new Set(
    workspace.accounts
      .filter((a) => a.type === 'revenue' || a.type === 'cogs' || a.type === 'expense')
      .map((a) => a.id)
  );
  const pnlPeriods = getUniquePeriods(workspace.values.filter((v) => pnlIds.has(v.accountId)));
  return pnlPeriods.length > 0 ? latestPeriod(pnlPeriods) : null;
}

function ExecSummarySection({
  workspace,
  effectiveTargets,
}: {
  workspace: ClientWorkspace;
  effectiveTargets: WorkspaceTargets;
}) {
  const periods = getUniquePeriods(workspace.values);
  if (periods.length === 0) return null;
  // Use the latest P&L period so a later BS-only month doesn't blank the year.
  const latest = latestPnLPeriod(workspace) ?? latestPeriod(periods);
  const yearValues = workspace.values.filter((v) => v.period.year === latest.year);
  const yearAggregations = buildPeriodAggregations(workspace.accounts, yearValues, 'monthly');
  // Roll up YTD totals
  const totals = yearAggregations.reduce(
    (acc, agg) => ({
      revenue: acc.revenue + agg.revenue,
      cogs: acc.cogs + agg.cogs,
      grossProfit: acc.grossProfit + (agg.revenue - agg.cogs),
      operatingExpenses: acc.operatingExpenses + agg.operatingExpenses,
      netIncome: acc.netIncome + agg.netIncome,
    }),
    { revenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0, netIncome: 0 }
  );
  const grossMargin = totals.revenue > 0 ? totals.grossProfit / totals.revenue : 0;
  const netMargin = totals.revenue > 0 ? totals.netIncome / totals.revenue : 0;

  const narrative = buildExecutiveSummary(workspace, effectiveTargets);

  return (
    <section className="page-break-before avoid-break" style={{ paddingTop: '0.5rem' }}>
      <SectionHeader title="Executive Summary" subtitle={`FY${latest.year} year-to-date`} />

      {/* Plain-English narrative — the read-first block clients actually read */}
      {narrative.length > 0 && (
        <ul style={{ margin: '0 0 1.25rem', paddingLeft: '1.1rem', fontSize: 13, lineHeight: 1.6, color: 'hsl(var(--foreground))' }}>
          {narrative.map((line, i) => (
            <li key={i} style={{ marginBottom: '0.25rem' }}>{line.text}</li>
          ))}
        </ul>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
        <KpiTile label="Revenue" value={formatCurrency(totals.revenue)} />
        <KpiTile label="Gross Profit" value={formatCurrency(totals.grossProfit)} sublabel={formatPercent(grossMargin) + ' margin'} />
        <KpiTile label="Operating Expenses" value={formatCurrency(totals.operatingExpenses)} />
        <KpiTile label="Net Income" value={formatCurrency(totals.netIncome)} sublabel={formatPercent(netMargin) + ' margin'} />
        <KpiTile label="Periods Tracked" value={`${yearAggregations.length} mo`} sublabel={`through ${periodLabel(latest)}`} />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────
// Income Statement
// ─────────────────────────────────────────────

function PnLSection({ workspace }: { workspace: ClientWorkspace }) {
  const periods = getUniquePeriods(workspace.values);
  if (periods.length === 0) return null;
  // Latest P&L year, so a later BS-only month doesn't title an all-$0 statement.
  const latestYear = (latestPnLPeriod(workspace) ?? latestPeriod(periods)).year;
  const yearValues = workspace.values.filter((v) => v.period.year === latestYear);
  const aggregations = buildPeriodAggregations(workspace.accounts, yearValues, 'monthly');
  if (aggregations.length === 0) return null;

  // A letter-width page fits ~6 monthly columns; more than that overflows the
  // printable area and Chrome CLIPS it in the PDF. Chunk into stacked tables.
  const chunks: typeof aggregations[] = [];
  for (let i = 0; i < aggregations.length; i += 6) chunks.push(aggregations.slice(i, i + 6));

  return (
    <section className="page-break-before">
      <SectionHeader title="Income Statement" subtitle={`FY${latestYear}, monthly`} />
      {chunks.map((chunk, i) => (
        <div className="avoid-break" key={i}>
          <PnLReport
            aggregations={chunk}
            granularity="monthly"
            fit
            title={
              chunks.length > 1
                ? `Income Statement · ${chunk[0]!.label} – ${chunk[chunk.length - 1]!.label}`
                : 'Income Statement'
            }
          />
        </div>
      ))}
    </section>
  );
}

// ─────────────────────────────────────────────
// Key Ratios
// ─────────────────────────────────────────────

function RatiosSection({
  workspace,
  effectiveTargets,
}: {
  workspace: ClientWorkspace;
  effectiveTargets: WorkspaceTargets;
}) {
  const periods = getUniquePeriods(workspace.values);
  if (periods.length === 0) return null;
  const latest = latestPeriod(periods);
  const pnl = computePnL(workspace.accounts, workspace.values, latest);

  // Same math as the on-screen ratio cards (current assets / current
  // liabilities) — the old totals-based shortcut disagreed with the app
  // and could mis-judge targets on the PDF.
  const bsRatios = computeBalanceSheetRatios(workspace.accounts, workspace.values, latest);
  // hasBS reflects the ratios ACTUALLY rendered (period-exact at `latest`), not
  // an array-order scan of some earlier balance — so the "no balance sheet
  // imported" note shows exactly when the ratios are unavailable, and there is
  // no dependence on workspace.values ordering.
  const hasBS = bsRatios.currentRatio !== null || bsRatios.debtToEquity !== null;
  const currentRatio = hasBS ? bsRatios.currentRatio : null;
  const debtEquity = hasBS ? bsRatios.debtToEquity : null;
  const grossMargin = pnl.revenue > 0 ? pnl.grossMarginPct : null;
  const netMargin = pnl.revenue > 0 ? pnl.netMarginPct : null;
  const contribMargin = pnl.revenue > 0 ? pnl.contributionMarginPct : null;

  // Target-aware rows: a client target (corporate mandate / custom goal)
  // replaces the generic guidance text and gets a met/off-target verdict.
  const buildRow = (
    key: RatioKey,
    value: number | null
  ): { label: string; value: string; benchmark: string; benchmarkTitle?: string; status: string } => {
    const def = RATIO_DEF_MAP[key]!;
    const resolved = resolveRatioBenchmark(key, effectiveTargets);
    const fmt = (v: number) => (def.format === 'percent' ? formatPercent(v) : formatRatio(v));
    if (resolved.target) {
      // 'industry' gets the asterisk; the disclaimer footnote sits at the
      // bottom of the report (plus a hover title for the on-screen preview).
      const isIndustry = resolved.provenance === 'industry';
      const provenance = `${PROVENANCE_LABELS[resolved.provenance]}${isIndustry ? '*' : ''}`;
      const verdict =
        value !== null ? (meetsTarget(value, resolved.target) ? '✓ met' : '✗ off target') : '';
      return {
        label: def.label,
        value: value !== null ? fmt(value) : '—',
        benchmark: `${resolved.targetText} (${provenance})`,
        ...(isIndustry ? { benchmarkTitle: INDUSTRY_BENCHMARK_DISCLAIMER } : {}),
        status: verdict,
      };
    }
    // No target set: use the SAME registry-derived default threshold the
    // on-screen ratio cards show (defaultBenchmarkThreshold), so the PDF can't
    // drift from the app (gross margin printed "30%" while the app used 40%).
    return {
      label: def.label,
      value: value !== null ? fmt(value) : '—',
      benchmark: `${resolved.thresholdText} (FinSight default)`,
      status: '',
    };
  };

  const rows = [
    buildRow('gross_margin', grossMargin),
    buildRow('net_margin', netMargin),
    buildRow('contribution_margin', contribMargin),
    buildRow('current_ratio', currentRatio),
    buildRow('debt_to_equity', debtEquity),
  ];

  return (
    <section className="page-break-before avoid-break">
      <SectionHeader title="Key Ratios" subtitle={`as of ${periodLabel(latest)}`} />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1.5px solid hsl(var(--border))' }}>
            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, color: 'hsl(var(--muted-foreground))', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Ratio
            </th>
            <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontWeight: 600, color: 'hsl(var(--muted-foreground))', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Value
            </th>
            <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontWeight: 600, color: 'hsl(var(--muted-foreground))', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Benchmark
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} style={{ borderBottom: '1px solid hsl(var(--border))' }}>
              <td style={{ padding: '0.5rem 0.75rem', color: 'hsl(var(--foreground))' }}>{r.label}</td>
              <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600, color: 'hsl(var(--foreground))' }}>
                {r.value}
                {r.status && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      color: r.status.startsWith('✓') ? 'hsl(142 71% 35%)' : 'hsl(0 72% 45%)',
                    }}
                  >
                    {r.status}
                  </span>
                )}
              </td>
              <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: 'hsl(var(--muted-foreground))', fontSize: 12 }} title={r.benchmarkTitle}>{r.benchmark}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!hasBS && (
        <p style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: '0.5rem', fontStyle: 'italic' }}>
          Balance-sheet ratios unavailable. No balance sheet imported.
        </p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────
// 12-Month Projection
// ─────────────────────────────────────────────

function ProjectionSection({ workspace }: { workspace: ClientWorkspace }) {
  const periods = getUniquePeriods(workspace.values);
  if (periods.length < 3) return null; // Projections need ≥3 months

  // Use the workspace's persisted projection model/growth so the printed PDF
  // matches what the app shows (Projections tab + What-If share these).
  const proj = projectWorkspace(workspace.accounts, workspace.values, {
    horizonMonths: 12,
    model: workspace.projectionModel ?? getProfile(workspace.industryProfileId).defaultProjectionModel,
    growthRateOverride: workspace.projectionGrowthOverride ?? undefined,
  });

  const data: ProjectionChartDataPoint[] = proj.rolledUp.map((r) => {
    const label = periodLabel(r.period);
    const point: ProjectionChartDataPoint = {
      label,
      isProjected: r.isProjected,
    };
    if (!r.isProjected) {
      point.actual = r.revenue;
    } else if (r.revenueProjected) {
      point.projected = r.revenueProjected.value;
      point.lower80 = r.revenueProjected.lower80;
      point.upper80 = r.revenueProjected.upper80;
    }
    return point;
  });

  return (
    <section className="page-break-before avoid-break">
      <SectionHeader
        title="12-Month Revenue Projection"
        subtitle="Linear model, confidence band widens with horizon"
      />
      <div className="print-chart">
        <ProjectionChart data={data} metric="revenue" height={300} />
      </div>
      <p style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: '0.75rem', lineHeight: 1.5, maxWidth: '40em' }}>
        Solid line = historical actuals. Dashed line = projected. Shaded band = 80%
        confidence interval. The model assumes the historical trend continues. It
        does NOT account for known upcoming changes (new hires, marketing pushes,
        seasonality not yet observed). Re-run with the seasonal or YoY model in the
        live workspace if more recent data calls for it.
      </p>
    </section>
  );
}

// ─────────────────────────────────────────────
// Operational Metrics
// ─────────────────────────────────────────────

function OperationalSection({
  workspace,
  effectiveTargets,
}: {
  workspace: ClientWorkspace;
  effectiveTargets: WorkspaceTargets;
}) {
  const periods = getUniquePeriods(workspace.values);
  if (periods.length === 0) return null;
  const profile = ALL_PROFILES.find((p) => p.id === workspace.industryProfileId);
  if (!profile || profile.operationalMetrics.length === 0) return null;

  // Operational metrics derive from P&L financials, so anchor on the latest P&L
  // period (a later BS-only month would zero out revenue/margin inputs).
  const latest = latestPnLPeriod(workspace) ?? latestPeriod(periods);
  // computeMetricsForPeriod wants a FinancialSummary, which is derived
  // from a PnL for that period.
  const pnl = computePnL(workspace.accounts, workspace.values, latest);
  const summary = toFinancialSummary(pnl, latest);
  const metricResults = computeMetricsForPeriod(
    profile.operationalMetrics,
    workspace.operationalData ?? [],
    summary,
    latest,
    workspace.operationalInputs,
    effectiveTargets.metrics
  );
  const withData = metricResults.filter((r) => r.value !== null);
  if (withData.length === 0) return null;

  return (
    <section className="page-break-before avoid-break">
      <SectionHeader
        title="Operational Metrics"
        subtitle={`${profile.name}, ${periodLabel(latest)}`}
      />
      <MetricGrid
        results={metricResults}
        customMetrics={workspace.customMetrics ?? []}
        operationalData={workspace.operationalData ?? []}
        period={latest}
      />
    </section>
  );
}

// ─────────────────────────────────────────────
// Section header helper
// ─────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid hsl(var(--border))' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'hsl(var(--foreground))', margin: 0 }}>
        {title}
      </h2>
      {subtitle && (
        <p style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', margin: '0.125rem 0 0' }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Top-level PrintReport
// ─────────────────────────────────────────────

export function PrintReport({ workspace, onBenchmarksReady }: PrintReportProps) {
  const profile = ALL_PROFILES.find((p) => p.id === workspace.industryProfileId);
  const profileName = profile?.name ?? 'Generic SMB';
  const hasData = workspace.accounts.length > 0 && workspace.values.length > 0;
  // Composed targets: client target > franchise corporate set > industry pack.
  // Non-franchise workspaces get plain workspace.targets semantics back.
  // pack is non-null only when the industry toggle is on — it drives the
  // asterisk footnote below.
  const { targets: effectiveTargets, pack, loaded } = useEffectiveTargets(workspace);

  // Signal benchmark readiness upward so the print page can gate auto-print
  // (idempotent — the page latches the first call).
  useEffect(() => {
    if (loaded) onBenchmarksReady?.();
  }, [loaded, onBenchmarksReady]);

  return (
    <div
      style={{
        maxWidth: '7.4in',
        margin: '0 auto',
        padding: '0.5rem 0.5in',
        background: 'white',
        color: 'hsl(var(--foreground))',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      {/* Inline print branding shown above cover */}
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0 1.5rem', borderBottom: '1px solid hsl(var(--border))', marginBottom: '1.5rem' }}>
        <ProfileIcon profileId={profile?.id} size={16} />
        <span style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
          Preview · use the Generate PDF button to save or print
        </span>
      </div>

      <CoverSection workspace={workspace} profileName={profileName} />

      {hasData ? (
        <>
          <ExecSummarySection workspace={workspace} effectiveTargets={effectiveTargets} />
          <PnLSection workspace={workspace} />
          <RatiosSection workspace={workspace} effectiveTargets={effectiveTargets} />
          <ProjectionSection workspace={workspace} />
          <OperationalSection workspace={workspace} effectiveTargets={effectiveTargets} />
        </>
      ) : (
        <section className="page-break-before avoid-break">
          <SectionHeader title="No financial data" />
          <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5, maxWidth: '40em' }}>
            This workspace doesn&apos;t have any P&amp;L or balance-sheet data yet. Import a
            client P&amp;L or balance sheet on the home page, then re-generate this report
            to see KPIs, ratios, projections, and operational metrics.
          </p>
        </section>
      )}

      {/* Industry benchmark footnote — printed whenever the industry pack is
          in play so every asterisked row above resolves to this disclaimer */}
      {hasData && pack && (
        <p
          data-testid="print-industry-footnote"
          style={{ marginTop: '2rem', fontSize: 10, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}
        >
          * Industry benchmark: {INDUSTRY_BENCHMARK_DISCLAIMER} Pack {pack.packVersion} ({pack.packUpdated}), scope: {pack.scopeLabel}
        </p>
      )}

      {/* Footer */}
      <footer style={{ marginTop: '2rem', paddingTop: '0.75rem', borderTop: '1px solid hsl(var(--border))', fontSize: 10, color: 'hsl(var(--muted-foreground))', textAlign: 'center' }}>
        Generated by FinSight · all data stayed in this browser · no telemetry
      </footer>
    </div>
  );
}
