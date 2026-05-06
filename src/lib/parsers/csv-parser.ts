/**
 * CSV parser for QuickBooks Online exports.
 * Built on PapaParse. Pure functions, no React, no side effects.
 * Handles QBO-specific quirks: indentation, parenthetical negatives, period columns, totals rows.
 */

import Papa from 'papaparse';
import type { Period, StatementType } from '@/types';

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

export interface ColumnMapping {
  /** Header string of the account name column, or null if not found. */
  accountNameColumn: string | null;
  /** Header string of the account number column, or null if absent. */
  accountNumberColumn: string | null;
  /** All columns whose headers match a recognised period pattern. */
  periodColumns: Array<{ header: string; period: Period }>;
  /** Column indices that could not be mapped to any role. */
  unmappedCols?: number[];
}

export interface ParsedRow {
  accountName: string;
  accountNumber?: string;
  /** 0 = top-level, 1 = first child, etc. — derived from leading spaces in QBO export. */
  indentLevel: number;
  /** Map of period key (e.g. "2024-01") → parsed amount. */
  values: Record<string, number>;
  /** Allow indexing by arbitrary string keys (e.g. raw header names for preview tables). */
  [key: string]: unknown;
}

// ─────────────────────────────────────────────
// Number parsing
// ─────────────────────────────────────────────

/**
 * Parses an amount string from a QBO CSV cell into a JavaScript number.
 *
 * Handles:
 * - Empty string / whitespace → 0
 * - Dollar signs: "$1,234.56" → 1234.56
 * - Parenthetical negatives: "(1,234.56)" → -1234.56
 * - Dollar + parenthetical: "$(1,234)" → -1234
 * - Plain numbers: "-1234.56" → -1234.56
 * - Zero: "0.00" → 0
 *
 * @param raw - The raw string value from a CSV cell.
 * @returns The parsed numeric value.
 */
export function parseAmount(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-') return 0;

  // Detect negative via parentheses (before or after dollar sign)
  const isNegative = trimmed.startsWith('(') || trimmed.startsWith('$(');

  // Strip dollar signs, commas, parentheses
  const cleaned = trimmed
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/[()]/g, '')
    .trim();

  const value = parseFloat(cleaned);
  if (isNaN(value)) return 0;

  return isNegative ? -Math.abs(value) : value;
}

// ─────────────────────────────────────────────
// Period header patterns
// ─────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Generates a canonical period key string "YYYY-MM" from a Period. */
function periodKey(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/**
 * Parses a column header into a Period.
 * Returns null if the header is not a recognised single-month period format.
 *
 * Supported single-month formats:
 * - "Jan 2024" / "Jan-2024"
 * - "Jan-24" / "Jan 24" (short year)
 * - "01/2024"
 * - "2024-01"
 *
 * Note: quarterly ("Q1 2024") and annual ("FY2024") formats are handled by
 * `expandPeriodHeader` and return null here because they represent multiple months.
 *
 * @param header - The raw column header string.
 * @returns A Period if single-month, null if unrecognised or multi-month.
 */
export function parsePeriodHeader(header: string): Period | null {
  const h = header.trim();

  // "Jan 2024" or "Jan-2024"
  const longMonthYear = h.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s-]+(\d{4})$/i);
  if (longMonthYear) {
    const month = MONTH_NAMES[longMonthYear[1]!.toLowerCase()];
    const year = parseInt(longMonthYear[2]!, 10);
    if (month !== undefined) return { year, month };
  }

  // "Jan-24" or "Jan 24" (short year)
  const shortMonthYear = h.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-\s](\d{2})$/i);
  if (shortMonthYear) {
    const month = MONTH_NAMES[shortMonthYear[1]!.toLowerCase()];
    const shortYear = parseInt(shortMonthYear[2]!, 10);
    const year = shortYear >= 50 ? 1900 + shortYear : 2000 + shortYear;
    if (month !== undefined) return { year, month };
  }

  // "01/2024"
  const mmyyyy = h.match(/^(\d{2})\/(\d{4})$/);
  if (mmyyyy) {
    const month = parseInt(mmyyyy[1]!, 10);
    const year = parseInt(mmyyyy[2]!, 10);
    if (month >= 1 && month <= 12) return { year, month };
  }

  // "2024-01"
  const yyyymm = h.match(/^(\d{4})-(\d{2})$/);
  if (yyyymm) {
    const year = parseInt(yyyymm[1]!, 10);
    const month = parseInt(yyyymm[2]!, 10);
    if (month >= 1 && month <= 12) return { year, month };
  }

  return null;
}

/** Describes an expanded period column: one or more months with a divisor for the amount. */
interface ExpandedPeriod {
  /** First period (representative, used for column mapping display). */
  firstPeriod: Period;
  periods: Period[];
  /** Each expanded month's share = amount / divisor */
  divisor: number;
}

/**
 * Expands a column header into one or more Period entries.
 * Quarterly headers expand to 3 months, annual (FY) to 12 months.
 * Returns null if the header is not a recognised period format.
 */
