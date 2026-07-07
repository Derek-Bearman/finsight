// ── Tour step definitions ──────────────────────────────────────────────────

export interface TourStep {
  id: string;
  title: string;
  body: string;
  target?: string;
  position?: 'above' | 'below' | 'left' | 'right' | 'center';
  waitForTarget?: boolean;
}

/**
 * HOME TOUR — shown on the home/wizard page.
 * Only references elements that exist on the home page.
 * Steps 1-4 only.
 */
export const HOME_TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to FinSight',
    body: "FinSight turns financial statements into decisions — not just reports. This quick tour shows you how to set up your first client workspace. You can skip at any time.",
    position: 'center',
  },
  {
    id: 'client-name',
    title: 'Name the client',
    body: "Enter your client's business name. Each workspace is scoped to one business.",
    target: '[data-testid="client-name-input"]',
    position: 'below',
  },
  {
    id: 'industry-profile',
    title: 'Pick an industry profile',
    body: "Profiles bundle classification rules, benchmarks, and operational metrics by industry. Pick whichever fits the client's business — Trades for HVAC/plumbing/electrical, SaaS for subscription products, Restaurant for food service, and so on. Generic SMB is the fallback. You can change profiles later in workspace settings.",
    target: '[data-tour="profile-grid"]',
    position: 'above',
  },
  {
    id: 'upload-pnl',
    title: 'Upload your P&L',
    body: "After clicking Continue, you'll reach the upload step. Export a CSV or Excel file from QuickBooks, Xero, or your accounting software and drop it in. FinSight auto-detects column headers, handles QBO formatting quirks, and works with single-month or multi-month exports.",
    target: '[data-testid="profile-next"]',
    position: 'above',
  },
  {
    id: 'home-done',
    title: 'You\'re set to go',
    body: "Once your file is confirmed, click Continue to review the auto-classification, then open your workspace. The workspace tour will walk you through the analysis tools.",
    position: 'center',
  },
];

/**
 * WORKSPACE TOUR — shown after a workspace is created/opened.
 * Only references elements that exist on the workspace page.
 */
export const WORKSPACE_TOUR_STEPS: TourStep[] = [
  {
    id: 'ws-welcome',
    title: 'Your workspace is live',
    body: "Here's your financial command center. Each tab is a different lens on the same data — all linked together.",
    position: 'center',
  },
  {
    id: 'overview-tab',
    title: 'Overview — the dashboard',
    body: "KPIs at a glance, Revenue vs. Breakeven chart, cost structure, and key ratios. The FY selector and granularity toggle control all charts simultaneously.",
    target: '[data-testid="tab-overview"]',
    position: 'below',
  },
  {
    id: 'mapping-tab',
    title: 'Mapping — classify accounts',
    body: "Drag accounts between Revenue, COGS, Expense, Asset, Liability, and Equity columns. Every reclassification is logged. Low-confidence accounts are flagged for review.",
    target: '[data-testid="tab-mapping"]',
    position: 'below',
  },
  {
    id: 'reports-tab',
    title: 'Reports — income statement & ratios',
    body: "Switch between Monthly, Quarterly, and Annual views. Includes income statement, breakeven analysis, ratio dashboard, and period-over-period comparison.",
    target: '[data-testid="tab-reports"]',
    position: 'below',
  },
  {
    id: 'projections-tab',
    title: 'Projections — forecast forward',
    body: "Three models: linear trend, seasonal decomposition, and YoY growth. The confidence band widens over time. Requires at least 3 months of data.",
    target: '[data-testid="tab-projections"]',
    position: 'below',
  },
  {
    id: 'whatif-tab',
    title: 'What-If — scenario modeling',
    body: "Adjust Revenue and Cost sliders to model scenarios live. Drop revenue 20% and watch the breakeven warning fire. Pre-built Best Case and Worst Case scenarios included.",
    target: '[data-testid="tab-whatif"]',
    position: 'below',
  },
  {
    id: 'operational-tab',
    title: 'Operational — industry KPIs',
    body: "Metrics unique to each industry. For Trades: Revenue Per Truck, Close Rate, Labor Efficiency. For SaaS: NRR, Churn, CAC Payback. Fully driven by the profile — no hardcoded logic.",
    target: '[data-testid="tab-operational"]',
    position: 'below',
  },
  {
    id: 'ws-done',
    title: "That's everything",
    body: "You now know the full workflow. Click the ? button anytime to reopen this tour.",
    position: 'center',
  },
];

/** Legacy combined steps — kept for backward compat, not used by new tour triggers */
export const TOUR_STEPS: TourStep[] = [...HOME_TOUR_STEPS, ...WORKSPACE_TOUR_STEPS];
