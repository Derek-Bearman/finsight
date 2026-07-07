// ─────────────────────────────────────────────
// Core Enumerations
// ─────────────────────────────────────────────

export type AccountType =
  | 'revenue'
  | 'cogs'
  | 'expense'
  | 'asset'
  | 'liability'
  | 'equity';

export type CostBehavior = 'variable' | 'fixed' | 'mixed' | 'unclassified';

export type StatementType = 'pnl' | 'balance_sheet' | 'coa';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type MetricFormat = 'currency' | 'percent' | 'ratio' | 'number' | 'days';

export type ProjectionModel = 'linear' | 'seasonal' | 'yoy';

export type AdjustmentType = 'percent' | 'absolute' | 'replace';

// ─────────────────────────────────────────────
// Period — first-class value object
// ─────────────────────────────────────────────

export interface Period {
  year: number;
  month: number; // 1–12
}

// ─────────────────────────────────────────────
// Account & Values
// ─────────────────────────────────────────────

export interface Account {
  id: string;
  number?: string;
  name: string;
  type: AccountType;
  costBehavior?: CostBehavior;
  /** For mixed-behavior accounts, fraction that is fixed (0–1) */
  mixedFixedPercent?: number;
  parentId?: string;
  isManuallyClassified: boolean;
  /**
   * When true, this account is excluded from all calculations.
   * Used for summary/subtotal rows (e.g. "Net Income", "Gross Profit") that
   * QBO sometimes exports as data rows — including them would double-count.
   */
  isExcluded?: boolean;
  /** Which classifier hint fired */
  classificationSource?: 'account_number' | 'baseline_keyword' | 'profile_keyword' | 'manual';
  classificationConfidence?: ConfidenceLevel;
  /** The hint text that triggered classification */
  classificationHintFired?: string;
  /**
   * The statement section this account was found under in the source file
   * (ASSETS / LIABILITIES / EQUITY for a BS; Income / COGS / Expenses for
   * a P&L). Captured by the parser at import time and persisted so the
   * classifier can be re-run later AND the mapping UI can warn when the
   * user's current `type` contradicts the source-document section.
   */
  detectedSection?: AccountType;
}

export interface AccountValue {
  accountId: string;
  period: Period;
  amount: number;
}

// ─────────────────────────────────────────────
// Scenarios
// ─────────────────────────────────────────────

export interface ScenarioAdjustment {
  accountId: string;
  type: AdjustmentType;
  value: number;
  appliesFrom: Period;
}

export interface Scenario {
  id: string;
  name: string;
  description?: string;
  adjustments: ScenarioAdjustment[];
  createdAt: string; // ISO 8601
  isBaseline?: boolean; // baseline scenario = actuals, cannot delete
}

// ─────────────────────────────────────────────
// Operational Data (industry-specific KPI inputs)
// ─────────────────────────────────────────────

export interface OperationalDataPoint {
  metricDefId: string;
  period: Period;
  /** key = inputField.id, value = the raw number entered */
  inputs: Record<string, number>;
}

/**
 * Shared operational inputs for one period, entered ONCE and consumed by
 * every metric whose inputFields reference the same field id (e.g.
 * 'total_leads' feeds cost-per-lead AND every funnel conversion rate).
 * Metric calculators receive these merged over any legacy per-metric
 * OperationalDataPoint inputs (pool wins).
 */
export interface OperationalInputPool {
  period: Period;
  /** key = shared input field id, value = the raw number entered */
  sharedInputs: Record<string, number>;
}

// ─────────────────────────────────────────────
// KPI Targets (per-workspace benchmark overrides)
// ─────────────────────────────────────────────

/**
 * A client-specific KPI target — typically a corporate/franchise-mandated
 * number (e.g. "food cost ≤ 30%") — that overrides FinSight's default
 * benchmark wherever the ratio/metric renders. Provenance is always shown:
 * a corporate mandate reads very differently from a loose industry default.
 */
export interface KpiTarget {
  /** Threshold in the metric's native unit (percents as 0–1 fractions). */
  value: number;
  direction: 'at_least' | 'at_most';
  /** Where the number comes from — drives the provenance label. */
  source: 'corporate' | 'custom';
  note?: string;
}