function expandPeriodHeader(header: string): ExpandedPeriod | null {
  const h = header.trim();

  // Try single-month formats first
  const single = parsePeriodHeader(h);
  if (single) {
    return { firstPeriod: single, periods: [single], divisor: 1 };
  }

  // "Q1 2024", "Q2 2024", …
  const quarterly = h.match(/^Q([1-4])\s+(\d{4})$/i);
  if (quarterly) {
    const q = parseInt(quarterly[1]!, 10);
    const year = parseInt(quarterly[2]!, 10);
    const startMonth = (q - 1) * 3 + 1;
    const periods: Period[] = [
      { year, month: startMonth },
      { year, month: startMonth + 1 },
      { year, month: startMonth + 2 },
    ];
    return { firstPeriod: periods[0]!, periods, divisor: 3 };
  }

  // "FY2024"
  const annual = h.match(/^FY(\d{4})$/i);
  if (annual) {
    const year = parseInt(annual[1]!, 10);
    const periods: Period[] = Array.from({ length: 12 }, (_, i) => ({
      year,
      month: i + 1,
    }));
    return { firstPeriod: periods[0]!, periods, divisor: 12 };
  }

  return null;
}

// ─────────────────────────────────────────────
// Column auto-detection
// ─────────────────────────────────────────────

/**
 * Auto-detects the column roles from an array of CSV header strings.
 *
 * Heuristics:
 * - accountNameColumn: first column matching "Account", "Name", "Description"; fallback = first header.
 * - accountNumberColumn: column matching "Acct #", "Account #", "Number", "Code".
 * - periodColumns: all columns whose headers match a recognised period format.
 * - unmappedCols: column indices that could not be mapped.
 *
 * @param headers - Array of raw column header strings.
 * @returns A ColumnMapping describing the role of each column.
 */
export function detectColumnMapping(headers: string[]): ColumnMapping {
  const NAME_PATTERNS = /^(account|name|description)$/i;
  const NUMBER_PATTERNS = /^(acct\s*#|account\s*#|number|code)$/i;

  let accountNameColumn: string | null = null;
  let accountNumberColumn: string | null = null;
  const periodColumns: Array<{ header: string; period: Period }> = [];
  const usedIndices = new Set<number>();

  // First pass: find name and number columns
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] ?? '').trim();
    if (accountNameColumn === null && NAME_PATTERNS.test(h)) {
      accountNameColumn = h;
      usedIndices.add(i);
    } else if (accountNumberColumn === null && NUMBER_PATTERNS.test(h)) {
      accountNumberColumn = h;
      usedIndices.add(i);
    }
  }

  // If no name column found, default to first header
  if (accountNameColumn === null && headers.length > 0) {
    accountNameColumn = (headers[0] ?? '').trim();
    usedIndices.add(0);
  }

  // Second pass: identify period columns
  for (let i = 0; i < headers.length; i++) {
    if (usedIndices.has(i)) continue;
    const h = (headers[i] ?? '').trim();
    const expanded = expandPeriodHeader(h);
    if (expanded) {
      periodColumns.push({ header: h, period: expanded.firstPeriod });
      usedIndices.add(i);
    }
  }

  // Everything else is unmapped
  const unmappedCols: number[] = [];
  for (let i = 0; i < headers.length; i++) {
    if (!usedIndices.has(i)) unmappedCols.push(i);
  }

  return { accountNameColumn, accountNumberColumn, periodColumns, unmappedCols };
}

// ─────────────────────────────────────────────
// Totals row detection
// ─────────────────────────────────────────────

/** Returns true if the account name looks like a QBO totals/subtotal row that should be skipped. */
function isTotalsRow(name: string): boolean {
  return /^\s*(total|subtotal|net|grand\s+total)\b/i.test(name);
}

// ─────────────────────────────────────────────
// Indent level detection
// ─────────────────────────────────────────────

/**
 * Counts the indentation depth from leading spaces in a QBO account name.
 * QBO uses 2 spaces per indent level.
 */
function measureIndentLevel(raw: string): number {
  const leading = raw.match(/^(\s*)/)?.[1] ?? '';
  return Math.floor(leading.length / 2);
}

// ─────────────────────────────────────────────
// Statement type detection
// ─────────────────────────────────────────────

/**
 * Heuristically detects the statement type from parsed row names and headers.
 * Returns null if detection is inconclusive.
 */
function detectStatementType(
  accountNames: string[],
  headers: string[],
): StatementType | null {
  const namesLower = accountNames.map((n) => n.toLowerCase());
  const headersLower = headers.map((h) => h.toLowerCase());

  const bsKeywords = ['assets', 'liabilities', 'equity'];
  if (namesLower.some((n) => bsKeywords.some((k) => n.includes(k)))) {
    return 'balance_sheet';
  }

  const hasPeriodHeader = headersLower.some((h) => expandPeriodHeader(h) !== null);
  if (hasPeriodHeader) return 'pnl';

  return 'coa';
}

