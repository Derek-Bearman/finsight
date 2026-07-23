'use client';

/**
 * Shared from/to date-range control for the workspace's scoped tabs (Overview,
 * Statements, Reports, Operational). It is populated from the workspace's ACTUAL
 * data range — you can only scope to months that exist — and emits a
 * {from, to} PeriodRange (each bound nullable). Rendered ONCE by the workspace
 * page and driven by shared state, so every scoped tab reads the same window.
 *
 * Monthly/Quarterly/Annual granularity is a separate control (per tab); this
 * only chooses the span, not the roll-up.
 */

import { useMemo } from 'react';
import type { AccountValue, Period } from '@/types';
import { workspaceDataRange, type PeriodRange } from '@/lib/calculations/period-aggregation';
import {
  addMonths,
  maxPeriod,
  minPeriod,
  periodLabel,
  periodRange,
  periodToString,
  parsePeriodString,
} from '@/lib/utils/period';

interface DateRangeControlProps {
  /** The workspace's full value set — defines the selectable month span. */
  values: AccountValue[];
  /** Current selection. {from:null,to:null} = all time (default). */
  range: PeriodRange;
  onRangeChange: (range: PeriodRange) => void;
}

function ordinal(p: Period): number {
  return p.year * 12 + p.month;
}

function periodsEqual(a: Period | null, b: Period | null): boolean {
  if (a === null || b === null) return a === b;
  return a.year === b.year && a.month === b.month;
}

function rangeEquals(a: PeriodRange, b: PeriodRange): boolean {
  return periodsEqual(a.from, b.from) && periodsEqual(a.to, b.to);
}

const SELECT_STYLE: React.CSSProperties = {
  borderColor: 'hsl(var(--border))',
  background: 'hsl(var(--card))',
  color: 'hsl(var(--foreground))',
};

export function DateRangeControl({ values, range, onRangeChange }: DateRangeControlProps) {
  const dataRange = useMemo(() => workspaceDataRange(values), [values]);
  const months = useMemo(
    () => (dataRange ? periodRange(dataRange.min, dataRange.max) : []),
    [dataRange]
  );

  // Nothing to scope until there is data.
  if (!dataRange || months.length === 0) return null;

  const { min, max } = dataRange;
  const clamp = (p: Period): Period => minPeriod(maxPeriod(p, min), max);

  // The dropdowns always show a concrete selected month. A null bound reads as
  // the open edge of the data (min for From, max for To), so "all time" shows
  // the full span while the emitted range stays null/null (non-regression).
  const fromValue = periodToString(range.from ?? min);
  const toValue = periodToString(range.to ?? max);

  // Preset windows, clamped to the available data so the selects stay valid.
  const presets: { id: string; label: string; range: PeriodRange }[] = [
    { id: 'all-time', label: 'All time', range: { from: null, to: null } },
    {
      id: 'this-year',
      label: 'This year',
      range: { from: clamp({ year: max.year, month: 1 }), to: clamp({ year: max.year, month: 12 }) },
    },
    {
      id: 'last-12m',
      label: 'Last 12 months',
      range: { from: clamp(addMonths(max, -11)), to: max },
    },
  ];

  const isAllTime = range.from === null && range.to === null;

  // At most ONE preset pill highlights. Some data shapes make two presets
  // resolve to the same {from,to} (e.g. a workspace whose data sits inside one
  // calendar year, where "This year" and "Last 12 months" both clamp to the
  // full span). Pick the first preset in declaration order whose exact range
  // equals the current range, so "This year" deterministically wins over "Last
  // 12 months". "All time" ({from:null,to:null}) only matches the true default.
  const activePresetId = presets.find((p) => rangeEquals(range, p.range))?.id ?? null;

  function handleFromChange(value: string) {
    const from = parsePeriodString(value);
    if (!from) return;
    let to = range.to ?? max;
    if (ordinal(from) > ordinal(to)) to = from;
    onRangeChange({ from, to });
  }

  function handleToChange(value: string) {
    const to = parsePeriodString(value);
    if (!to) return;
    let from = range.from ?? min;
    if (ordinal(to) < ordinal(from)) from = to;
    onRangeChange({ from, to });
  }

  return (
    <div
      className="flex items-center gap-x-4 gap-y-2 flex-wrap"
      data-testid="date-range-control"
    >
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
        Date range
      </span>

      {/* From / To native selects */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
          From
        </label>
        <select
          value={fromValue}
          onChange={(e) => handleFromChange(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm font-medium"
          style={SELECT_STYLE}
          data-testid="date-range-from"
          aria-label="Range start month"
        >
          {months.map((m) => (
            <option key={periodToString(m)} value={periodToString(m)}>
              {periodLabel(m)}
            </option>
          ))}
        </select>

        <label className="text-xs font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
          To
        </label>
        <select
          value={toValue}
          onChange={(e) => handleToChange(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm font-medium"
          style={SELECT_STYLE}
          data-testid="date-range-to"
          aria-label="Range end month"
        >
          {months.map((m) => (
            <option key={periodToString(m)} value={periodToString(m)}>
              {periodLabel(m)}
            </option>
          ))}
        </select>
      </div>

      {/* Quick presets */}
      <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'hsl(var(--muted))' }}>
        {presets.map((p) => {
          const active = p.id === activePresetId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onRangeChange(p.range)}
              data-testid={`date-range-preset-${p.id}`}
              className="px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap"
              style={{
                background: active ? 'hsl(var(--primary))' : 'transparent',
                color: active ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Reset — returns to the byte-identical all-time default */}
      {!isAllTime && (
        <button
          type="button"
          onClick={() => onRangeChange({ from: null, to: null })}
          data-testid="date-range-reset"
          className="text-xs font-medium underline underline-offset-2"
          style={{ color: 'hsl(var(--primary))' }}
        >
          Reset
        </button>
      )}
    </div>
  );
}
