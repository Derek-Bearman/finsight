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

import { useMemo, useState } from 'react';
import type {
  ClientWorkspace,
  KpiTarget,
  MetricFormat,
  OperationalMetricDef,
  WorkspaceTargets,
} from '@/types';
import { RATIO_DEFS } from '@/lib/targets';
import { getProfile } from '@/lib/profiles';
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

  // (Re)seed local state each time the dialog opens.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (open && seededFor !== workspace.id + workspace.updatedAt) {
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
    setSeededFor(workspace.id + workspace.updatedAt);
  }

  function stateKey(row: RowDef): string {
    return `${row.kind}:${row.key}`;
  }

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
    onSave(targets);
    onOpenChange(false);
  };

  const enabledCount = Object.values(state).filter((r) => r.enabled && r.raw.trim() !== '').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
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
