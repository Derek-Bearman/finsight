/**
 * Standalone file → {accounts, values} import pipeline, extracted so the
 * Statements page can import data the same way the home wizard does:
 *   file → (xlsx→csv | text) → parseCSV → build accounts/values →
 *   section-aware classify → auto-exclude summary rows → validate.
 *
 * Pure of React; safe to call from any client component.
 */

import type {
  Account,
  AccountType,
  AccountValue,
  IndustryProfile,
  ImportValidationWarning,
  StatementType,
} from '@/types';
import { parseCSV, type ParsedRow, type ColumnMapping } from '@/lib/parsers/csv-parser';
import { xlsxToCsvDetailed, isExcelFile, isExcelMimeType } from '@/lib/parsers/xlsx-converter';
import { classifyAll } from '@/lib/classifiers';
import { validateImport } from '@/lib/parsers/import-validator';

/** QBO summary/subtotal + balance-check rows that would double-count. Shared
 *  with the home wizard. */
export const AUTO_EXCLUDE_NAMES = new Set([
  'net income',
  'net profit',
  'net loss',
  'gross profit',
  'gross margin',
  'operating income',
  'operating profit',
  'total income',
  'total revenue',
  'total expenses',
  'total cost of goods sold',
  'net operating income',
  'net other income',
  'net revenue',
  'balance check',
  'balance check (ta - tle)',
  'balance check (ta-tle)',
  'check (ta - tle)',
  'audit check',
  'tie-out',
  'tie out',
]);

export interface ImportResultBundle {
  accounts: Account[];
  values: AccountValue[];
  warnings: ImportValidationWarning[];
  statementType: 'pnl' | 'balance_sheet';
  rowCount: number;
}

function buildAccountValues(accountId: string, row: ParsedRow): AccountValue[] {
  return Object.entries(row.values).map(([key, amount]) => {
    const [yearStr, monthStr] = key.split('-');
    return {
      accountId,
      period: { year: parseInt(yearStr ?? '2024', 10), month: parseInt(monthStr ?? '1', 10) },
      amount,
    };
  });
}

function buildAccountsFromRows(rows: ParsedRow[]): {
  accounts: Account[];
  values: AccountValue[];
  classifierInputs: { id: string; name: string; number?: string; section?: AccountType }[];
} {
  const accounts: Account[] = [];
  const values: AccountValue[] = [];
  const classifierInputs: { id: string; name: string; number?: string; section?: AccountType }[] = [];

  let seq = 0;
  for (const row of rows) {
    if (!row.accountName) continue;
    const id = `imported-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}`;
    const account: Account = {
      id,
      name: row.accountName,
      number: row.accountNumber,
      type: 'expense',
      isManuallyClassified: false,
    };
    if (row.section !== undefined) account.detectedSection = row.section as AccountType;
    accounts.push(account);
    values.push(...buildAccountValues(id, row));

    const ci: { id: string; name: string; number?: string; section?: AccountType } = { id, name: row.accountName };
    if (row.accountNumber !== undefined) ci.number = row.accountNumber;
    if (row.section !== undefined) ci.section = row.section as AccountType;
    classifierInputs.push(ci);
  }
  return { accounts, values, classifierInputs };
}

function classify(
  raw: Account[],
  classifierInputs: { id: string; name: string; number?: string; section?: AccountType }[],
  profile: IndustryProfile,
  statementType: 'pnl' | 'balance_sheet'
): Account[] {
  const results = classifyAll(classifierInputs, profile, statementType);
  return raw.map((a) => {
    const cr = results.get(a.id);
    const base: Account = !cr
      ? a
      : {
          ...a,
          type: cr.accountType ?? a.type,
          costBehavior: cr.costBehavior ?? undefined,
          classificationSource: cr.source,
          classificationConfidence: cr.confidence,
          classificationHintFired: cr.hintFired,
          isManuallyClassified: false,
        };
    const normalized = base.name.toLowerCase().trim();
    return AUTO_EXCLUDE_NAMES.has(normalized) ? { ...base, isExcluded: true } : base;
  });
}

/** Read + parse + classify a file into accounts/values. Throws on unreadable
 *  files; returns warnings for soft issues (all-zero, no periods, etc.). */
export async function parseImportFile(
  file: File,
  statementType: 'pnl' | 'balance_sheet',
  profile: IndustryProfile
): Promise<ImportResultBundle> {
  let text: string;
  const notices: ImportValidationWarning[] = [];

  if (isExcelFile(file.name) || isExcelMimeType(file.type)) {
    const buffer = await file.arrayBuffer();
    const conversion = xlsxToCsvDetailed(buffer, statementType);
    text = conversion.csv;
    if (conversion.pickedNonFirst && conversion.sheetName) {
      notices.push({
        type: 'xlsx_sheet_picked',
        severity: 'info',
        message: `Imported from the "${conversion.sheetName}" sheet — best match for ${statementType === 'pnl' ? 'P&L' : 'Balance Sheet'}.`,
      });
    }
  } else {
    text = await file.text();
  }

  const result = parseCSV(text, statementType as StatementType);

  if (result.columnMapping.periodColumns.length === 0) {
    return {
      accounts: [],
      values: [],
      rowCount: 0,
      statementType,
      warnings: [
        ...notices,
        {
          type: 'no_period_columns',
          severity: 'error',
          message:
            'No date columns detected. FinSight expects month columns (Jan 2024, Feb 2024…) with accounts as rows — export a "Profit and Loss by Month" report.',
        },
      ],
    };
  }

  const { accounts: rawAccounts, values, classifierInputs } = buildAccountsFromRows(result.rows);
  const accounts = classify(rawAccounts, classifierInputs, profile, statementType);
  const warnings = [...notices, ...validateImport(accounts, values, statementType)];

  return { accounts, values, warnings, statementType, rowCount: accounts.length };
}

/** Column mapping is auto-detected by parseCSV; exported for callers that want
 *  it (unused by the simple statements import path). */
export type { ColumnMapping };
