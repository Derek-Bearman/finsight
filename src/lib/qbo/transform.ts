/**
 * PURE transform: QBO chart of accounts + monthly P&L/Balance-Sheet report
 * trees → FinSight { accounts, values, warnings }. No fetch, no side effects.
 *
 * Binding rules (QBO_INTEGRATION_PLAN.md):
 *  - A row contributes VALUES only when its first ColData cell carries an
 *    account id. Section headers, Summary rows, and summary-group sections
 *    (GrossProfit/NetIncome/…) are skipped STRUCTURALLY via that id rule —
 *    never by display-name matching, so a genuine account literally named
 *    "Total Income" survives.
 *  - A Section row whose Header carries an account id IS that (parent)
 *    account; its directly-posted amounts arrive either on the Header row or
 *    on a nested Data row with the same id. Both are handled; if both carry
 *    amounts in one report, the Data row wins and a warning is emitted.
 *  - Monthly columns map to Periods via Columns MetaData StartDate (preferred)
 *    or a "Jan 2024"-style ColTitle; the trailing "Total" column is ignored.
 *  - '' / missing cells are skipped; explicit zeros are kept. Balance-sheet
 *    cells are month-END balances and import as-is.
 *  - Classification is authoritative from the COA (AccountType "Cost of Goods
 *    Sold" → cogs, else Classification). Report rows missing from the COA are
 *    built from the row name + enclosing section classification, with a
 *    warning. COA accounts with no report rows are not emitted (count warned).
 *  - Multiple year-chunk reports merge as a union; when two reports disagree
 *    on the same account-period cell, the later report wins and a warning is
 *    emitted.
 */

import type { Account, AccountType, AccountValue, Period } from '@/types';
import { classifyBaseline } from '../classifiers/baseline';
import type { QboAccount, QboColData, QboReport, QboReportRow } from './qbo-types';

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

export interface QboTransformInput {
  coa: QboAccount[];
  pnlReports: QboReport[];
  bsReports: QboReport[];
}

export interface QboTransformResult {
  accounts: Account[];
  values: AccountValue[];
  warnings: string[];
}

// ─────────────────────────────────────────────
// Period helpers
// ─────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function periodKey(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** "2024-03-01" (or "2024-03") → { year: 2024, month: 3 }. */
function periodFromStartDate(value: string): Period | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m) return null;
  const year = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** "Jan 2024" / "Jan-2024" → { year: 2024, month: 1 }. */
function periodFromColTitle(title: string): Period | null {
  const m = title.trim().match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s-]+(\d{4})$/i);
  if (!m) return null;
  const month = MONTH_NAMES[m[1]!.toLowerCase()];
  if (month === undefined) return null;
  return { year: parseInt(m[2]!, 10), month };
}

/**
 * Index-aligned ColData-position → Period map for one report. The label
 * column (ColType "Account" / position 0) and the trailing "Total" column
 * map to null; unrecognisable money columns warn and map to null.
 */
function mapReportColumns(report: QboReport, label: string, warnings: string[]): Array<Period | null> {
  const cols = report.Columns?.Column ?? [];
  return cols.map((col, i) => {
    if (i === 0 || col.ColType === 'Account') return null;
    if (/^total$/i.test(col.ColTitle.trim())) return null; // trailing summary column — per plan
    const startDate = col.MetaData?.find((md) => md.Name === 'StartDate')?.Value;
    if (startDate !== undefined) {
      const p = periodFromStartDate(startDate);
      if (p) return p;
    }
    const fromTitle = periodFromColTitle(col.ColTitle);
    if (fromTitle) return fromTitle;
    warnings.push(`${label}: column "${col.ColTitle}" is not a recognisable month column; ignored.`);
    return null;
  });
}

// ─────────────────────────────────────────────
// Amount parsing
// ─────────────────────────────────────────────