// ─────────────────────────────────────────────
// Public ParseResult type
// ─────────────────────────────────────────────

export interface ParseResult {
  rows: ParsedRow[];
  columnMapping: ColumnMapping;
  detectedStatementType: StatementType | null;
  rawHeaders: string[];
  warnings: string[];
}

// ─────────────────────────────────────────────
// Main parser
// ─────────────────────────────────────────────

/**
 * Parses a QuickBooks Online CSV export into structured rows.
 *
 * Handles QBO quirks:
 * - Trailing totals/subtotal rows are skipped.
 * - Leading spaces in account names indicate sub-account depth.
 * - Parenthetical negatives and dollar signs in amounts are parsed correctly.
 * - Period columns (monthly, quarterly, annual) are detected and amounts distributed.
 * - Quarterly amounts are split evenly across 3 months; annual across 12 months.
 *
 * @param csvText       - The raw CSV string.
 * @param statementType - Optional override; auto-detected if omitted.
 * @returns A ParseResult with rows, column mapping, detected statement type, headers, and warnings.
 */
export function parseCSV(csvText: string, statementType?: StatementType): ParseResult {
  const warnings: string[] = [];

  const parsed = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
    header: false,
  });

  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) {
      warnings.push(`CSV parse error at row ${err.row ?? '?'}: ${err.message}`);
    }
  }

  const data = parsed.data as string[][];
  if (data.length === 0) {
    return {
      rows: [],
      columnMapping: {
        accountNameColumn: null,
        accountNumberColumn: null,
        periodColumns: [],
        unmappedCols: [],
      },
      detectedStatementType: statementType ?? null,
      rawHeaders: [],
      warnings,
    };
  }

  // First row is headers
  const rawHeaders: string[] = (data[0] ?? []).map((h) => String(h ?? '').trim());
  const dataRows = data.slice(1);

  const columnMapping = detectColumnMapping(rawHeaders);
  const { accountNameColumn, accountNumberColumn } = columnMapping;

  // Build index lookups for header → column index
  const headerToIndex = new Map<string, number>();
  for (let i = 0; i < rawHeaders.length; i++) {
    headerToIndex.set(rawHeaders[i] ?? '', i);
  }

  const nameColIndex = accountNameColumn !== null ? (headerToIndex.get(accountNameColumn) ?? null) : null;
  const numberColIndex = accountNumberColumn !== null ? (headerToIndex.get(accountNumberColumn) ?? null) : null;

  // Build a richer period column map (with full expansion info) for amount distribution
  interface RichPeriodCol {
    colIndex: number;
    periods: Period[];
    divisor: number;
  }
  const richPeriodCols: RichPeriodCol[] = [];
  for (let i = 0; i < rawHeaders.length; i++) {
    const h = rawHeaders[i] ?? '';
    const expanded = expandPeriodHeader(h);
    if (expanded) {
      richPeriodCols.push({ colIndex: i, ...expanded });
    }
  }

  const rows: ParsedRow[] = [];

  for (const row of dataRows) {
    // Skip blank rows
    if (row.every((cell) => String(cell ?? '').trim() === '')) continue;

    const rawName = nameColIndex !== null ? String(row[nameColIndex] ?? '') : '';
    const trimmedName = rawName.trim();

    // Skip blank account names
    if (trimmedName === '') continue;

    // Skip totals/subtotal rows
    if (isTotalsRow(trimmedName)) continue;

    const indentLevel = measureIndentLevel(rawName);

    const accountNumber =
      numberColIndex !== null && row[numberColIndex] !== undefined
        ? String(row[numberColIndex]).trim() || undefined
        : undefined;

    // Build values map: period key → amount
    const values: Record<string, number> = {};

    for (const { colIndex, periods, divisor } of richPeriodCols) {
      const raw = String(row[colIndex] ?? '').trim();
      if (raw === '') continue;
      const total = parseAmount(raw);
      const perMonth = divisor > 1 ? total / divisor : total;
      for (const p of periods) {
        const key = periodKey(p);
        values[key] = (values[key] ?? 0) + perMonth;
      }
    }

    // Also populate the row with raw cell values keyed by header name,
    // so the preview table in ColumnMappingPreview can index by `row[header]`.
    const parsedRow: ParsedRow = {
      accountName: trimmedName,
      indentLevel,
      values,
    };
    if (accountNumber !== undefined) {
      parsedRow.accountNumber = accountNumber;
    }

    // Populate header-keyed cells for the preview table
    for (let i = 0; i < rawHeaders.length; i++) {
      const header = rawHeaders[i];
      if (header !== undefined && header !== '') {
        parsedRow[header] = String(row[i] ?? '');
      }
    }

    rows.push(parsedRow);
  }

  // Detect statement type if not provided
  const detectedStatementType: StatementType | null =
    statementType ??
    detectStatementType(
      rows.map((r) => r.accountName),
      rawHeaders,
    );

  return {
    rows,
    columnMapping,
    detectedStatementType,
    rawHeaders,
    warnings,
  };
}