export interface WorkspaceTargets {
  /** Financial-ratio targets keyed by RatioKey (lib/targets registry). */
  ratios: Record<string, KpiTarget>;
  /** Operational-metric targets keyed by OperationalMetricDef id. */
  metrics: Record<string, KpiTarget>;
}

// ─────────────────────────────────────────────
// Mapping Memory (cross-client classification memory)
// ─────────────────────────────────────────────

export interface MappingMemoryEntry {
  /** normalized account name (lowercase, trimmed) */
  accountNameNormalized: string;
  profileId: string;
  type: AccountType;
  costBehavior?: CostBehavior;
  mixedFixedPercent?: number;
}

// ─────────────────────────────────────────────
// Audit Trail
// ─────────────────────────────────────────────

export type AuditAction =
  | 'classify_type'
  | 'classify_behavior'
  | 'set_mixed_split'
  | 'reset_to_auto';

export interface AuditEntry {
  id: string;
  timestamp: string; // ISO 8601
  accountId: string;
  accountName: string;
  action: AuditAction;
  previousValue: string;
  newValue: string;
  performedBy: 'auto' | 'user';
}

// ─────────────────────────────────────────────
// Client Workspace
// ─────────────────────────────────────────────

export interface ClientWorkspace {
  id: string;
  name: string;
  industryProfileId: string;
  accounts: Account[];
  values: AccountValue[];
  fiscalYearStart: number; // 1–12, month the fiscal year starts
  scenarios: Scenario[];
  operationalData: OperationalDataPoint[];
  /** Shared-input pools (one per period). Optional: pre-refactor workspaces
   *  only have per-metric operationalData; calculators fall back to it. */
  operationalInputs?: OperationalInputPool[];
  /** Client-specific KPI targets (corporate mandates / custom goals). */
  targets?: WorkspaceTargets;
  customMetrics: CustomMetricDef[];
  auditLog: AuditEntry[];
  createdAt: string;
  updatedAt: string;
  /**
   * Cloud optimistic-concurrency counter, mirrored from workspaces.version.
   * Sent with every save; the server updates only when it still matches, so
   * concurrent teammate edits surface as a conflict instead of silently
   * overwriting each other. Absent for local-only (never-synced) workspaces.
   */
  cloudVersion?: number;
}

// ─────────────────────────────────────────────
// Industry Profile System
// ─────────────────────────────────────────────

export interface ClassificationHint {
  keywords: string[]; // matched case-insensitively against account name
  accountType?: AccountType;
  costBehavior?: CostBehavior;
  confidence: ConfidenceLevel;
  /** Optional note explaining the hint (shown in audit log) */
  note?: string;
}

export interface OperationalMetricInputField {
  id: string;
  label: string;
  unit: string;
  description?: string;
  optional?: boolean;
}

export interface BenchmarkRange {
  /** Value that is considered "good" */
  good: number;
  /** Threshold where performance starts to warn */
  warn: number;
  /** Threshold considered "bad" */
  bad: number;
  /** Is higher better, or lower better? */
  direction: 'higher' | 'lower';
}

export interface OperationalMetricDef {
  id: string;
  label: string;
  description?: string;
  category?: string;
  inputFields: OperationalMetricInputField[];
  /** Human-readable formula string */
  formula: string;
  /** Pure calculation function */
  calculate: (inputs: Record<string, number>, financials: FinancialSummary) => number | null;
  format: MetricFormat;
  benchmark?: BenchmarkRange;
}

export interface Benchmark {
  metricId: string;
  range: { low: number; typical: number; high: number };
  source?: string;
}

export interface IndustryProfileLabels {
  capacityUnit?: string;       // "Truck", "Consultant", "Location"
  primaryRevenueDriver?: string; // "Service Calls", "Billable Hours"
  costOfGoodsLabel?: string;   // "Cost of Services", "Food Cost"
}

export interface IndustryProfile {
  id: string;
  name: string;
  description: string;
  icon?: string; // emoji or icon name

  /** Additional classification hints layered on top of baseline */
  classificationHints: ClassificationHint[];

  /** Operational metrics this industry tracks */
  operationalMetrics: OperationalMetricDef[];

  /** Default benchmarks for financial ratios */
  benchmarks: Benchmark[];

