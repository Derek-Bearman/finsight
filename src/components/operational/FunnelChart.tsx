'use client';

/**
 * Marketing funnel visualization: stage bars (Leads → Appointments → New
 * Customers) with conversion rates between stages, plus a per-stage trend
 * across periods. Pure presentational — reads the shared-input pools.
 */

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { OperationalInputPool, Period } from '@/types';
import { FUNNEL_INPUT_IDS } from '@/lib/operational/funnel';
import { periodLabel, periodSortKey } from '@/lib/utils/period';
import { formatCurrency } from '@/lib/utils/format';

const STAGE_COLORS = ['hsl(217 91% 55%)', 'hsl(186 70% 45%)', 'hsl(142 71% 45%)'];

function pct(n: number | null): string {
  if (n === null) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

export function FunnelChart({
  pools,
  period,
  marketingSpendFromPnL,
}: {
  pools: OperationalInputPool[];
  period: Period;
  /** Fallback spend from the P&L marketing accounts for the selected period. */
  marketingSpendFromPnL: number;
}) {
  const pool = pools.find(
    (p) => p.period.year === period.year && p.period.month === period.month
  );

  const stages = useMemo(() => {
    const s = pool?.sharedInputs ?? {};
    return {
      spend:
        s[FUNNEL_INPUT_IDS.spend] !== undefined && s[FUNNEL_INPUT_IDS.spend]! > 0
          ? s[FUNNEL_INPUT_IDS.spend]!
          : marketingSpendFromPnL,
      spendIsManual: s[FUNNEL_INPUT_IDS.spend] !== undefined && s[FUNNEL_INPUT_IDS.spend]! > 0,
      leads: s[FUNNEL_INPUT_IDS.leads] ?? null,
      appointments: s[FUNNEL_INPUT_IDS.appointments] ?? null,
      customers: s[FUNNEL_INPUT_IDS.customers] ?? null,
      revenue: s[FUNNEL_INPUT_IDS.revenue] ?? null,
    };
  }, [pool, marketingSpendFromPnL]);

  const trendData = useMemo(() => {
    return [...pools]
      .filter((p) => Object.keys(p.sharedInputs).length > 0)
      .sort((a, b) => periodSortKey(a.period) - periodSortKey(b.period))
      .map((p) => ({
        label: periodLabel(p.period),
        Leads: p.sharedInputs[FUNNEL_INPUT_IDS.leads] ?? null,
        Appointments: p.sharedInputs[FUNNEL_INPUT_IDS.appointments] ?? null,
        'New Customers': p.sharedInputs[FUNNEL_INPUT_IDS.customers] ?? null,
      }));
  }, [pools]);

  if (!pool || stages.leads === null) {
    return null; // no funnel data for this period — section stays hidden
  }

  const max = Math.max(stages.leads ?? 0, 1);
  const bars = [
    { label: 'Leads', value: stages.leads },
    { label: 'Appointments', value: stages.appointments },
    { label: 'New Customers', value: stages.customers },
  ];
  const leadToAppt =
    stages.leads && stages.appointments !== null ? stages.appointments / stages.leads : null;
  const apptToClose =
    stages.appointments && stages.customers !== null ? stages.customers / stages.appointments : null;
  const leadToSale = stages.leads && stages.customers !== null ? stages.customers / stages.leads : null;

  return (
    <div
      className="rounded-xl border p-5 flex flex-col gap-4"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      data-testid="funnel-chart"
    >
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
          Marketing Funnel — {periodLabel(period)}
        </h3>
        <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {formatCurrency(stages.spend)} marketing spend
          {stages.spendIsManual ? '' : ' (from P&L marketing accounts)'}
        </p>
      </div>

      {/* Stage bars */}
      <div className="flex flex-col gap-1.5">
        {bars.map((bar, i) => (
          <div key={bar.label}>
            <div className="flex items-center gap-3">
              <span
                className="text-xs w-28 flex-shrink-0 font-medium"
                style={{ color: 'hsl(var(--foreground))' }}
              >
                {bar.label}
              </span>
              <div className="flex-1 h-6 rounded-md" style={{ background: 'hsl(var(--muted))' }}>
                <div
                  className="h-6 rounded-md flex items-center px-2 min-w-fit transition-all"
                  style={{
                    width: `${Math.max(((bar.value ?? 0) / max) * 100, 2)}%`,
                    background: STAGE_COLORS[i],
                  }}
                >
                  <span className="text-xs font-semibold text-white tabular-nums whitespace-nowrap">
                    {bar.value !== null ? bar.value.toLocaleString() : '—'}
                  </span>
                </div>
              </div>
            </div>
            {/* Conversion between this stage and the next */}
            {i < bars.length - 1 && (
              <p className="text-xs py-0.5 ml-28 pl-3" style={{ color: 'hsl(var(--muted-foreground))' }}>
                ↓ {i === 0 ? pct(leadToAppt) : pct(apptToClose)} convert
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Summary line */}
      <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
        Overall lead → sale: <strong>{pct(leadToSale)}</strong>
        {stages.customers ? (
          <>
            {' '}
            · cost per customer: <strong>{stages.spend ? formatCurrency(stages.spend / stages.customers) : '—'}</strong>
          </>
        ) : null}
        {stages.revenue !== null && stages.spend ? (
          <>
            {' '}
            · new-customer revenue {formatCurrency(stages.revenue)} ={' '}
            <strong>{(stages.revenue / stages.spend).toFixed(1)}×</strong> marketing ROI
          </>
        ) : null}
      </p>

      {/* Per-stage trend across periods */}
      {trendData.length >= 2 && (
        <div>
          <h4 className="text-xs font-semibold mb-2" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Funnel Trend
          </h4>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Leads" stroke={STAGE_COLORS[0]} dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="Appointments" stroke={STAGE_COLORS[1]} dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="New Customers" stroke={STAGE_COLORS[2]} dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-1 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Each line is a funnel stage per period — diverging lines mean a stage&apos;s conversion is changing.
          </p>
        </div>
      )}
    </div>
  );
}
