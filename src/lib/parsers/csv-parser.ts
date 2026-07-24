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
  /**
   * Statement section this row sits under, derived by tracking section
   * header rows (ASSETS, LIABILITIES, EQUITY, Income, COGS, Expenses)
   * as the parser walks the document. Used by the classifier to
   * disambiguate keyword-matched accounts (e.g. "Customer Deposits"
   * keyword-matches 'deposits'→asset but is a liability when it appears
   * under a LIABILITIES section).
   */
  section?: 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense';
  /** Allow indexing by arbitrary string keys (e.g. raw header names for preview tables). */
  [key: string]: unknown;
}

// ─────────────────────────────────────────────
// Section tracking
// ─────────────────────────────────────────────

type Section = 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense';

/**
 * Maps a (lowercased, trimmed) account name to the statement section
 * it implies, when that name appears as a section header.
 *
 * Includes common QBO and accounting-model section headings.
 */
const SECTION_FROM_NAME: Record<string, Section> = {
  // Balance sheet
  'assets': 'asset',
  'current assets': 'asset',
  'fixed assets': 'asset',
  'other assets': 'asset',
  'other current assets': 'asset',
  'bank accounts': 'asset',
  'property, plant & equipment': 'asset',
  'property plant & equipment': 'asset',
  'property plant and equipment': 'asset',
  'liabilities': 'liability',
  'current liabilities': 'liability',
  'long-term liabilities': 'liability',
  'long term liabilities': 'liability',
  'other current liabilities': 'liability',
  'credit cards': 'liability',
  'equity': 'equity',
  'stockholders equity': 'equity',
  "stockholders' equity": 'equity',
  "stockholder's equity": 'equity',
  "shareholders' equity": 'equity',
  "shareholder's equity": 'equity',
  'members equity': 'equity',
  "member's equity": 'equity',
  // P&L
  'income': 'revenue',
  'revenue': 'revenue',
  'sales': 'revenue',
  'other income': 'revenue',
  'cost of goods sold': 'cogs',
  'cogs': 'cogs',
  'expenses': 'expense',
  'expense': 'expense',
  'operating expenses': 'expense',
  'other expenses': 'expense',
  'other expense': 'expense',
};

/**
 * If `name` is a recognised section-header label, returns the section it
 * implies. Otherwise returns null. Case- and whitespace-insensitive.
 */
