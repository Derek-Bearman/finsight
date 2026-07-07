'use client';

import React from 'react';
import type { MetricFormat, BenchmarkRange } from '@/types';
import { formatMetricValue } from '@/lib/utils/format';

export interface MetricRowProps {
  label: string;
  sublabel?: string;
  values: (number | null)[];
  format: MetricFormat;
  isHighlight?: boolean;
  isSubtotal?: boolean;
  isSeparator?: boolean;
  showChange?: boolean;
  invertChange?: boolean;
  benchmark?: BenchmarkRange;
  /** Compact cells so the table fits a fixed-width (print) page. */
  dense?: boolean;
}

function getBenchmarkColor(
  value: number | null,
  benchmark: BenchmarkRange
): string {
  if (value === null) return 'hsl(var(--foreground))';
  const { good, warn, bad, direction } = benchmark;
  if (direction === 'higher') {
    if (value >= good) return 'hsl(142 71% 45%)';
    if (value >= warn) return 'hsl(38 92% 50%)';
    return 'hsl(0 84% 60%)';
  } else {
    // lower is better
    if (value <= good) return 'hsl(142 71% 45%)';
    if (value <= warn) return 'hsl(38 92% 50%)';
    return 'hsl(0 84% 60%)';
  }
}

function ChangeIndicator({
  current,
  previous,
  format,
  invert,
}: {
  current: number | null;
  previous: number | null;
  format: MetricFormat;
  invert: boolean;
}) {
  if (current === null || previous === null) return <span style={{ color: 'hsl(var(--muted-foreground))' }}>—</span>;
  const delta = current - previous;
  if (delta === 0) return <span style={{ color: 'hsl(var(--muted-foreground))' }}>—</span>;

  const positive = invert ? delta < 0 : delta > 0;
  const color = positive ? 'hsl(142 71% 45%)' : 'hsl(0 84% 60%)';
  const arrow = delta > 0 ? '↑' : '↓';
  const absVal = Math.abs(delta);

  let displayStr: string;
  if (format === 'percent') {
    displayStr = `${(absVal * 100).toFixed(1)}pp`;
  } else if (format === 'currency') {
    displayStr = formatMetricValue(absVal, 'currency');
  } else {
    displayStr = formatMetricValue(absVal, format);
  }

  return (
    <span className="text-xs font-medium" style={{ color }}>
      {arrow} {displayStr}
    </span>
  );
}

export function MetricRow(props: MetricRowProps) {
  const {
    label,
    sublabel,
    values,
    format,
    isHighlight,
    isSubtotal,
    isSeparator,
    showChange,
    invertChange = false,
    benchmark,
    dense = false,
  } = props;
  const cellClass = dense ? 'px-1 py-1 text-xs' : 'px-3 py-2 text-sm';

  if (isSeparator) {
    return (
      <tr>
        <td
          colSpan={values.length + 2}
          style={{ borderBottom: '1px solid hsl(var(--border))', padding: '2px 0' }}
        />
      </tr>
    );
  }

  const fontWeight = isHighlight ? 700 : isSubtotal ? 400 : 400;
  const labelColor = isHighlight
    ? 'hsl(var(--foreground))'
    : isSubtotal
    ? 'hsl(var(--muted-foreground))'
    : 'hsl(var(--foreground))';
  const rowBg = isHighlight ? 'hsl(var(--muted) / 0.4)' : 'transparent';
  // The sticky label column MUST be fully opaque or the horizontally-scrolled
  // value columns show through underneath it. For highlight rows we composite
  // the semi-transparent tint over an opaque card so it still matches the row.
  const stickyBg = isHighlight
    ? 'linear-gradient(hsl(var(--muted) / 0.4), hsl(var(--muted) / 0.4)), hsl(var(--card))'
    : 'hsl(var(--card))';

  const current = values.length > 0 ? values[values.length - 1] ?? null : null;
  const previous = values.length > 1 ? values[values.length - 2] ?? null : null;

  return (
    <tr style={{ background: rowBg }}>
      {/* Label column */}
      <td
        className={cellClass}
        style={{
          paddingLeft: isSubtotal ? (dense ? '1rem' : '1.5rem') : (dense ? '0.375rem' : '0.75rem'),
          fontWeight,
          color: labelColor,
          position: 'sticky',
          left: 0,
          background: stickyBg,
          borderRight: '1px solid hsl(var(--border))',
          zIndex: 1,
          minWidth: dense ? '120px' : '180px',
          maxWidth: dense ? '150px' : '240px',
        }}
      >
        {label}
        {sublabel && (
          <div className="text-xs font-normal" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {sublabel}
          </div>
        )}
      </td>

      {/* Value columns */}
      {values.map((v, i) => {
        const valueColor = benchmark
          ? getBenchmarkColor(v, benchmark)
          : isHighlight
          ? 'hsl(var(--foreground))'
          : 'hsl(var(--foreground))';

        return (
          <td
            key={i}
            className={`${cellClass} text-right`}
            style={{
              fontWeight,
              color: valueColor,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {v === null ? '—' : formatMetricValue(v, format)}
          </td>
        );
      })}

      {/* Change column */}
      {showChange && (
        <td className={`${cellClass} text-right`} style={{ whiteSpace: 'nowrap' }}>
          <ChangeIndicator
            current={current}
            previous={previous}
            format={format}
            invert={invertChange}
          />
        </td>
      )}
    </tr>
  );
}