  /** Default annual growth rate for projections */
  defaultGrowthRate: number;

  /** Whether to prefer seasonal projection model */
  seasonalityExpected: boolean;

  /** Preferred projection model */
  defaultProjectionModel: ProjectionModel;

  labels: IndustryProfileLabels;
}

// ─────────────────────────────────────────────
// Financial Summary (passed to metric calculators)
// ─────────────────────────────────────────────

export interface FinancialSummary {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  totalFixedCosts: number;
  totalVariableCosts: number;
  operatingExpenses: number;
  operatingIncome: number;
  netIncome: number;
  contributionMargin: number;
  contributionMarginPct: number;
  marketingSpend: number;
  period?: Period;
}

// ─────────────────────────────────────────────
// Custom Metric (power user feature)
// ─────────────────────────────────────────────

export interface CustomMetricDef {
  id: string;
  label: string;
  inputFields: OperationalMetricInputField[];
  formula: string; // human-readable description
  format: MetricFormat;
  profileId?: string; // if saved to a profile
}

// ─────────────────────────────────────────────
// Projection types
// ─────────────────────────────────────────────

export interface ProjectionPoint {
  period: Period;
  value: number;
  lower80: number;
  upper80: number;
  isProjected: boolean;
}

export interface AccountProjection {
  accountId: string;
  model: ProjectionModel;
  points: ProjectionPoint[];
}

// ─────────────────────────────────────────────
// Report / calculation result types
// ─────────────────────────────────────────────

export interface PeriodAggregation {
  period: Period;
  label: string; // "Jan 2024", "Q1 2024", "FY2024"
  granularity: 'monthly' | 'quarterly' | 'annual' | 'ttm';
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  totalFixedCosts: number;
  totalVariableCosts: number;
  operatingExpenses: number;
  operatingIncome: number;
  operatingMarginPct: number;
  netIncome: number;
  netMarginPct: number;
  contributionMargin: number;
  contributionMarginPct: number;
}

export interface BreakevenResult {
  period: Period;
  fixedCosts: number;
  contributionMarginPct: number;
  breakevenRevenue: number;
  actualRevenue: number;
  marginOfSafety: number;
  marginOfSafetyPct: number;
  operatingLeverage: number | null;
  breakevenUnits?: number; // only if avgTicket provided
}

export interface BalanceSheetRatios {
  period: Period;
  currentRatio: number | null;
  quickRatio: number | null;
  cashRatio: number | null;
  debtToEquity: number | null;
  debtToAssets: number | null;
  workingCapital: number | null;
}

export interface EfficiencyRatios {
  period: Period;
  assetTurnover: number | null;
  inventoryTurnover: number | null;
  dso: number | null; // days sales outstanding
  dpo: number | null; // days payable outstanding
  dio: number | null; // days inventory outstanding
  cashConversionCycle: number | null;
}

export interface ProfitabilityRatios {
  period: Period;
  roa: number | null;
  roe: number | null;
  dupont: {
    netMargin: number | null;
    assetTurnover: number | null;
    equityMultiplier: number | null;
  };
}

export interface HealthScores {
  period: Period;
  altmanZScore: number | null;
  interestCoverageRatio: number | null;
}

// ─────────────────────────────────────────────
// Import / validation types
// ─────────────────────────────────────────────

export interface ImportValidationWarning {
  type:
    | 'balance_sheet_mismatch'
    | 'retained_earnings_mismatch'
    | 'duplicate_account_number'
    | 'blank_account_name'
    | 'suspiciously_large_amount'
    | 'negative_revenue'
    | 'no_period_columns'
    | 'all_zero_values'
    | 'parse_error'
    | 'xlsx_sheet_picked';
  message: string;
  accountId?: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ImportResult {
  accounts: Account[];
  values: AccountValue[];
  warnings: ImportValidationWarning[];
  statementType: StatementType;
}

// ─────────────────────────────────────────────
// Store shape (top-level Zustand)
// ─────────────────────────────────────────────

export interface AppStore {
  workspaces: ClientWorkspace[];
  activeWorkspaceId: string | null;
  mappingMemory: MappingMemoryEntry[];
  activeScenarioId: string | null;
}
