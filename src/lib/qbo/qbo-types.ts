/**
 * TypeScript shapes for the QuickBooks Online payloads FinSight consumes:
 * chart-of-accounts entities (from /query), CompanyInfo, and the recursive
 * Header/Columns/Rows report tree returned by /reports/ProfitAndLoss and
 * /reports/BalanceSheet with summarize_column_by=Month.
 *
 * These types are deliberately minimal — they declare only the fields the
 * api/transform layer reads. Real QBO payloads carry more (SyncToken,
 * CurrencyRef, domain, …) and the fixtures in ./fixtures mirror that; extra
 * fields are simply ignored. The fixtures are the contract for these shapes
 * (Intuit's doc samples are truncated — see QBO_INTEGRATION_PLAN.md §7).
 */

// ─────────────────────────────────────────────
// Chart of accounts (Account entity via /query)
// ─────────────────────────────────────────────

export type QboClassification = 'Asset' | 'Equity' | 'Expense' | 'Liability' | 'Revenue';

export interface QboAccount {
  /** QBO's internal, immutable account id — the join key everywhere. */
  Id: string;
  Name: string;
  /** User-assigned account number; absent when the company doesn't use them. */
  AcctNum?: string;
  /**
   * QBO account type, e.g. "Income", "Expense", "Bank", "Cost of Goods Sold".
   * COGS is ONLY detectable here — Classification has no COGS value.
   */
  AccountType: string;
  AccountSubType?: string;
  Classification: QboClassification;
  Active: boolean;
  SubAccount: boolean;
  /** Present when SubAccount — value is the parent account's Id. */
  ParentRef?: { value: string };
  /** Colon-joined path, e.g. "Payroll:Wages". Display only — never the name. */
  FullyQualifiedName: string;
}

// ─────────────────────────────────────────────
// CompanyInfo
// ─────────────────────────────────────────────

export interface QboCompanyInfo {
  CompanyName: string;
  Country?: string;
  /** Month name, e.g. "January". */
  FiscalYearStartMonth?: string;
}

// ─────────────────────────────────────────────
// Reports (recursive Header/Columns/Rows tree)
// ─────────────────────────────────────────────

/** One leaf cell. Account rows carry the QBO account id on their FIRST cell. */
export interface QboColData {
  value: string;
  id?: string;
}

export interface QboReportColumn {
  ColTitle: string;
  /** "Account" for the label column, "Money" for amount columns. */
  ColType: string;
  /** Month columns carry StartDate/EndDate entries (YYYY-MM-DD). */
  MetaData?: Array<{ Name: string; Value: string }>;
}

export interface QboReportHeader {
  ReportName: string;
  StartPeriod: string;
  EndPeriod: string;
  SummarizeColumnsBy?: string;
  Currency?: string;
  Option?: Array<{ Name: string; Value: string }>;
}

/**
 * A report row. Recursive: Section rows nest further rows under `Rows.Row`.
 *
 * Structural markers (NEVER matched by display name — see plan §7):
 *  - A row contributes account VALUES only when the first ColData cell (its
 *    own for Data rows, its Header's for Section rows) carries an account id.
 *  - `Summary` rows are computed subtotals — always skipped.
 *  - Summary-group sections (group "GrossProfit", "NetIncome", …) have no
 *    account id anywhere, so the id rule skips them structurally.
 */
export interface QboReportRow {
  type?: 'Section' | 'Data';
  /** Section grouping tag, e.g. "Income", "COGS", "Expenses", "GrossProfit". */
  group?: string;
  /** Section label row; carries an account id when the section IS an account. */
  Header?: { ColData: QboColData[] };
  Rows?: { Row: QboReportRow[] };
  /** Computed subtotal for the section — never imported. */
  Summary?: { ColData: QboColData[] };
  /** Leaf cells for Data rows, positionally aligned with Columns.Column. */
  ColData?: QboColData[];
}

export interface QboReport {
  Header: QboReportHeader;
  Columns: { Column: QboReportColumn[] };
  Rows: { Row: QboReportRow[] };
}
