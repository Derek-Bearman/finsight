/**
 * Period utilities — periods are first-class objects, not strings.
 * All functions are pure and have no side effects.
 */

import type { Period } from '@/types';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTH_NAMES_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── Constructors ────────────────────────────────────────────────────────────

export function period(year: number, month: number): Period {
  return { year, month };
}

export function periodFromDate(date: Date): Period {
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function currentPeriod(): Period {
  return periodFromDate(new Date());
}

// ─── Arithmetic ──────────────────────────────────────────────────────────────

export function addMonths(p: Period, months: number): Period {
  const totalMonths = (p.year * 12 + (p.month - 1)) + months;
  return {
    year: Math.floor(totalMonths / 12),
    month: (totalMonths % 12) + 1,
  };
}

export function subtractMonths(p: Period, months: number): Period {
  return addMonths(p, -months);
}

export function monthsBetween(from: Period, to: Period): number {
  return (to.year * 12 + (to.month - 1)) - (from.year * 12 + (from.month - 1));
}

// ─── Comparison ──────────────────────────────────────────────────────────────

export function isBefore(a: Period, b: Period): boolean {
  if (a.year !== b.year) return a.year < b.year;
  return a.month < b.month;
}

export function isAfter(a: Period, b: Period): boolean {
  return isBefore(b, a);
}

export function isEqual(a: Period, b: Period): boolean {
  return a.year === b.year && a.month === b.month;
}

export function isBeforeOrEqual(a: Period, b: Period): boolean {
  return !isAfter(a, b);
}

export function isAfterOrEqual(a: Period, b: Period): boolean {
  return !isBefore(a, b);
}

export function minPeriod(a: Period, b: Period): Period {
  return isBefore(a, b) ? a : b;
}

export function maxPeriod(a: Period, b: Period): Period {
  return isAfter(a, b) ? a : b;
}

// ─── Range ───────────────────────────────────────────────────────────────────

/** Returns all periods (inclusive) between start and end */
export function periodRange(start: Period, end: Period): Period[] {
  const result: Period[] = [];
  let current = start;
  while (isBeforeOrEqual(current, end)) {
    result.push(current);
    current = addMonths(current, 1);
  }
  return result;
}

// ─── Quarter ─────────────────────────────────────────────────────────────────

/** Returns 1–4 */
export function getQuarter(p: Period): number {
  return Math.ceil(p.month / 3);
}

/** Returns the first month of the quarter containing the given period */
export function quarterStart(p: Period): Period {
  const q = getQuarter(p);
  return { year: p.year, month: (q - 1) * 3 + 1 };
}

/** Returns the last month of the quarter containing the given period */
export function quarterEnd(p: Period): Period {
  const q = getQuarter(p);
  return { year: p.year, month: q * 3 };
}

// ─── Fiscal Year ─────────────────────────────────────────────────────────────

/** Get fiscal year label for a period given the fiscal year start month */
export function getFiscalYear(p: Period, fiscalYearStart: number): number {
  if (fiscalYearStart === 1) return p.year;
  // If the month is in the "new" fiscal year (on or after fiscal start), it's the next FY
  if (p.month >= fiscalYearStart) return p.year + 1;
  return p.year;
}

/** Get all periods in a given fiscal year */
export function fiscalYearPeriods(fiscalYear: number, fiscalYearStart: number): Period[] {
  if (fiscalYearStart === 1) {
    return periodRange({ year: fiscalYear, month: 1 }, { year: fiscalYear, month: 12 });
  }
  const start: Period = { year: fiscalYear - 1, month: fiscalYearStart };
  const endMonth = fiscalYearStart - 1 === 0 ? 12 : fiscalYearStart - 1;
  const endYear = fiscalYearStart === 1 ? fiscalYear : fiscalYear;
  const end: Period = { year: endYear, month: endMonth };
  return periodRange(start, end);
}

// ─── Labels ──────────────────────────────────────────────────────────────────

/** "Jan 2024" */
export function periodLabel(p: Period): string {
  return `${MONTH_NAMES[p.month - 1]} ${p.year}`;
}

/** "January 2024" */
export function periodLabelFull(p: Period): string {
  return `${MONTH_NAMES_FULL[p.month - 1]} ${p.year}`;
}

/** "Q1 2024" */
export function quarterLabel(p: Period): string {
  return `Q${getQuarter(p)} ${p.year}`;
}

/** "FY2024" */
export function fiscalYearLabel(fiscalYear: number): string {
  return `FY${fiscalYear}`;
}

/** Sort key for ordering periods chronologically */
export function periodSortKey(p: Period): number {
  return p.year * 100 + p.month;
}

/** Sort an array of periods chronologically */
export function sortPeriods(periods: Period[]): Period[] {
  return [...periods].sort((a, b) => periodSortKey(a) - periodSortKey(b));
}

// ─── Serialization ───────────────────────────────────────────────────────────

/** "2024-01" */
export function periodToString(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** Parse "2024-01" or "Jan 2024" or "01/2024" */
export function parsePeriodString(s: string): Period | null {
  // "2024-01"
  const iso = s.match(/^(\d{4})-(\d{2})$/);
  if (iso) return { year: parseInt(iso[1]), month: parseInt(iso[2]) };

  // "01/2024"
  const slash = s.match(/^(\d{2})\/(\d{4})$/);
  if (slash) return { year: parseInt(slash[2]), month: parseInt(slash[1]) };

  // "Jan 2024" or "January 2024"
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    const short = new RegExp(`^${MONTH_NAMES[i]}\\s+(\\d{4})$`, 'i');
    const full = new RegExp(`^${MONTH_NAMES_FULL[i]}\\s+(\\d{4})$`, 'i');
    const matchShort = s.match(short);
    if (matchShort) return { year: parseInt(matchShort[1]), month: i + 1 };
    const matchFull = s.match(full);
    if (matchFull) return { year: parseInt(matchFull[1]), month: i + 1 };
  }

  return null;
}
