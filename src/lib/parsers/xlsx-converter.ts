/**
 * Excel (.xlsx / .xls) to CSV converter using SheetJS.
 * Converts the first sheet of an Excel workbook to a CSV string,
 * which can then be passed to the existing parseCSV() function.
 */

import * as XLSX from 'xlsx';

/**
 * Convert an Excel file (as ArrayBuffer) to a CSV string.
 * Uses the first worksheet in the workbook.
 *
 * @param buffer - The raw Excel file bytes.
 * @returns A CSV string representing the first sheet.
 */
export function xlsxToCsv(buffer: ArrayBuffer): string {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return '';

  const worksheet = workbook.Sheets[firstSheetName];
  if (!worksheet) return '';

  // sheet_to_csv converts to CSV with proper quoting
  return XLSX.utils.sheet_to_csv(worksheet, { blankrows: false });
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
