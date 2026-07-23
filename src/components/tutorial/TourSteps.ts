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
    body: "FinSight turns financial statements into decisions, not just reports. This quick tour shows you how to set up your first client workspace. You can skip at any time.",
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
    body: "Profiles bundle classification rules, benchmarks, and operational metrics by industry. Pick whichever fits the client's business, Trades for HVAC/plumbing/electrical, SaaS for subscription products, Restaurant for food service, and so on. Generic SMB is the fallback. Owners and admins can also mark the client as a franchisee here and link it to a franchise so it inherits corporate benchmarks.",
    target: '[data-tour="profile-grid"]',
    position: 'above',
  },
  {
    id: 'upload-pnl',
    title: 'Upload your P&L',
    body: "After clicking Continue, you'll reach the upload step. Export a CSV or Excel file from QuickBooks, Xero, or your accounting software and drop it in. Owners and admins on a paid firm can skip the file and choose Connect QuickBooks instead to pull the data straight from QuickBooks Online. You can also import a saved .finsight.json workspace from the Profile step.",
    target: '[data-testid="profile-next"]',
    position: 'above',
  },
  {
    id: 'home-done',
    title: 'You\'re set to go',
    body: "Once your file is confirmed, click Continue to review the auto-classification, then open your workspace. The workspace tour walks you through the analysis tools, and the ? button in the header opens page-specific help anytime.",
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
    body: "Here's your financial command center. Each tab is a different lens on the same data, all linked together. A shared From/To date range at the top scopes several tabs at once, and after this tour each tab runs its own quick walkthrough the first time you open it.",
    position: 'center',
  },
  {
    id: 'overview-tab',
    title: 'Overview, the dashboard',
    body: "KPIs at a glance, Revenue vs. Breakeven, cost structure, and key ratios. The shared date range and the granularity toggle control what you see, and the Targets editor sets client or corporate benchmarks that follow a clear precedence.",
    target: '[data-testid="tab-overview"]',
    position: 'below',
  },
  {
    id: 'statements-tab',
    title: 'Statements, import and QuickBooks',
    body: "Import a P&L or Balance Sheet from CSV or Excel, or, for owners and admins, connect QuickBooks Online for a read-only sync. Every import is diffed and reviewed before it saves, and you can keep multiple datasets.",
    target: '[data-testid="tab-statements"]',
    position: 'below',
  },
  {
    id: 'mapping-tab',
    title: 'Mapping, classify accounts',
    body: "Drag accounts between Revenue, COGS, Expense, Asset, Liability, and Equity, and switch to the Cost Behavior view to tag fixed, variable, or mixed. Franchise-linked clients can also reconcile against a corporate standard chart of accounts. Every change is logged.",
    target: '[data-testid="tab-mapping"]',
    position: 'below',
  },
  {
    id: 'reports-tab',
    title: 'Reports, statement and ratios',
    body: "Switch between Monthly, Quarterly, and Annual for the income statement, breakeven, and ratio dashboard, all scoped by the shared date range. Franchise-linked clients also get a co-franchisee comparison ranking their peers.",
    target: '[data-testid="tab-reports"]',
    position: 'below',
  },
  {
    id: 'projections-tab',
    title: 'Projections, forecast forward',
    body: "Choose Linear, Seasonal, YoY, or the cost-behavior-aware Driver-based model, and set or read the growth rate in use. Your model and growth choice persist on the client and are shared with What-If. At least 3 months of data is required.",
    target: '[data-testid="tab-projections"]',
    position: 'below',
  },
  {
    id: 'whatif-tab',
    title: 'What-If, scenario modeling',
    body: "Adjust Revenue and Cost sliders against pre-built Best and Worst scenarios and see the impact vs baseline. The full What-If page adds a live 12-month projection preview that uses the same saved model, so Driver-based flows through.",
    target: '[data-testid="tab-whatif"]',
    position: 'below',
  },
  {
    id: 'operational-tab',
    title: 'Operational, industry KPIs',
    body: "Metrics unique to each industry, fully driven by the profile with no hardcoded logic. Trades sees Revenue Per Truck, Close Rate, Labor Efficiency; SaaS sees NRR, Churn, CAC Payback. Every profile also gets a universal Marketing Funnel.",
    target: '[data-testid="tab-operational"]',
    position: 'below',
  },
  {
    id: 'ws-done',
    title: "That's everything",
    body: "You now know the full workflow. The first time you open a tab, a short tour for that tab runs on its own. Click the ? button anytime to open help for the page you are on and to restart either this tour or the current page's tour.",
    position: 'center',
  },
];

/** Legacy combined steps — kept for backward compat, not used by new tour triggers */
export const TOUR_STEPS: TourStep[] = [...HOME_TOUR_STEPS, ...WORKSPACE_TOUR_STEPS];