/** '' / missing → null (skip cell). Explicit "0.00" → 0 (kept). */
function parseCellAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const isNegative = trimmed.startsWith('(') && trimmed.endsWith(')');
  const cleaned = trimmed.replace(/[$,()]/g, '');
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return isNegative ? -Math.abs(value) : value;
}

// ─────────────────────────────────────────────
// Section-path classification (fallback for rows missing from the COA)
// ─────────────────────────────────────────────

/** QBO structural `group` tags → FinSight type, innermost frame wins. */
const GROUP_TYPE: Record<string, AccountType> = {
  Income: 'revenue',
  OtherIncome: 'revenue',
  COGS: 'cogs',
  Expenses: 'expense',
  OtherExpenses: 'expense',
  TotalAssets: 'asset',
  CurrentAssets: 'asset',
  BankAccounts: 'asset',
  AR: 'asset',
  OtherCurrentAssets: 'asset',
  FixedAssets: 'asset',
  OtherAssets: 'asset',
  Liabilities: 'liability',
  CurrentLiabilities: 'liability',
  AP: 'liability',
  CreditCards: 'liability',
  OtherCurrentLiabilities: 'liability',
  LongTermLiabilities: 'liability',
  Equity: 'equity',
};

/** Fallback when a section has no `group`: its header label (mirrors the CSV
 *  parser's section tracking — used ONLY to classify, never to skip rows). */
const SECTION_NAME_TYPE: Record<string, AccountType> = {
  'income': 'revenue',
  'revenue': 'revenue',
  'other income': 'revenue',
  'cost of goods sold': 'cogs',
  'cogs': 'cogs',
  'expenses': 'expense',
  'other expenses': 'expense',
  'assets': 'asset',
  'current assets': 'asset',
  'fixed assets': 'asset',
  'other assets': 'asset',
  'bank accounts': 'asset',
  'accounts receivable': 'asset',
  'other current assets': 'asset',
  'liabilities': 'liability',
  'current liabilities': 'liability',
  'long-term liabilities': 'liability',
  'accounts payable': 'liability',
  'credit cards': 'liability',
  'other current liabilities': 'liability',
  'equity': 'equity',
};

function sectionTypeOfRow(row: QboReportRow): AccountType | null {
  if (row.group !== undefined) {
    const fromGroup = GROUP_TYPE[row.group];
    if (fromGroup !== undefined) return fromGroup;
  }
  const headerLabel = row.Header?.ColData?.[0]?.value;
  if (headerLabel !== undefined) {
    const fromName = SECTION_NAME_TYPE[headerLabel.trim().toLowerCase()];
    if (fromName !== undefined) return fromName;
  }
  return null;
}

/** Innermost non-null classification on the section stack. */
function currentSectionType(stack: Array<AccountType | null>): AccountType | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const t = stack[i];
    if (t !== null && t !== undefined) return t;
  }
  return null;
}

// ─────────────────────────────────────────────
// Report walking
// ─────────────────────────────────────────────

type CellMap = Map<string, { period: Period; amount: number }>;

interface ReportEntry {
  qboId: string;
  /** Row display label at first sight (COA name wins later when available). */
  name: string;
  /** Enclosing-section classification at first sight. */
  sectionType: AccountType | null;
  /** Amounts found on a parent-account Section Header row. */
  headerCells: CellMap;
  /** Amounts found on Data rows. */
  dataCells: CellMap;
}

function ensureEntry(
  entries: Map<string, ReportEntry>,
  order: string[],
  qboId: string,
  name: string,
  sectionType: AccountType | null
): ReportEntry {
  let entry = entries.get(qboId);
  if (!entry) {
    entry = { qboId, name, sectionType, headerCells: new Map(), dataCells: new Map() };
    entries.set(qboId, entry);
    order.push(qboId);
  } else if (entry.sectionType === null && sectionType !== null) {
    entry.sectionType = sectionType;
  }
  return entry;
}