function sectionFromName(name: string): Section | null {
  const k = name.trim().toLowerCase();
  return SECTION_FROM_NAME[k] ?? null;
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
  // Strip ALL whitespace including tabs (QBO sometimes exports "$ \t72,500.00")
  const trimmed = raw.replace(/[\t\r\n]/g, ' ').trim();
  if (trimmed === '' || trimmed === '-') return 0;

  // Detect negative via parentheses (before or after dollar sign) OR a trailing
  // minus ("1,234-"), the convention some non-QBO accounting exports use.
  // (Leading-minus is preserved by parseFloat; trailing-minus is not.)
  const isNegative =
    (/[($]/.test(trimmed.slice(0, 2)) && trimmed.includes('(')) || /-\s*$/.test(trimmed);

  // Strip dollar signs, commas, parentheses, spaces, tabs
  const cleaned = trimmed
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, '') // strip any remaining whitespace including tabs between $ and number
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

  // Abbreviated OR full month name + year. Matches "Jan 2024", "January 2024",
  // "Sept 2024", "Jan-2024". The .slice(0,3) lookup maps every variant to the
  // canonical 3-letter key. XLSX date-typed headers rendered "mmmm yyyy" land here.
  const MONTH_WORD = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

  // "Jan 2024" / "January 2024" / "Jan-2024"
  const longMonthYear = h.match(new RegExp(`^${MONTH_WORD}[\\s-]+(\\d{4})$`, 'i'));
  if (longMonthYear) {
    const month = MONTH_NAMES[longMonthYear[1]!.slice(0, 3).toLowerCase()];
    const year = parseInt(longMonthYear[2]!, 10);
    if (month !== undefined) return { year, month };
  }

  // "Jan-24" / "Jan 24" / "January 24" (short year)
  const shortMonthYear = h.match(new RegExp(`^${MONTH_WORD}[-\\s](\\d{2})$`, 'i'));
  if (shortMonthYear) {
    const month = MONTH_NAMES[shortMonthYear[1]!.slice(0, 3).toLowerCase()];
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

  // Second pass: identify period columns (skip summary columns like 'Total')
  for (let i = 0; i < headers.length; i++) {
    if (usedIndices.has(i)) continue;
    const h = (headers[i] ?? '').trim();
    if (isSummaryColumn(h)) { usedIndices.add(i); continue; }
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

/**
 * Returns true if the account name looks like a QBO totals/subtotal/section-header
 * row that should be skipped.
 *
 * Skips:
 * - "Total for Income", "Total for COGS", etc.
 * - "Net Operating Income", "Net Income", "Gross Profit" (subtotal summary lines)
 * - "Total for Expenses", "Total for Liabilities", etc.
 * - Pure section headers: "Income", "Cost of Goods Sold", "Expenses",
 *   "Assets", "Liabilities", "Equity", "Current Assets", etc.
 *   (rows that are category labels with no account-level data)
 */
function isTotalsRow(name: string): boolean {
  return classifyRowKind(name) !== 'data';
}

type RowKind = 'total' | 'section' | 'data';

// The only "Net …" names that are a real EQUITY LEAF on a balance sheet
// (current-year earnings), not a subtotal. Everything else starting with "Net"
// on a BS (e.g. "Net Fixed Assets") is treated as a total.
const BS_EQUITY_NET_LEAVES = new Set<string>([
  'net income', 'net operating income', 'net earnings',
  'net income (loss)', 'net loss', 'net profit',
]);

// Section-header labels — category groupings, not leaf accounts. Module scope so
// the row loop can also detect a SPANNING header ("Liabilities and Equity") to
// reset the running section (it maps to no single section in SECTION_FROM_NAME).
const SECTION_HEADER_LABELS = new Set<string>([
  'income', 'cost of goods sold', 'cogs', 'expenses', 'expense',
  'other income', 'other expenses', 'other expense',
  'assets', 'current assets', 'fixed assets', 'other assets',
  'liabilities', 'current liabilities', 'long-term liabilities',
  'equity', 'bank accounts', 'other current assets',
  'other current liabilities', 'credit cards',
  'liabilities and equity', 'total liabilities and equity',
  'property, plant & equipment', 'property plant & equipment',
  'property plant and equipment',
  "stockholders' equity", "stockholder's equity",
  'stockholders equity', "shareholders' equity", "shareholder's equity",
  'members equity', "member's equity",
]);

/**
 * More precise version of isTotalsRow that distinguishes:
 *   - 'total'   — subtotal/total/grand-total/net row, always skip
 *   - 'section' — section header label (ASSETS, LIABILITIES, Income, etc.),
 *                 skip ONLY when the row has no actual data values (because
 *                 the same name can appear as both a section header and an
 *                 individual account, e.g. "Other Assets" twice in a BS)
 *   - 'data'    — keep
 *
 * `isBalanceSheet` toggles the 'net' rule: on a P&L, "Net Income"/"Net Operating
 * Income" are summary rows to drop; on a BALANCE SHEET, "Net Income" is a real
 * equity leaf (current-year earnings, present on every QBO balance sheet) and
 * MUST NOT be dropped, or equity is understated and the sheet won't balance.
 */
function classifyRowKind(name: string, isBalanceSheet = false): RowKind {
  const trimmed = name.trim();
  // On a balance sheet, "Net Income" (and family) is a REAL equity leaf
  // (current-year earnings, present on every QBO balance sheet) — keep it.
  // Other "Net X" (e.g. "Net Fixed Assets", "Net PP&E") stay subtotals to drop.
  if (isBalanceSheet && BS_EQUITY_NET_LEAVES.has(trimmed.toLowerCase())) return 'data';
  if (/^(total|subtotal|net|grand\s+total)\b/i.test(trimmed)) return 'total';
  // Explicit QBO P&L summary row names that must always be excluded
  const EXPLICIT_TOTALS = [
    'total revenue', 'total income', 'total expenses', 'total expense',
    'total cost of goods sold', 'total cogs', 'total other income',
    'total other expenses', 'total other expense',
  ];
  if (EXPLICIT_TOTALS.includes(trimmed.toLowerCase())) return 'total';
  if (SECTION_HEADER_LABELS.has(trimmed.toLowerCase())) return 'section';
  return 'data';
}

/**
 * Remove parent rows that merely REPEAT the sum of their children.
 * In QBO exports, a parent category row (lower indentLevel) can restate the sum
 * of its sub-accounts — importing both would double-count.
 *
 * A row immediately followed by a MORE-INDENTED row is only a candidate parent.
 * It is dropped ONLY when it is a genuine rollup: it carries no values of its own
 * (a blank grouping header), OR its per-period values equal the sum of its
 * immediate (indentLevel+1) children. A value-carrying LEAF that just happens to
 * precede a deeper account (e.g. "Undeposited Funds" before "Bank Accounts →
 * Checking", after the zero-value "Bank Accounts" header is filtered) must be
 * KEPT — the old pure-indent heuristic silently dropped it and its amounts,
 * understating the balance sheet.
 */
function deduplicateParentRows(rows: ParsedRow[]): ParsedRow[] {
  if (rows.length === 0) return rows;
  const result: ParsedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const nextRow = rows[i + 1];
    if (nextRow && nextRow.indentLevel > row.indentLevel && isRedundantRollup(row, rows, i)) {
      continue; // drop only a genuine summary parent, never a real leaf
    }
    result.push(row);
  }
  return result;
}

/**
 * True when `rows[i]` is a blank grouping header, or its per-period values equal
 * the sum of its LEAF DESCENDANTS (any depth) that share its section — i.e. a
 * redundant rollup that merely restates its children, safe to drop.
 *
 * Compares against LEAF descendants (not just immediate children) and by
 * RELATIVE depth (not a hardcoded indentLevel+1), so nested groups and any
 * indentation width work. Requires the same section so that, once zero-value
 * section headers are filtered, a cross-section neighbor (e.g. a balance sheet's
 * asset leaf followed by liability/equity rows whose total happens to equal it)
 * is never mistaken for a child. A parent whose value does NOT equal its
 * children's sum is kept — it carries a direct amount of its own, not a pure
 * restatement, and dropping it would lose real data.
 */
function isRedundantRollup(row: ParsedRow, rows: ParsedRow[], i: number): boolean {
  const keys = Object.keys(row.values);
  // Blank / all-zero parent (a pure grouping header) — safe to drop.
  if (keys.length === 0 || keys.every((k) => row.values[k] === 0)) return true;

  const leafSum: Record<string, number> = {};
  let leaves = 0;
  for (let j = i + 1; j < rows.length; j++) {
    const r = rows[j]!;
    if (r.indentLevel <= row.indentLevel) break; // left the parent's block
    // A leaf carries no deeper child (the next row isn't more indented).
    const next = rows[j + 1];
    const isLeaf = !next || next.indentLevel <= r.indentLevel;
    if (isLeaf && r.section === row.section) {
      leaves++;
      for (const [k, v] of Object.entries(r.values)) leafSum[k] = (leafSum[k] ?? 0) + v;
    }
  }
  // No same-section leaf descendants → this is a leaf, not a rollup: keep it.
  if (leaves === 0) return false;

  const EPS = 0.01;
  for (const k of new Set([...keys, ...Object.keys(leafSum)])) {
    if (Math.abs((row.values[k] ?? 0) - (leafSum[k] ?? 0)) > EPS) return false;
  }
  return true;
}

/**
 * Returns true if this column header should be skipped as a non-period summary column.
 * Handles QBO's trailing "Total" column.
 */
function isSummaryColumn(header: string): boolean {
  return /^\s*total\s*$/i.test(header.trim());
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

  // ── Find the real header row ──────────────────────────────────────────────
  // QBO exports often have 2-4 preamble rows (title, company name, date range,
  // blank) before the actual column headers. The real header row is the first
  // row that contains at least one recognisable period-style column (e.g. "Jan-22",
  // "Jan 2024") OR a recognisable account-name header ("Account", "Name", or a
  // blank first cell followed by period-like values in subsequent cells).
  // We scan up to the first 10 rows to find it.
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i] ?? [];
    const periodCells = row.filter((cell) => expandPeriodHeader(String(cell ?? '').trim()) !== null).length;
    const firstCellBlank = String(row[0] ?? '').trim() === '';
    const firstCellIsPeriod = expandPeriodHeader(String(row[0] ?? '').trim()) !== null;
    const secondCellIsPeriod = row.length > 1 && expandPeriodHeader(String(row[1] ?? '').trim()) !== null;
    // QBO single-period: blank first cell + second cell is 'Total' = the header row
    const secondCellIsTotal = row.length > 1 && /^total$/i.test(String(row[1] ?? '').trim());
    // A lone date SUBTITLE ("December 2024" in the first cell, nothing else) must
    // NOT be picked as the header — a real header has a blank/name account column
    // with the period(s) in LATER columns, OR two-plus period columns. (This also
    // hardens the pre-existing case of a bare "Dec 2024" subtitle.)
    const looksLikeHeader =
      (firstCellBlank && (secondCellIsPeriod || secondCellIsTotal)) ||
      periodCells >= 2 ||
      (periodCells >= 1 && !firstCellIsPeriod);
    if (looksLikeHeader) {
      headerRowIndex = i;
      break;
    }
  }

  const rawHeaders: string[] = (data[headerRowIndex] ?? []).map((h) => String(h ?? '').trim());
  const dataRows = data.slice(headerRowIndex + 1);

  // ── Single-period 'Total' column handling ────────────────────────────────
  // QBO single-month exports have a header row of ",Total,,,..." — the data
  // column is labelled "Total" not a date.  Scan the preamble rows (before
  // the header row) for a recognisable month string and replace the "Total"
  // header with it so the period detection works normally.
  if (rawHeaders.some(h => /^total$/i.test(h)) &&
      !rawHeaders.some(h => expandPeriodHeader(h) !== null)) {
    // Look for a period in the preamble rows
    for (let pi = 0; pi < headerRowIndex; pi++) {
      const pRow = data[pi] ?? [];
      for (const cell of pRow) {
        const periodFromCell = expandPeriodHeader(String(cell ?? '').trim());
        if (periodFromCell) {
          // Replace "Total" with the found period header
          const totalIdx = rawHeaders.findIndex(h => /^total$/i.test(h));
          if (totalIdx >= 0) rawHeaders[totalIdx] = String(cell ?? '').trim();
          break;
        }
      }
    }
  }

  const columnMapping = detectColumnMapping(rawHeaders);
  const { accountNameColumn, accountNumberColumn } = columnMapping;

  // Build index lookups for header → column index. FIRST occurrence wins:
  // detectColumnMapping picks the first matching header (falling back to
  // headers[0], usually the blank account-name column in QBO exports), and
  // QBO header rows repeat blank cells — last-wins would resolve the name
  // column to a trailing empty column and silently drop every data row.
  const headerToIndex = new Map<string, number>();
  for (let i = 0; i < rawHeaders.length; i++) {
    const h = rawHeaders[i] ?? '';
    if (!headerToIndex.has(h)) headerToIndex.set(h, i);
  }

  const nameColIndex = accountNameColumn !== null ? (headerToIndex.get(accountNameColumn) ?? null) : null;
  const numberColIndex = accountNumberColumn !== null ? (headerToIndex.get(accountNumberColumn) ?? null) : null;

  // Build a richer period column map (with full expansion info) for amount distribution
  interface RichPeriodCol {
    colIndex: number;
    periods: Period[];
    divisor: number;
  }
  const rawPeriodCols: RichPeriodCol[] = [];
  for (let i = 0; i < rawHeaders.length; i++) {
    const h = rawHeaders[i] ?? '';
    // Skip summary columns like QBO's trailing "Total" column
    if (isSummaryColumn(h)) continue;
    const expanded = expandPeriodHeader(h);
    if (expanded) {
      rawPeriodCols.push({ colIndex: i, ...expanded });
    }
  }

  // A file may carry BOTH single-month columns AND a quarter/annual subtotal
  // column (e.g. Jan, Feb, Mar, Q1). Without dedup, the coarser column's
  // per-month share is SUMMED onto the monthly values → every amount doubled.
  // Drop any column whose period keys are already covered by a STRICTLY finer
  // (smaller-divisor) column; genuine same-granularity duplicates are kept (they
  // legitimately accumulate — see csv-parser.check.ts dup-period fixture).
  const finestDivisor = new Map<string, number>();
  for (const c of rawPeriodCols) {
    for (const p of c.periods) {
      const k = periodKey(p);
      const cur = finestDivisor.get(k);
      if (cur === undefined || c.divisor < cur) finestDivisor.set(k, c.divisor);
    }
  }
  const richPeriodCols = rawPeriodCols.filter(
    (c) => !c.periods.some((p) => (finestDivisor.get(periodKey(p)) ?? c.divisor) < c.divisor)
  );

  // Effective statement type, resolved BEFORE the row loop so balance-sheet
  // handling applies (stock columns = ending balances; "Net Income" kept as an
  // equity account). Prefer the caller's explicit type. When absent (the
  // home-wizard auto-detect path), require an actual BS SECTION-HEADER row —
  // NOT a substring — so a P&L with a leaf like "Gain on Sale of Assets" or
  // "Equity in Earnings" is never mis-typed as a balance sheet (which would
  // mangle its quarter/annual columns).
  const isBalanceSheet = statementType
    ? statementType === 'balance_sheet'
    : dataRows.some((r) => {
        const nm = nameColIndex !== null ? String(r[nameColIndex] ?? '').trim() : '';
        const sec = sectionFromName(nm);
        return sec === 'asset' || sec === 'liability' || sec === 'equity';
      });

  const rows: ParsedRow[] = [];
  let currentSection: Section | null = null;

  for (const row of dataRows) {
    // Skip blank rows
    if (row.every((cell) => String(cell ?? '').trim() === '')) continue;

    const rawName = nameColIndex !== null ? String(row[nameColIndex] ?? '') : '';
    const trimmedName = rawName.trim();

    // Skip blank account names
    if (trimmedName === '') continue;

    // Update section tracker BEFORE the filter — section headers (which are
    // filtered out as data rows) still need to update state for downstream
    // rows that ARE kept.
    const detectedSection = sectionFromName(trimmedName);
    if (detectedSection !== null) {
      currentSection = detectedSection;
    } else if (SECTION_HEADER_LABELS.has(trimmedName.toLowerCase())) {
      // A recognized grouping header that maps to NO single section (e.g.
      // "Liabilities and Equity"): clear the running section so the accounts
      // that follow don't inherit the previous one (was typing liabilities as
      // assets under it).
      currentSection = null;
    }

    // Decide whether to skip this row.
    //  - 'total' rows (Total Current Assets, Net Income, etc.) — always skip
    //  - 'section' rows (ASSETS, LIABILITIES, "Other Assets") — skip ONLY when
    //    they have no actual values; otherwise treat as a regular account.
    //    This handles the common case where a financial model uses the same
    //    name for both the section header and a leaf account (e.g. "Other
    //    Assets" appears twice in some balance sheet templates).
    const rowKind = classifyRowKind(trimmedName, isBalanceSheet);
    if (rowKind === 'total') continue;
    if (rowKind === 'section') {
      // Sum absolute values across detected period columns to decide if the
      // row carries data.
      let rowAbsSum = 0;
      for (const { colIndex } of richPeriodCols) {
        const raw = String(row[colIndex] ?? '').trim();
        if (raw) rowAbsSum += Math.abs(parseAmount(raw));
      }
      if (rowAbsSum === 0) continue; // pure header — drop
      // else: fall through and keep as an account
    }

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
      if (isBalanceSheet && divisor > 1) {
        // Balance-sheet stock: a quarter/annual column holds the ENDING balance
        // at period end, not a flow to spread. Assign the full amount to the
        // LAST month of the range; dividing would understate the balance ~N-fold.
        const key = periodKey(periods[periods.length - 1]!);
        values[key] = (values[key] ?? 0) + total;
      } else {
        const perMonth = divisor > 1 ? total / divisor : total;
        for (const p of periods) {
          const key = periodKey(p);
          values[key] = (values[key] ?? 0) + perMonth;
        }
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
    if (currentSection !== null) {
      parsedRow.section = currentSection;
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

  // Remove parent rows whose values are the sum of their children (QBO hierarchy).
  // Applies only for P&L exports; balance sheet parent rows are already removed
  // via isTotalsRow. This prevents double-counting of revenue/expense categories.
  const deduped = deduplicateParentRows(rows);

  return {
    rows: deduped,
    columnMapping,
    detectedStatementType,
    rawHeaders,
    warnings,
  };
}
