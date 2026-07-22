/**
 * PURE sync chunk planning — no I/O, no env, unit-testable headlessly. The
 * plan (§1 "Data API") mandates chunking multi-year report pulls ONE CALENDAR
 * YEAR PER CALL (12-13 monthly columns) to stay under the 400,000-cell cap and
 * the ~25-column 504 risk. This module computes those chunks; per-chunk
 * orchestration lives in `src/lib/data/qbo-actions.ts` (v1 sync is
 * client-driven — plan §2.2), which fetches raw reports chunk-by-chunk while
 * the CLIENT accumulates and runs the pure transform once at the end.
 *
 * Dates are computed in UTC so planning is deterministic regardless of the
 * server's timezone (Workers run UTC anyway).
 */

export interface QboSyncChunk {
  year: number;
  /** YYYY-MM-DD — always Jan 1 of the chunk year. */
  startDate: string;
  /** YYYY-MM-DD — Dec 31, except the current year ends at the last day of
   *  the CURRENT month (future months have no data to report). */
  endDate: string;
}

export const QBO_SYNC_YEARS_BACK_DEFAULT = 3;
export const QBO_SYNC_YEARS_BACK_MIN = 1;
export const QBO_SYNC_YEARS_BACK_MAX = 10;

/** Clamp a caller-supplied yearsBack into [1, 10]; undefined/NaN → default 3.
 *  Fractions truncate (2.9 → 2) before clamping. */
export function clampYearsBack(yearsBack: number | undefined): number {
  if (yearsBack === undefined || !Number.isFinite(yearsBack)) {
    return QBO_SYNC_YEARS_BACK_DEFAULT;
  }
  return Math.min(
    QBO_SYNC_YEARS_BACK_MAX,
    Math.max(QBO_SYNC_YEARS_BACK_MIN, Math.trunc(yearsBack))
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Last day of a month (1-based), leap-year aware: day 0 of the NEXT month. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Calendar-year chunks from (currentYear - yearsBack + 1) through currentYear,
 * oldest first. The current year's chunk ends at the last day of the current
 * month (UTC).
 */
export function planSyncChunks(now: Date, yearsBack?: number): QboSyncChunk[] {
  const span = clampYearsBack(yearsBack);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const chunks: QboSyncChunk[] = [];
  for (let year = currentYear - span + 1; year <= currentYear; year++) {
    const endMonth = year === currentYear ? currentMonth : 12;
    chunks.push({
      year,
      startDate: `${year}-01-01`,
      endDate: `${year}-${pad2(endMonth)}-${pad2(lastDayOfMonth(year, endMonth))}`,
    });
  }
  return chunks;
}