function collectCells(colData: QboColData[], colPeriods: Array<Period | null>, target: CellMap): void {
  for (let i = 1; i < colData.length; i++) {
    const period = colPeriods[i];
    if (!period) continue;
    const amount = parseCellAmount(colData[i]?.value);
    if (amount === null) continue;
    target.set(periodKey(period), { period, amount });
  }
}

/**
 * Recursive walk of the Rows tree. Purely structural: the ONLY thing that
 * makes a row contribute values is an account id on its first cell (Data
 * rows) or its Header's first cell (parent-account Section rows). Summary
 * rows and id-less rows — including summary-group sections and the Balance
 * Sheet's computed "Net Income" data row — contribute nothing.
 */
function walkRows(
  rows: QboReportRow[],
  stack: Array<AccountType | null>,
  entries: Map<string, ReportEntry>,
  order: string[],
  colPeriods: Array<Period | null>
): void {
  for (const row of rows) {
    const isSectionLike = row.Header !== undefined || row.Rows !== undefined || row.Summary !== undefined;
    if (isSectionLike) {
      const headerCols = row.Header?.ColData;
      const headerId = headerCols?.[0]?.id;
      if (headerCols && headerId !== undefined && headerId !== '') {
        // This section IS an account (QBO parent-account section).
        const entry = ensureEntry(
          entries,
          order,
          headerId,
          headerCols[0]?.value ?? '',
          currentSectionType(stack)
        );
        collectCells(headerCols, colPeriods, entry.headerCells);
      }
      stack.push(sectionTypeOfRow(row));
      walkRows(row.Rows?.Row ?? [], stack, entries, order, colPeriods);
      stack.pop();
      // row.Summary: computed subtotal — structurally ignored.
    } else if (row.ColData !== undefined) {
      const id = row.ColData[0]?.id;
      if (id === undefined || id === '') continue; // not an account row
      const entry = ensureEntry(entries, order, id, row.ColData[0]?.value ?? '', currentSectionType(stack));
      collectCells(row.ColData, colPeriods, entry.dataCells);
    }
  }
}

// ─────────────────────────────────────────────
// Per-report processing + cross-report merge
// ─────────────────────────────────────────────

interface GlobalMeta {
  name: string;
  sectionType: AccountType | null;
}

function processReport(
  report: QboReport,
  globalCells: Map<string, CellMap>,
  globalMeta: Map<string, GlobalMeta>,
  globalOrder: string[],
  warnings: string[]
): void {
  const header = report.Header;
  const label = `${header?.ReportName ?? 'Report'} ${header?.StartPeriod ?? '?'}–${header?.EndPeriod ?? '?'}`;
  const colPeriods = mapReportColumns(report, label, warnings);

  const entries = new Map<string, ReportEntry>();
  const order: string[] = [];
  walkRows(report.Rows?.Row ?? [], [], entries, order, colPeriods);

  for (const qboId of order) {
    const entry = entries.get(qboId)!;

    // Parent-account double-emission guard: prefer the Data row, warn.
    let cells: CellMap;
    if (entry.dataCells.size > 0 && entry.headerCells.size > 0) {
      warnings.push(
        `${label}: account "${entry.name}" (QBO id ${qboId}) carries amounts on both its section header and a detail row; using the detail row.`
      );
      cells = entry.dataCells;
    } else {
      cells = entry.dataCells.size > 0 ? entry.dataCells : entry.headerCells;
    }

    const meta = globalMeta.get(qboId);
    if (!meta) {
      globalMeta.set(qboId, { name: entry.name, sectionType: entry.sectionType });
      globalOrder.push(qboId);
    } else if (meta.sectionType === null && entry.sectionType !== null) {
      meta.sectionType = entry.sectionType;
    }

    let merged = globalCells.get(qboId);
    if (!merged) {
      merged = new Map();
      globalCells.set(qboId, merged);
    }
    for (const [key, cell] of cells) {
      const prev = merged.get(key);
      if (prev !== undefined && Math.abs(prev.amount - cell.amount) > 1e-9) {
        warnings.push(
          `${label}: account "${entry.name}" (QBO id ${qboId}) reports ${key} as ${cell.amount} but an earlier report had ${prev.amount}; keeping the later report's value.`
        );
      }
      merged.set(key, cell);
    }
  }
}

