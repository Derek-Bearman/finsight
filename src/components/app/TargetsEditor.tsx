'use client';

/**
 * Targets editor (Bob feature c/e) — set client-specific KPI targets, most
 * importantly corporate/franchise-mandated ones (e.g. "food cost ≤ 30%",
 * "current ratio ≥ 1.5"). A target overrides FinSight's default benchmark
 * everywhere the ratio renders, always labeled with its provenance.
 *
 * Covers the financial-ratio registry plus the current profile's operational
 * metrics (including the marketing funnel). Percent targets are entered as
 * whole percentages (30 = 30%) and stored as fractions.
 */

import { useEffect, useMemo, useState } from 'react';
import type {
  ClientWorkspace,
  KpiTarget,
  MetricFormat,
  OperationalMetricDef,
  WorkspaceTargets,
} from '@/types';
import { RATIO_DEFS } from '@/lib/targets';
import { getProfile } from '@/lib/profiles';
import { useWorkspaceStore } from '@/store/workspace-store';
import { useEffectiveTargets } from '@/lib/franchise/useEffectiveTargets';
import {
  INDUSTRY_BENCHMARK_DISCLAIMER,
  PACK_VERSION,
  REGION_LABELS,
  resolvePack,
  type BenchmarkRegion,
} from '@/lib/benchmarks/packs';
import { computePnL } from '@/lib/calculations/pnl';
import { getTrailingPeriods } from '@/lib/calculations/period-aggregation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface RowDef {
  key: string;
  kind: 'ratios' | 'metrics';
  label: string;
  format: MetricFormat;
  defaultDirection: KpiTarget['direction'];
  hint: string | null;
}

interface RowState {
  enabled: boolean;
  /** As typed: percents in whole numbers ("30" = 30%). */
  raw: string;
  direction: KpiTarget['direction'];
  source: KpiTarget['source'];
}

function toRaw(target: KpiTarget | undefined, format: MetricFormat): string {
  if (!target) return '';
  const v = format === 'percent' ? target.value * 100 : target.value;
  return String(Number(v.toFixed(4)));
}

function fromRaw(raw: string, format: MetricFormat): number | null {
  const n = parseFloat(raw);
  if (isNaN(n)) return null;
  return format === 'percent' ? n / 100 : n;
}

function unitSuffix(format: MetricFormat): string {
  if (format === 'percent') return '%';
  if (format === 'currency') return '$';
  if (format === 'ratio') return '×';
  return '';
}

/** Trailing-12 revenue for the pack size band (mirrors useEffectiveTargets). */
function trailing12Revenue(ws: ClientWorkspace): number | null {
  if (!ws.values.length) return null;
  const periods = getTrailingPeriods(ws.values, 12);
  if (!periods.length) return null;
  return computePnL(ws.accounts, ws.values, periods).revenue;
}

/** Dialog-local draft of the workspace benchmark fields (staged until Save). */
interface BenchmarkDraft {
  enabled: boolean;
  region: BenchmarkRegion;
  packVersion: string | undefined;
}

function benchmarkDraftFrom(ws: ClientWorkspace): BenchmarkDraft {
  return {
    enabled: ws.industryBenchmarksEnabled ?? false,
    region: (ws.benchmarkRegion as BenchmarkRegion | undefined) ?? 'national',
    packVersion: ws.benchmarkPackVersion,
  };
}

