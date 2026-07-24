'use client';

/**
 * Corporate-line comparison (SCOA_ROLLUP_PLAN.md, Phase 2) — Reports-tab section
 * for franchise-linked clients whose franchise has a corporate SCOA. Each
 * corporate line shows THIS franchisee's rolled-up trailing-12 value (many
 * client accounts folded by scoaNumber) next to the peer median, in % of
 * revenue (the size-neutral default) or dollars. Rows expand to list the
 * client accounts that roll up here (this franchisee only — peers stay server-
 * side; getFranchiseScoaComparisonAction returns numbers, never blobs).
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientWorkspace } from '@/types';
import { getFranchiseScoaComparisonAction } from '@/lib/data/franchise-scoa-comparison-actions';
import { rollupByScoa, type ScoaComparisonLine, type ScoaLineRollup } from '@/lib/franchise/scoa-rollup';
import { useEffectiveTargets } from '@/lib/franchise/useEffectiveTargets';
import { getTrailingPeriods } from '@/lib/calculations/period-aggregation';
import { Button } from '@/components/ui/button';

function abbrevCurrency(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}
function pct(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`;
}

type Data = { franchiseName: string; hasScoa: boolean; peerCount: number; lines: ScoaComparisonLine[] };

export function ScoaLineComparison({ workspace }: { workspace: ClientWorkspace }) {
  const { franchise } = useEffectiveTargets(workspace);
  const scoa = franchise?.config.scoa;

  const [mode, setMode] = useState<'pct' | 'dollar'>('pct');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    if (!workspace.franchiseId) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await getFranchiseScoaComparisonAction({
        franchiseId: workspace.franchiseId,
        workspaceId: workspace.id,
      });
      if (seq !== seqRef.current) return;
      if (res.ok) setData({ franchiseName: res.franchiseName, hasScoa: res.hasScoa, peerCount: res.peerCount, lines: res.lines });
      else setError(res.error);
    } catch {
      if (seq === seqRef.current) setError('Failed to load the corporate-line comparison.');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [workspace.franchiseId, workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Local roll-up for the "what rolls up here" expand — this franchisee only.
  const localLines = useMemo(() => {
    if (!scoa) return new Map<string, ScoaLineRollup>();
    const roll = rollupByScoa(
      scoa.accounts,
      workspace.accounts,
      workspace.values,
      getTrailingPeriods(workspace.values, 12)
    );
    return new Map(roll.lines.map((l) => [l.number, l]));
  }, [scoa, workspace.accounts, workspace.values]);

  const rows = useMemo(
    () => (data?.lines ?? []).filter((l) => l.thisTotal !== null || l.peerMedianTotal !== null),
    [data]
  );

  if (!workspace.franchiseId) return null;

  const toggleRow = (num: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });

  const thisVal = (l: ScoaComparisonLine) => (mode === 'pct' ? pct(l.thisPct) : abbrevCurrency(l.thisTotal));
  const peerVal = (l: ScoaComparisonLine) => (mode === 'pct' ? pct(l.peerMedianPct) : abbrevCurrency(l.peerMedianTotal));
  const deltaCell = (l: ScoaComparisonLine) => {
    const a = mode === 'pct' ? l.thisPct : l.thisTotal;
    const b = mode === 'pct' ? l.peerMedianPct : l.peerMedianTotal;
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return { text: '—', up: null as boolean | null };
    const d = a - b;
    const up = d > 0;
    const text = mode === 'pct' ? `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} pp` : `${d >= 0 ? '+' : '-'}${abbrevCurrency(Math.abs(d)).replace('-', '')}`;
    return { text, up };
  };

  return (
    <div
      className="rounded-xl border"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      data-testid="scoa-line-comparison"
    >
      {/* Header: context + $/% toggle + refresh */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid hsl(var(--border))' }}
      >
        <p className="text-xs text-muted-foreground" data-testid="scoa-line-comparison-context">
          {data
            ? `${data.franchiseName} · corporate lines vs ${data.peerCount} peer${data.peerCount === 1 ? '' : 's'} · trailing 12 months`
            : 'Corporate-line comparison'}
        </p>
        <div className="flex items-center gap-2">
          <div
            className="flex rounded-lg border overflow-hidden"
            style={{ borderColor: 'hsl(var(--border))' }}
            role="group"
            aria-label="Comparison basis"
          >
            {(['pct', 'dollar'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                data-testid={`scoa-line-comparison-mode-${m}`}
                className="px-2.5 py-1 text-xs font-medium transition-colors"
                style={{
                  background: mode === m ? 'hsl(var(--primary))' : 'hsl(var(--background))',
                  color: mode === m ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
                }}
              >
                {m === 'pct' ? '% of revenue' : 'Dollars'}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} data-testid="scoa-line-comparison-refresh">
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="px-3 py-4 text-sm text-destructive" role="alert" data-testid="scoa-line-comparison-error">
          {error}
        </p>
      ) : !data ? (
        <p className="px-3 py-4 text-sm text-muted-foreground" data-testid="scoa-line-comparison-loading">
          Loading corporate-line comparison…
        </p>
      ) : !data.hasScoa ? (
        <p className="px-3 py-4 text-sm text-muted-foreground" data-testid="scoa-line-comparison-noscoa">
          {data.franchiseName} has no corporate chart of accounts yet. Upload one on the Franchises page to
          compare by corporate line.
        </p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground" data-testid="scoa-line-comparison-empty">
          No corporate lines have data yet. Map this client&apos;s accounts to the corporate chart on the
          Mapping tab, and make sure peers have imported financials.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="scoa-line-comparison-table">
              <thead>
                <tr style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                  {['Corporate line', 'This client', 'Peer median', 'Δ'].map((h, i) => (
                    <th
                      key={h}
                      className={`px-3 py-2 text-xs font-medium uppercase tracking-wide ${i === 0 ? 'text-left' : 'text-right whitespace-nowrap'}`}
                      style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const d = deltaCell(l);
                  const local = localLines.get(l.number);
                  const isOpen = expanded.has(l.number);
                  const canExpand = (local?.accountIds.length ?? 0) > 0;
                  return (
                    <Fragment key={l.number}>
                      <tr data-testid="scoa-line-comparison-row" style={{ borderTop: '1px solid hsl(var(--border))' }}>
                        <td className="px-3 py-1.5" style={{ color: 'hsl(var(--foreground))' }}>
                          <button
                            type="button"
                            onClick={() => canExpand && toggleRow(l.number)}
                            data-testid="scoa-line-comparison-expand"
                            className="flex items-start gap-1.5 text-left"
                            style={{ cursor: canExpand ? 'pointer' : 'default' }}
                            aria-expanded={isOpen}
                          >
                            {canExpand && (
                              <span aria-hidden className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                                {isOpen ? '▾' : '▸'}
                              </span>
                            )}
                            <span>
                              <span className="font-medium">{l.name}</span>
                              <span className="ml-1.5 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                                {l.number}
                                {canExpand ? ` · ${local!.accountIds.length} account${local!.accountIds.length === 1 ? '' : 's'}` : ''}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                          {thisVal(l)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap" style={{ color: 'hsl(var(--muted-foreground))' }}>
                          {peerVal(l)}
                          {(mode === 'pct' ? l.peerMedianPct : l.peerMedianTotal) !== null && (
                            <span className="ml-1 text-[10px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
                              n={mode === 'pct' ? l.peerPctCount : l.peerCount}
                            </span>
                          )}
                        </td>
                        <td
                          className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap"
                          style={{ color: d.up === null ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))' }}
                          data-testid="scoa-line-comparison-delta"
                        >
                          {d.text}
                        </td>
                      </tr>
                      {isOpen && canExpand && (
                        <tr style={{ background: 'hsl(var(--muted) / 0.3)' }}>
                          <td colSpan={4} className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                                Rolls up:
                              </span>
                              {local!.accountNames.map((name, i) => (
                                <span
                                  key={`${l.number}-${i}`}
                                  className="rounded-full border px-2 py-0.5 text-xs"
                                  style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
                                >
                                  {name}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p
            className="px-3 py-2 text-xs text-muted-foreground"
            style={{ borderTop: '1px solid hsl(var(--border))' }}
            data-testid="scoa-line-comparison-caption"
          >
            Each corporate line folds up every client account mapped to it. {mode === 'pct' ? '% of revenue' : 'Dollars'} over the
            trailing 12 months, this client vs the median of {data.peerCount} peer{data.peerCount === 1 ? '' : 's'}. Δ is this client minus
            the peer median.
          </p>
        </>
      )}
    </div>
  );
}
