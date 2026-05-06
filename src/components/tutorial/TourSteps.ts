// ── Tour step definitions ──────────────────────────────────────────────────

export interface TourStep {
  id: string;
  title: string;
  body: string;
  target?: string;           // CSS selector for the element to highlight
  position?: 'above' | 'below' | 'left' | 'right' | 'center';
  waitForTarget?: boolean;   // if true, don't advance until target is found in DOM
}

export const TOUR_STEPS: TourStep[] = [
  // Step 1 — Welcome (centered modal)
  {
    id: 'welcome',
    title: 'Welcome to FinSight',
    body: 'FinSight turns financial statements into decisions. This tour takes about 2 minutes and walks you through the full workflow. You can skip at any time.',
    position: 'center',
  },

  // Step 2 — Enter a client name
  {
    id: 'client-name',
    title: 'Start with the client',
    body: 'Type your client\'s name here — this creates a workspace scoped to that business.',
    target: '[data-testid="client-name-input"]',
    position: 'below',
  },

  // Step 3 — Pick an industry profile
  {
    id: 'industry-profile',
    title: 'Choose an industry profile',
    body: 'Each profile bundles classification hints, benchmarks, and operational metrics specific to that industry. Pick Trades Contractor for an HVAC or plumbing company. The math is the same — the context adapts.',
    target: '[data-testid="profile-card-trades-contractor"]',
    position: 'right',
  },

  // Step 4 — Upload a P&L CSV
  {
    id: 'upload-pnl',
    title: 'Upload your P&L',
    body: 'Drag-and-drop a CSV export from QuickBooks, Xero, or any accounting system. The importer handles parenthetical negatives, dollar signs, commas, and QuickBooks indentation automatically.',
    target: '[data-testid="file-dropzone"]',
    position: 'below',
  },

  // Step 5 — Column mapping preview (conditional)
  {
    id: 'column-mapping',
    title: 'Confirm the column mapping',
    body: 'FinSight detected your period columns and account name column. Override any column role with the dropdowns. This step only appears when the auto-detection needs confirmation.',
    target: '[data-testid="confirm-mapping"]',
    position: 'above',
  },

  // Step 6 — Classification review
  {
    id: 'classification-review',
    title: 'Review auto-classification',
    body: 'Every account was automatically classified using the Trades Contractor profile\'s hints. High-confidence accounts (like "6100 Truck Lease Payments → fixed expense") are pre-checked. Low-confidence ones are flagged for your review. Override any with the dropdowns.',
    target: '[data-testid="classification-confirm"]',
    position: 'above',
  },

  // Step 7 — Workspace overview tab
  {
    id: 'workspace-overview',
    title: 'Your workspace is live',
    body: 'This is the financial overview — KPIs at a glance, Revenue vs. Breakeven chart, cost structure, and ratio dashboard. The FY selector and granularity toggle at the top control all charts simultaneously.',
    target: '[data-testid="tab-overview"]',
    position: 'below',
  },

  // Step 8 — Mapping tab
  {
    id: 'mapping-tab',
    title: 'Drag-and-drop account mapping',
    body: 'Switch to Account Types or Cost Behavior view. Drag any account card to reclassify it. Every reclassification is logged in the audit trail and remembered for future clients in the same profile.',
    target: '[data-testid="tab-mapping"]',
    position: 'below',
  },

  // Step 9 — Reports tab
  {
    id: 'reports-tab',
    title: 'Financial reports with period toggle',
    body: 'Switch between Monthly, Quarterly, and Annual. Four report types: Income Statement, Breakeven Analysis, Ratio Dashboard, and Period Comparison. The Ratios tab shows the Altman Z-Score and interest coverage alongside liquidity and efficiency ratios.',
    target: '[data-testid="tab-reports"]',
    position: 'below',
  },

  // Step 10 — Projections tab
  {
    id: 'projections-tab',
    title: 'Three projection models',
    body: 'Linear trend, multiplicative seasonal decomposition, or YoY growth rate. The Trades profile defaults to Seasonal — it picks up summer and winter peaks automatically. Switch models and see how the forecast changes live. The shaded band is an 80% confidence interval.',
    target: '[data-testid="tab-projections"]',
    position: 'below',
  },

  // Step 11 — What-If tab
  {
    id: 'whatif-tab',
    title: 'What-if scenarios — the demo moment',
    body: 'Drag the Revenue slider to −20% and watch the breakeven warning appear. Drag it back up to +15% and see net income double. The Best Case, Worst Case, and Base Case scenarios are pre-built — you can add custom scenarios and compare them side by side.',
    target: '[data-testid="tab-whatif"]',
    position: 'below',
  },

  // Step 12 — Operational tab
  {
    id: 'operational-tab',
    title: 'Industry-specific KPIs',
    body: 'This tab renders entirely from the active profile — no hardcoded industry logic. For Trades, you see Revenue Per Truck, Close Rate, and Labor Efficiency. For SaaS, you\'d see NRR, Churn Rate, and CAC Payback. Enter data for a period and the metrics calculate instantly with benchmark indicators.',
    target: '[data-testid="tab-operational"]',
    position: 'below',
  },

  // Step 13 — Finished
  {
    id: 'finished',
    title: "You're ready",
    body: "That's the full workflow. Drop in a real QuickBooks export and go. If you ever need this tour again, click the \u24D8 button in the top-right corner.",
    position: 'center',
  },
];
