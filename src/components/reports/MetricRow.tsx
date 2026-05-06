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
  } = props;

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
  const labelPaddingLeft = isSubtotal ? '1.5rem' : '0';
  const labelColor = isHighlight
    ? 'hsl(var(--foreground))'
    : isSubtotal
    ? 'hsl(var(--muted-foreground))'
    : 'hsl(var(--foreground))';
  const rowBg = isHighlight ? 'hsl(var(--muted) / 0.4)' : 'transparent';

  const current = values.length > 0 ? values[values.length - 1] ?? null : null;
  const previous = values.length > 1 ? values[values.length - 2] ?? null : null;

  return (
    <tr style={{ background: rowBg }}>
      {/* Label column */}
      <td
        className="px-3 py-2 text-sm"
        style={{
          paddingLeft: isSubtotal ? '1.5rem' : '0.75rem',
          fontWeight,
          color: labelColor,
          position: 'sticky',
          left: 0,
          background: rowBg || 'hsl(var(--card))',
          zIndex: 1,
          minWidth: '180px',
          maxWidth: '240px',
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
            className="px-3 py-2 text-sm text-right"
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
        <td className="px-3 py-2 text-sm text-right" style={{ whiteSpace: 'nowrap' }}>
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
