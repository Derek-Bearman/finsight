'use client';

/**
 * Co-franchisee comparison table (FRANCHISE_BENCHMARKS_PLAN.md §F3) — the
 * bottom section of the workspace Reports tab for franchise-linked clients.
 * Read-only: peer snapshots are computed SERVER-side by
 * getFranchisePeersAction (whole-workspace blobs never ship to the browser);
 * this renders the rank table — every numeric column sortable (nulls last),
 * the current client highlighted with a "this client" pill, and a median
 * subtotal row. Table chrome mirrors StatementsView (sticky first column,
 * horizontal scroll inside the card).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { getFranchisePeersAction } from '@/lib/data/franchise-peer-actions';
import { median, type PeerSnapshot } from '@/lib/franchise/peer-metrics';
import { RATIO_DEF_MAP, type RatioKey } from '@/lib/targets';
import { formatMetricValue } from '@/lib/utils/format';
import { Button } from '@/components/ui/button';

// ─────────────────────────────────────────────
// Formatting + columns
// ─────────────────────────────────────────────

/** Short currency for the T12 columns — the house chart/forecast
 *  abbreviation (see ForecastSummary.abbrev / chart axis helpers). */
function abbrevCurrency(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

/** Months of data: integers as-is; the median of an even peer count can
 *  land on .5, which we show honestly instead of rounding. */
function renderMonths(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

interface NumericColumn {
  id: string;
  label: string;
  value: (p: PeerSnapshot) => number | null;
  render: (v: number | null) => string;
}

const RATIO_COLUMNS: Array<{ key: RatioKey; label: string }> = [
  { key: 'gross_margin', label: 'Gross %' },
  { key: 'net_margin', label: 'Net %' },
  { key: 'contribution_margin', label: 'CM %' },
  { key: 'current_ratio', label: 'Current ratio' },
  { key: 'debt_to_equity', label: 'Debt/Equity' },
  { key: 'roe', label: 'ROE' },
  { key: 'altman_z', label: 'Z score' },
];

const COLUMNS: NumericColumn[] = [
  {
    id: 'revenue',
    label: 'Revenue (T12)',
    value: (p) => p.trailing12Revenue,
    render: abbrevCurrency,
  },
  {
    id: 'netIncome',
    label: 'Net income (T12)',
    value: (p) => p.trailing12NetIncome,
    render: abbrevCurrency,
  },
  ...RATIO_COLUMNS.map(
    ({ key, label }): NumericColumn => ({
      id: key,
      label,
      value: (p) => p.ratios[key] ?? null,
      render: (v) => formatMetricValue(v, RATIO_DEF_MAP[key]!.format),
    })
  ),
  {
    id: 'months',
    label: 'Months',
    value: (p) => p.monthCount,
    render: renderMonths,
  },
];

// ─────────────────────────────────────────────
// Table chrome (mirrors StatementsView's sticky first column)
// ─────────────────────────────────────────────

const STICKY_BG = 'hsl(var(--card))';
const HEADER_BG = 'hsl(var(--muted))';
const SELF_ROW_BG = 'hsl(var(--primary) / 0.07)';
// Sticky cells need opaque backgrounds — layer the tint over the card color.
const SELF_STICKY_BG =
  'linear-gradient(hsl(var(--primary) / 0.07), hsl(var(--primary) / 0.07)), hsl(var(--card))';
const MEDIAN_STICKY_BG =
  'linear-gradient(hsl(var(--muted) / 0.4), hsl(var(--muted) / 0.4)), hsl(var(--card))';

function stickyStyle(bg: string, weight = 400): CSSProperties {
  return {
    position: 'sticky',
    left: 0,
    background: bg,
    borderRight: '1px solid hsl(var(--border))',
    zIndex: 1,
    fontWeight: weight,
    minWidth: 190,
    maxWidth: 280,
  };
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export function FranchiseComparison({
  franchiseId,
  workspaceId,
}: {
  franchiseId: string;
  /** The workspace being viewed — its row gets the "this client" highlight. */
  workspaceId: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ franchiseName: string; peers: PeerSnapshot[] } | null>(null);

  // Default rank: Revenue (T12), biggest first.
  const [sortKey, setSortKey] = useState<string>('revenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Discard responses that lose a refresh race.
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await getFranchisePeersAction({ franchiseId });
      if (seq !== seqRef.current) return;
      if (res.ok) {
        setData({ franchiseName: res.franchiseName, peers: res.peers });
      } else {
        setError(res.error);
      }
    } catch {
      if (seq === seqRef.current) setError('Failed to load the franchise comparison.');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSort(id: string) {
    if (id === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(id);
      setSortDir('desc');
    }
  }

  const sorted = useMemo(() => {
    if (!data) return [];
    const col = COLUMNS.find((c) => c.id === sortKey) ?? COLUMNS[0]!;
    return [...data.peers].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // nulls always last, either direction
      if (vb === null) return -1;
      return sortDir === 'desc' ? vb - va : va - vb;
    });
  }, [data, sortKey, sortDir]);

  // Latest-month suffix only when the peers' latest months differ.
  const labelsDiffer = useMemo(() => {
    if (!data) return false;
    const labels = new Set(
      data.peers.map((p) => p.latestPeriodLabel).filter((l): l is string => l !== null)
    );
    return labels.size > 1;
  }, [data]);

  return (
    <div
      className="rounded-xl border"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      data-testid="franchise-comparison"
    >
      {/* Context + refresh */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid hsl(var(--border))' }}
      >
        <p className="text-xs text-muted-foreground" data-testid="franchise-comparison-context">
          {data
            ? `${data.franchiseName} · ${data.peers.length} franchisee${data.peers.length === 1 ? '' : 's'}`
            : 'Franchise peers'}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          data-testid="franchise-comparison-refresh"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {error ? (
        <p
          className="px-3 py-4 text-sm text-destructive"
          role="alert"
          data-testid="franchise-comparison-error"
        >
          {error}
        </p>
      ) : !data ? (
        <p
          className="px-3 py-4 text-sm text-muted-foreground"
          data-testid="franchise-comparison-loading"
        >
          Loading franchise comparison…
        </p>
      ) : data.peers.length <= 1 ? (
        <p
          className="px-3 py-4 text-sm text-muted-foreground"
          data-testid="franchise-comparison-empty"
        >
          No other franchisees are linked to {data.franchiseName} yet.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse text-sm"
              style={{ minWidth: `${190 + COLUMNS.length * 105}px` }}
              data-testid="franchise-comparison-table"
            >
              <thead>
                <tr style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                  <th
                    className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide"
                    style={{ ...stickyStyle(HEADER_BG), color: 'hsl(var(--muted-foreground))', zIndex: 2 }}
                  >
                    Franchisee
                  </th>
                  {COLUMNS.map((col) => {
                    const active = sortKey === col.id;
                    return (
                      <th
                        key={col.id}
                        className="text-right text-xs font-medium uppercase tracking-wide whitespace-nowrap"
                        style={{
                          background: HEADER_BG,
                          color: active ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                        }}
                        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        <button
                          type="button"
                          onClick={() => handleSort(col.id)}
                          className="w-full cursor-pointer px-3 py-2 text-right text-xs font-medium uppercase tracking-wide"
                          style={{ color: 'inherit' }}
                          data-testid={`franchise-comparison-sort-${col.id}`}
                        >
                          {col.label}
                          {active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const isSelf = p.workspaceId === workspaceId;
                  return (
                    <tr
                      key={p.workspaceId}
                      style={{ background: isSelf ? SELF_ROW_BG : 'transparent' }}
                      data-testid={isSelf ? 'franchise-comparison-self-row' : 'franchise-comparison-row'}
                    >
                      <td
                        className="px-3 py-1.5"
                        style={{
                          ...stickyStyle(isSelf ? SELF_STICKY_BG : STICKY_BG, isSelf ? 600 : 400),
                          color: 'hsl(var(--foreground))',
                          ...(isSelf ? { borderLeft: '3px solid hsl(var(--primary))' } : {}),
                        }}
                      >
                        {p.name}
                        {labelsDiffer && p.latestPeriodLabel && (
                          <span className="ml-1.5 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                            {p.latestPeriodLabel}
                          </span>
                        )}
                        {isSelf && (
                          <span
                            className="ml-1.5 whitespace-nowrap rounded-full px-1.5 py-0.5 align-middle text-[10px] font-semibold"
                            style={{ background: 'hsl(var(--primary) / 0.15)', color: 'hsl(var(--primary))' }}
                            data-testid="franchise-comparison-self-pill"
                          >
                            this client
                          </span>
                        )}
                      </td>
                      {COLUMNS.map((col) => (
                        <td
                          key={col.id}
                          className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap"
                          style={{ fontWeight: isSelf ? 600 : 400, color: 'hsl(var(--foreground))' }}
                        >
                          {col.render(col.value(p))}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {/* Median subtotal row */}
                <tr
                  style={{ background: 'hsl(var(--muted) / 0.4)' }}
                  data-testid="franchise-comparison-median-row"
                >
                  <td
                    className="px-3 py-1.5"
                    style={{
                      ...stickyStyle(MEDIAN_STICKY_BG, 600),
                      color: 'hsl(var(--foreground))',
                      borderTop: '1px solid hsl(var(--border))',
                    }}
                  >
                    Median (n={data.peers.length})
                  </td>
                  {COLUMNS.map((col) => (
                    <td
                      key={col.id}
                      className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap"
                      style={{
                        fontWeight: 600,
                        color: 'hsl(var(--foreground))',
                        borderTop: '1px solid hsl(var(--border))',
                      }}
                    >
                      {col.render(median(data.peers.map(col.value)))}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p
            className="px-3 py-2 text-xs text-muted-foreground"
            style={{ borderTop: '1px solid hsl(var(--border))' }}
            data-testid="franchise-comparison-caption"
          >
            Latest month per franchisee (label shown per row when they differ) · trailing 12 months
            for revenue and net income.
          </p>
        </>
      )}
    </div>
  );
}
