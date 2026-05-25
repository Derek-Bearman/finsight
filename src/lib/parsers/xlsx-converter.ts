/**
 * Excel (.xlsx / .xls) to CSV converter using SheetJS.
 * Smart sheet selection: picks the most P&L-like or Balance-Sheet-like
 * sheet rather than blindly converting the first one. This matters for
 * multi-sheet financial models (Assumptions / P&L / BS / Cash Flow).
 */

import * as XLSX from 'xlsx';

export interface XlsxConversionResult {
  csv: string;
  /** Name of the sheet that was actually converted */
  sheetName: string;
  /** All sheet names in the workbook (for diagnostics / future UI) */
  allSheets: string[];
  /** True if we picked a non-first sheet (worth surfacing to the user) */
  pickedNonFirst: boolean;
}

// ── Sheet-name scoring ──────────────────────────────────────────────────────

const PNL_NAME_PATTERNS = [
  /^p&?l$/i,
  /^p\s*[\&_-]?\s*l$/i,
  /profit\s*(and|&)?\s*loss/i,
  /income\s*statement/i,
  /statement\s*of\s*operations/i,
];

const BS_NAME_PATTERNS = [
  /^bs$/i,
  /balance\s*sheet/i,
  /statement\s*of\s*financial\s*position/i,
];

const PERIOD_HEADER_PATTERN =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-\s]\d{2,4}$|^\d{4}-\d{2}$|^\d{2}\/\d{4}$|^Q[1-4]\s+\d{4}$|^FY\d{4}$/i;

/**
 * Count period-style headers in the first ~10 rows of a sheet.
 * Higher score = more likely this is the statement sheet we want.
 */
function periodHeaderScore(worksheet: XLSX.WorkSheet): number {
  // Convert just the first 10 rows for fast scanning
  const aoa = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    range: 0,
    blankrows: false,
  }) as unknown[][];

  let score = 0;
  const rowsToScan = Math.min(10, aoa.length);
  for (let i = 0; i < rowsToScan; i++) {
    const row = aoa[i] ?? [];
    for (const cell of row) {
      const s = String(cell ?? '').trim();
      if (PERIOD_HEADER_PATTERN.test(s)) score++;
    }
  }
  return score;
}

/**
 * Pick the best sheet for a given statement type.
 *
 * Scoring:
 * - +200 if sheet name matches the preferred type
 * - +N for each period-pattern cell in the first 10 rows
 * - Single-sheet workbooks always return that sheet
 * - Ties broken by sheet position (earlier wins)
 */
function pickBestSheet(
  workbook: XLSX.WorkBook,
  preferredType?: 'pnl' | 'balance_sheet',
): string | null {
  if (workbook.SheetNames.length === 0) return null;
  if (workbook.SheetNames.length === 1) return workbook.SheetNames[0]!;

  const patterns =
    preferredType === 'pnl'
      ? PNL_NAME_PATTERNS
      : preferredType === 'balance_sheet'
        ? BS_NAME_PATTERNS
        : null;

  let bestSheet: string | null = null;
  let bestScore = -1;

  for (let i = 0; i < workbook.SheetNames.length; i++) {
    const name = workbook.SheetNames[i]!;
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;

    let score = 0;
    if (patterns && patterns.some((p) => p.test(name))) score += 200;
    score += periodHeaderScore(sheet);

    if (score > bestScore) {
      bestScore = score;
      bestSheet = name;
    }
  }

  // If nothing scored above 0, fall back to first sheet (legacy behaviour)
  if (bestScore <= 0) return workbook.SheetNames[0]!;
  return bestSheet;
}

/**
 * Convert an Excel file (as ArrayBuffer) to a CSV string.
 * Picks the most relevant sheet for the given statement type when
 * the workbook has multiple sheets.
 *
 * @param buffer        - The raw Excel file bytes.
 * @param preferredType - Optional hint: 'pnl' or 'balance_sheet'. Biases
 *                        sheet selection toward names matching that
 *                        statement (e.g. "P&L", "Profit and Loss").
 * @returns A CSV string representing the chosen sheet.
 */
export function xlsxToCsv(
  buffer: ArrayBuffer,
  preferredType?: 'pnl' | 'balance_sheet',
): string {
  return xlsxToCsvDetailed(buffer, preferredType).csv;
}

/**
 * Convert an Excel file to CSV, returning extra metadata about which
 * sheet was picked so the UI can surface it ("Imported from 'P&L' sheet").
 */
export function xlsxToCsvDetailed(
  buffer: ArrayBuffer,
  preferredType?: 'pnl' | 'balance_sheet',
): XlsxConversionResult {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const allSheets = [...workbook.SheetNames];

  const chosenSheet = pickBestSheet(workbook, preferredType);
  if (!chosenSheet) {
    return { csv: '', sheetName: '', allSheets, pickedNonFirst: false };
  }

  const worksheet = workbook.Sheets[chosenSheet];
  if (!worksheet) {
    return { csv: '', sheetName: chosenSheet, allSheets, pickedNonFirst: false };
  }

  const csv = XLSX.utils.sheet_to_csv(worksheet, { blankrows: false });
  return {
    csv,
    sheetName: chosenSheet,
    allSheets,
    pickedNonFirst: allSheets.length > 1 && chosenSheet !== allSheets[0],
  };
}

/**
 * Returns true if the file extension indicates an Excel file.
 */
export function isExcelFile(filename: string): boolean {
  return /\.(xlsx|xls|xlsm|xlsb)$/i.test(filename);
}

/**
 * Returns true if the MIME type indicates an Excel file.
 */
export function isExcelMimeType(mimeType: string): boolean {
  return [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  ].includes(mimeType);
}