export function TargetsEditor({
  workspace,
  open,
  onOpenChange,
  onSave,
}: {
  workspace: ClientWorkspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (targets: WorkspaceTargets) => void;
}) {
  const profile = getProfile(workspace.industryProfileId);

  // Benchmarks section (FRANCHISE_BENCHMARKS_PLAN.md §F2). The workspace-level
  // benchmark fields are staged in a dialog-local draft — like the target rows,
  // they only commit on "Save Targets" (via the store's updateWorkspace path,
  // so cloud-sync persists them) and Cancel discards. The pack caption below
  // previews the DRAFT via a direct resolvePack call (pure + cheap), and
  // "Refresh benchmarks" stamps the draft's pack version.
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);
  const { corporateSetLabel, franchise } = useEffectiveTargets(workspace);
  const [benchDraft, setBenchDraft] = useState<BenchmarkDraft>(() =>
    benchmarkDraftFrom(workspace)
  );
  const benchmarksEnabled = benchDraft.enabled;
  const packCurrent = benchDraft.packVersion === PACK_VERSION;
  // Prefer the live franchise name (renames land server-side); fall back to
  // the name cached on the workspace at link time.
  const franchiseName = franchise?.name ?? workspace.franchiseName ?? 'franchise';

  const rows: RowDef[] = useMemo(() => {
    const ratioRows: RowDef[] = RATIO_DEFS.map((d) => ({
      key: d.key,
      kind: 'ratios',
      label: d.label,
      format: d.format,
      defaultDirection: d.defaultDirection,
      hint: null,
    }));
    const metricRows: RowDef[] = profile.operationalMetrics.map((m: OperationalMetricDef) => ({
      key: m.id,
      kind: 'metrics',
      label: m.label,
      format: m.format,
      defaultDirection: m.benchmark?.direction === 'lower' ? 'at_most' : 'at_least',
      hint: m.category ?? null,
    }));
    return [...ratioRows, ...metricRows];
  }, [profile]);

  const [state, setState] = useState<Record<string, RowState>>({});

  function stateKey(row: RowDef): string {
    return `${row.kind}:${row.key}`;
  }

  // Reseed from the SAVED targets on every open — cancelled edits from a
  // previous open must not linger and get silently applied by a later Save.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, RowState> = {};
    for (const row of rows) {
      const existing =
        row.kind === 'ratios'
          ? workspace.targets?.ratios?.[row.key]
          : workspace.targets?.metrics?.[row.key];
      next[stateKey(row)] = {
        enabled: existing !== undefined,
        raw: toRaw(existing, row.format),
        direction: existing?.direction ?? row.defaultDirection,
        source: existing?.source ?? 'corporate',
      };
    }
    setState(next);
  }, [open, rows, workspace.targets]);

  // Reseed the benchmark draft from the SAVED workspace fields on every open,
  // for the same reason as the rows above.
  useEffect(() => {
    if (!open) return;
    setBenchDraft(benchmarkDraftFrom(workspace));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the
    // exact saved fields the draft is built from, like the row effect above
  }, [
    open,
    workspace.industryBenchmarksEnabled,
    workspace.benchmarkRegion,
    workspace.benchmarkPackVersion,
  ]);

  // Pack preview for the caption — resolved from the DRAFT toggle/region so
  // the scope label tracks unsaved edits.
  const previewPack = useMemo(() => {
    if (!benchDraft.enabled) return null;
    return resolvePack({
      profileId: workspace.industryProfileId,
      profileLabel: profile.name,
      trailing12Revenue: trailing12Revenue(workspace),
      region: benchDraft.region,
    });
  }, [benchDraft.enabled, benchDraft.region, workspace, profile]);

  const patch = (row: RowDef, p: Partial<RowState>) =>
    setState((s) => ({ ...s, [stateKey(row)]: { ...s[stateKey(row)]!, ...p } }));

  const handleSave = () => {
    const targets: WorkspaceTargets = { ratios: {}, metrics: {} };
    for (const row of rows) {
      const rs = state[stateKey(row)];
      if (!rs || !rs.enabled) continue;
      const value = fromRaw(rs.raw, row.format);
      if (value === null) continue;
      targets[row.kind][row.key] = {
        value,
        direction: rs.direction,
        source: rs.source,
      };
    }
    // Commit the staged benchmark fields in the same Save action as the
    // targets (the page's onSave patches { targets } separately, so the two
    // writes never clobber each other).
    updateWorkspace(workspace.id, {
      industryBenchmarksEnabled: benchDraft.enabled,
      benchmarkRegion: benchDraft.region,
      benchmarkPackVersion: benchDraft.packVersion,
    });
    onSave(targets);
    onOpenChange(false);
  };

  const enabledCount = Object.values(state).filter((r) => r.enabled && r.raw.trim() !== '').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm:max-w-2xl — the base DialogContent sets sm:max-w-sm, so an
          unprefixed max-w-2xl loses at the sm breakpoint via tailwind-merge */}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Client Targets</DialogTitle>
          <DialogDescription>
            Set corporate-mandated or custom targets for {workspace.name}. A target replaces the
            FinSight default benchmark everywhere the number appears, labeled with where it came
            from.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs uppercase tracking-wide border-b"
                style={{ color: 'hsl(var(--muted-foreground))', borderColor: 'hsl(var(--border))' }}
              >
                <th className="text-left py-2 pr-2 font-semibold">Metric</th>
                <th className="text-left py-2 pr-2 font-semibold w-16">Rule</th>
                <th className="text-left py-2 pr-2 font-semibold w-28">Target</th>
                <th className="text-left py-2 font-semibold w-28">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rs = state[stateKey(row)] ?? {
                  enabled: false,
                  raw: '',
                  direction: row.defaultDirection,
                  source: 'corporate' as const,
                };
                return (
                  <tr
                    key={stateKey(row)}
                    className="border-b"
                    style={{ borderColor: 'hsl(var(--border))' }}
                  >
                    <td className="py-2 pr-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rs.enabled}
                          onChange={(e) => patch(row, { enabled: e.target.checked })}
                        />
                        <span style={{ color: 'hsl(var(--foreground))' }}>{row.label}</span>
                        {row.hint && (
                          <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                            {row.hint}
                          </span>
                        )}
                      </label>
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        value={rs.direction}
                        disabled={!rs.enabled}
                        onChange={(e) => patch(row, { direction: e.target.value as KpiTarget['direction'] })}
                        className="rounded-md border px-1.5 py-1 text-sm disabled:opacity-40"
                        style={{
                          borderColor: 'hsl(var(--border))',
                          background: 'hsl(var(--background))',
                          color: 'hsl(var(--foreground))',
                        }}
                        aria-label={`${row.label} rule`}
                      >
                        <option value="at_least">≥</option>
                        <option value="at_most">≤</option>
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="any"
                          value={rs.raw}
                          disabled={!rs.enabled}
                          onChange={(e) => patch(row, { raw: e.target.value })}
                          placeholder="—"
                          className="w-20 rounded-md border px-2 py-1 text-sm disabled:opacity-40"
                          style={{
                            borderColor: 'hsl(var(--border))',
                            background: 'hsl(var(--background))',
                            color: 'hsl(var(--foreground))',
                          }}
                          aria-label={`${row.label} target value`}
                        />
                        <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                          {unitSuffix(row.format)}
                        </span>
                      </div>
                    </td>
                    <td className="py-2">
                      <select
                        value={rs.source}
                        disabled={!rs.enabled}
                        onChange={(e) => patch(row, { source: e.target.value as KpiTarget['source'] })}
                        className="rounded-md border px-1.5 py-1 text-sm disabled:opacity-40"
                        style={{
                          borderColor: 'hsl(var(--border))',
                          background: 'hsl(var(--background))',
                          color: 'hsl(var(--foreground))',
                        }}
                        aria-label={`${row.label} target source`}
                      >
                        <option value="corporate">Corporate</option>
                        <option value="custom">Custom</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Benchmarks — workspace-level benchmark wiring (§F2) */}
        <div className="border-t pt-3" style={{ borderColor: 'hsl(var(--border))' }}>
          <h3
            className="text-xs uppercase tracking-wide font-semibold"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            Benchmarks
          </h3>

          {corporateSetLabel ? (
            <p
              className="text-sm mt-2"
              style={{ color: 'hsl(var(--foreground))' }}
              data-testid="corporate-benchmark-status"
            >
              Corporate benchmarks applied:{' '}
              <span className="font-semibold">{corporateSetLabel}</span> (via {franchiseName})
            </p>
          ) : workspace.franchiseId ? (
            <p
              className="text-sm mt-2"
              style={{ color: 'hsl(var(--muted-foreground))' }}
              data-testid="corporate-benchmark-status"
            >
              Franchise linked, no active benchmark set yet.
            </p>
          ) : null}

          <label className="flex items-center gap-2 cursor-pointer mt-2">
            <input
              type="checkbox"
              data-testid="industry-benchmarks-toggle"
              checked={benchmarksEnabled}
              onChange={(e) => setBenchDraft((d) => ({ ...d, enabled: e.target.checked }))}
            />
            <span className="text-sm" style={{ color: 'hsl(var(--foreground))' }}>
              Use industry benchmarks when no corporate or custom value applies
            </span>
          </label>

          {benchmarksEnabled && (
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
              <label
                className="text-xs font-medium flex-shrink-0"
                style={{ color: 'hsl(var(--muted-foreground))' }}
                htmlFor="benchmark-region"
              >
                Region:
              </label>
              <select
                id="benchmark-region"
                data-testid="benchmark-region"
                value={benchDraft.region}
                onChange={(e) =>
                  setBenchDraft((d) => ({ ...d, region: e.target.value as BenchmarkRegion }))
                }
                className="rounded-md border px-1.5 py-1 text-sm cursor-pointer"
                style={{
                  borderColor: 'hsl(var(--border))',
                  background: 'hsl(var(--background))',
                  color: 'hsl(var(--foreground))',
                }}
                aria-label="Benchmark region"
              >
                {(Object.entries(REGION_LABELS) as [BenchmarkRegion, string][]).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
              {previewPack && (
                <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Pack {previewPack.packVersion} · {previewPack.scopeLabel}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                data-testid="refresh-benchmarks"
                disabled={packCurrent}
                onClick={() => setBenchDraft((d) => ({ ...d, packVersion: PACK_VERSION }))}
              >
                {packCurrent ? `Up to date (pack ${PACK_VERSION})` : 'Refresh benchmarks'}
              </Button>
            </div>
          )}

          <p className="text-xs mt-2" style={{ color: 'hsl(var(--muted-foreground))' }}>
            * {INDUSTRY_BENCHMARK_DISCLAIMER}
          </p>
        </div>

        <DialogFooter className="flex items-center justify-between gap-3 sm:justify-between">
          <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {enabledCount} target{enabledCount === 1 ? '' : 's'} set · unchecked rows keep the
            FinSight default benchmark
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} data-testid="targets-save">
              Save Targets
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