// ─────────────────────────────────────────────
// COA type mapping
// ─────────────────────────────────────────────

function mapCoaType(account: QboAccount): AccountType {
  // COGS exists only as an AccountType — Classification calls these "Expense".
  if (account.AccountType === 'Cost of Goods Sold') return 'cogs';
  switch (account.Classification) {
    case 'Revenue':
      return 'revenue';
    case 'Expense':
      return 'expense';
    case 'Asset':
      return 'asset';
    case 'Liability':
      return 'liability';
    case 'Equity':
      return 'equity';
    default:
      return 'expense';
  }
}

// ─────────────────────────────────────────────
// Main transform
// ─────────────────────────────────────────────

export function transformQboData(input: QboTransformInput): QboTransformResult {
  const warnings: string[] = [];
  const globalCells = new Map<string, CellMap>();
  const globalMeta = new Map<string, GlobalMeta>();
  const globalOrder: string[] = [];

  for (const report of input.pnlReports) {
    processReport(report, globalCells, globalMeta, globalOrder, warnings);
  }
  for (const report of input.bsReports) {
    processReport(report, globalCells, globalMeta, globalOrder, warnings);
  }

  const coaById = new Map(input.coa.map((a) => [a.Id, a]));
  const seenIds = new Set(globalOrder);

  const accounts: Account[] = [];
  const values: AccountValue[] = [];

  for (const qboId of globalOrder) {
    const meta = globalMeta.get(qboId)!;
    const coaAccount = coaById.get(qboId);

    let name: string;
    let number: string | undefined;
    let type: AccountType;
    if (coaAccount) {
      name = coaAccount.Name; // NOT FullyQualifiedName
      number = coaAccount.AcctNum;
      type = mapCoaType(coaAccount);
    } else {
      name = meta.name;
      number = undefined;
      type = meta.sectionType ?? 'expense';
      warnings.push(
        `Report row "${name}" (QBO id ${qboId}) is not in the chart of accounts; classified as ${type} from its report section${meta.sectionType === null ? ' (no section found — defaulted to expense)' : ''}.`
      );
    }

    const account: Account = {
      id: `qbo-${qboId}`, // stable within one transform run — deterministic, not timestamped
      externalId: qboId,
      name,
      type,
      isManuallyClassified: true,
      classificationSource: 'manual',
      detectedSection: type,
    };
    if (number !== undefined && number.trim() !== '') account.number = number;

    // QBO has no fixed/variable concept — cost behavior comes from the
    // baseline classifier's keyword pass (type classification stays QBO's).
    const behavior = classifyBaseline(name, number).costBehavior;
    if (behavior !== null) account.costBehavior = behavior;

    const parentQboId = coaAccount?.ParentRef?.value;
    if (parentQboId !== undefined && seenIds.has(parentQboId)) {
      account.parentId = `qbo-${parentQboId}`;
    }

    accounts.push(account);

    const cells = globalCells.get(qboId);
    if (cells) {
      const sorted = [...cells.values()].sort(
        (a, b) => a.period.year * 12 + a.period.month - (b.period.year * 12 + b.period.month)
      );
      for (const cell of sorted) {
        values.push({ accountId: account.id, period: cell.period, amount: cell.amount });
      }
    }
  }

  const skippedCount = input.coa.filter((a) => !seenIds.has(a.Id)).length;
  if (skippedCount > 0) {
    warnings.push(
      `${skippedCount} chart-of-accounts account(s) had no rows in the imported reports and were not imported.`
    );
  }

  return { accounts, values, warnings };
}
