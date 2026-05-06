/**
 * Centralized formatting utilities.
 * All currency displayed using accounting convention: negatives as ($1,234), not -$1,234.
 */

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const currencyFormatterCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/**
 * Format a number as currency using accounting convention.
 * Negative values are shown as ($1,234) rather than -$1,234.
 */
export function formatCurrency(value: number, cents = false): string {
  if (!isFinite(value)) return '—';
  const formatter = cents ? currencyFormatterCents : currencyFormatter;
  if (value < 0) {
    return `(${formatter.format(Math.abs(value))})`;
  }
  return formatter.format(value);
}

/** Format as percentage: 0.1234 → "12.3%" */
export function formatPercent(value: number, decimals = 1): string {
  if (!isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Format as a plain number with optional decimal places */
export function formatNumber(value: number, decimals = 1): string {
  if (!isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Format as a ratio (e.g. 1.8x) */
export function formatRatio(value: number): string {
  if (!isFinite(value)) return '—';
  return `${numberFormatter.format(value)}×`;
}

/** Format as days (e.g. 32 days) */
export function formatDays(value: number): string {
  if (!isFinite(value)) return '—';
  return `${Math.round(value)} days`;
}

import type { MetricFormat } from '@/types';

/** Universal dispatcher — format any metric value given its format type */
export function formatMetricValue(value: number | null, format: MetricFormat): string {
  if (value === null || !isFinite(value)) return '—';
  switch (format) {
    case 'currency': return formatCurrency(value);
    case 'percent':  return formatPercent(value);
    case 'ratio':    return formatRatio(value);
    case 'days':     return formatDays(value);
    case 'number':   return formatNumber(value);
    default:         return String(value);
  }
}

/** Direction indicator for period-over-period changes */
export function formatChange(value: number, isPercent = false): string {
  if (!isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  if (isPercent) return `${sign}${formatPercent(value)}`;
  return `${sign}${formatCurrency(value)}`;
}
