// ── Page-specific tours ────────────────────────────────────────────────────
//
// One tour per workspace tab + the /franchises manager. These run AFTER the
// main tour is complete (gated by usePageTour) and go deeper on each surface's
// features. Steps whose target is absent (franchise-only, owner-only, or a
// view the user hasn't opened) are auto-skipped by TourOverlay, so every tour
// degrades gracefully.
//
// Targets are real selectors present when the surface is active. Content was
// authored against the live components; scripts/checks/tutorial-content.check.ts
// pins the invariants (valid targets, no em dashes, welcome/closing steps).

import type { TourStep } from '../TourSteps';
import type { PageTourId } from '../keys';

export const PAGE_TOURS: Record<PageTourId, TourStep[]> = {
  overview: [
    {
      id: 'overview-welcome',
      title: 'The Overview Dashboard',
      body: `This is your one-screen read on a client: KPI cards, revenue vs. breakeven, cost structure, key ratios, and a plain-English executive summary. This quick tour shows the date-range scope and the KPI targets that drive every benchmark here.`,
      position: 'center',
    },
    {
      id: 'overview-kpis',
      title: 'KPI Cards And Summary',
      body: `Revenue, COGS, gross profit, operating expenses, and net income for the selected window sit up top, above the executive summary. Every figure and the ratios below respect the date range you set next.`,
      target: '[data-tour="overview-kpis"]',
      position: 'below',
    },
    {
      id: 'overview-date-range',
      title: 'Shared Date Range',
      body: `Pick a From and To month, or use All time, This year, or Last 12 months. This window is shared: it also scopes Statements, Reports, and Operational. Monthly, Quarterly, and Annual is a separate roll-up, not the span. Reset returns to all data.`,
      target: '[data-testid="shared-date-range"]',
      position: 'below',
    },
    {
      id: 'overview-targets-btn',
      title: 'Set Client KPI Targets',
      body: `Open Targets to set corporate-mandated or custom KPI values for this client, like food cost at most 30%. A target replaces FinSight's default benchmark everywhere that number appears and is labeled with where it came from.`,
      target: '[data-testid="targets-btn"]',
      position: 'below',
    },
    {
      id: 'overview-benchmark-precedence',
      title: 'How Benchmarks Are Chosen',
      body: `Inside Targets you can also turn on industry benchmarks (off by default, marked with an asterisk). Effective targets follow a precedence: a per-client target wins, then a franchise corporate set, then the industry pack, then FinSight's built-in default.`,
      target: '[data-testid="targets-btn"]',
      position: 'below',
    },
    {
      id: 'overview-closing',
      title: 'You Know The Overview',
      body: `Set the date range, set targets once, and every card, ratio, and the executive summary stay in sync. Explore Statements to import or sync data, or Reports for deeper analysis when you are ready.`,
      position: 'center',
    },
  ],

  statements: [
    {
      id: 'statements-welcome',
      title: 'Statements, Imports, and QuickBooks',
      body: `This is where financial data comes into a workspace. You can import P&L and balance-sheet files, switch between datasets, and connect QuickBooks Online. The P&L and Balance Sheet below always reflect the active dataset.`,
      position: 'center',
    },
    {
      id: 'statements-dataset',
      title: 'Pick the Active Dataset',
      body: `Every import can be kept as its own dataset. Use this selector to switch which one you are analyzing. It is disabled until you have more than one. Switching also snapshots any mapping edits back into the dataset you are leaving.`,
      target: '[data-testid="dataset-selector"]',
      position: 'below',
    },
    {
      id: 'statements-import',
      title: 'Import a P&L or Balance Sheet',
      body: `Click Import data to upload a CSV or XLSX exported from QuickBooks, Xero, or similar. You choose P&L or Balance Sheet, then FinSight compares the file to the current dataset and shows exactly what matches and what is new before anything saves.`,
      target: '[data-testid="statements-import-btn"]',
      position: 'left',
    },
    {
      id: 'statements-import-review',
      title: 'Review Before You Save',
      body: `After you pick a file, a review panel shows matched cells, changed cells, new periods, and new accounts. Nothing is committed until you choose to add only the new data, apply changed values, or import it as a new dataset.`,
      target: '[data-testid="statements-import-btn"]',
      position: 'left',
    },
    {
      id: 'statements-qbo-chip',
      title: 'QuickBooks Connection Status',
      body: `If this workspace is connected to QuickBooks, a status chip shows the company name and when it last synced. It turns amber if the connection needs reauthorizing and red if the last sync failed.`,
      target: '[data-testid="qbo-chip"]',
      position: 'below',
    },
    {
      id: 'statements-qbo-connect',
      title: 'Connect QuickBooks Online',
      body: `Owners and admins can connect one QuickBooks company per workspace for a read-only import. FinSight never pushes anything back to QuickBooks. On the shared demo firm this button is hidden, so you will not see it there.`,
      target: '[data-testid="qbo-connect-btn"]',
      position: 'below',
    },
    {
      id: 'statements-qbo-sync',
      title: 'Sync History From QuickBooks',
      body: `Once connected, Sync opens a dialog where you pick how many years of history to pull (1 to 10, default 3). It fetches monthly P&L and Balance Sheet one year at a time, then routes into the same review panel so you approve every change. Re-syncing is safe and idempotent.`,
      target: '[data-testid="qbo-sync-btn"]',
      position: 'below',
    },
    {
      id: 'statements-close',
      title: 'You Know the Statements Tab',
      body: `Import files or sync QuickBooks, review the delta, and manage datasets all from here. The P&L and Balance Sheet below update instantly once you commit. Change granularity to view monthly, quarterly, or annual columns.`,
      position: 'center',
    },
  ],

  mapping: [
    {
      id: 'mapping-welcome',
      title: 'Classify Your Chart of Accounts',
      body: `The Mapping tab is where you tell FinSight what each account is. Classify accounts by type, set cost behavior, and reconcile against a corporate chart. Every change is logged, and nothing here edits your source file.`,
      position: 'center',
    },
    {
      id: 'mapping-toolbar',
      title: 'Reclassify From the Toolbar',
      body: `Drag any account card between the Revenue, COGS, Expense, Asset, Liability, and Equity columns to reclassify it. Search, view the audit log, and refresh or reset classification all live in this toolbar. Accounts you move by hand get a manual badge and are remembered for next time.`,
      target: '[data-testid="mapping-toolbar"]',
      position: 'below',
    },
    {
      id: 'mapping-needs-review',
      title: 'Review Low-Confidence First',
      body: `Start with Needs Review. This filter shows only the accounts FinSight classified with low confidence, so you can confirm or fix those first. The other chips filter by how an account was classified: manual, profile hint, account number, or auto.`,
      target: '[data-testid="source-filter-needs_review"]',
      position: 'below',
    },
    {
      id: 'mapping-view-toggle',
      title: 'Types vs Cost Behavior',
      body: `Toggle between Account Types and Cost Behavior here. The Cost Behavior view is where you tag accounts as fixed, variable, or mixed, which powers the breakeven chart on the Overview and the contribution-margin figures shown on the Overview and the Reports income statement.`,
      target: '[data-tour="mapping-view-toggle"]',
      position: 'below',
    },
    {
      id: 'mapping-mixed-split',
      title: 'Split Mixed Accounts',
      body: `In the Cost Behavior view, a mixed account gets this slider to set what share is fixed, with the rest variable. On its own it only moves breakeven (on the Overview) and contribution margin (on the Overview and the Reports income statement), not reported net income. It feeds projected net income and What-If only when your projection model is set to Driver-based.`,
      target: '[data-testid^="mixed-split-slider-"]',
      position: 'left',
      waitForTarget: true,
    },
    {
      id: 'mapping-scoa',
      title: 'Fold Into Corporate Lines',
      body: `If this client is linked to a franchise with a corporate standard chart of accounts, an SCOA mapping section appears here. Expand it to fold your accounts into the corporate lines: auto-match handles the obvious ones, then drag any unmapped account onto a corporate line. Many accounts can share one line. What you map here rolls up into the corporate-line comparison on Reports.`,
      target: '[data-testid="scoa-mapping-toggle"]',
      position: 'above',
      waitForTarget: true,
    },
    {
      id: 'mapping-closing',
      title: 'Clean Mapping Feeds Everything',
      body: `That is the Mapping tab. Classify by type, set cost behavior, and reconcile against corporate if this client is franchise-linked. Clean mapping here makes every other tab, from Statements to Projections, accurate.`,
      position: 'center',
    },
  ],

  reports: [
    {
      id: 'reports-welcome',
      title: 'The Reports Tab',
      body: `This tab turns this client's numbers into a readable income statement, key ratios, and a plain-English summary. Everything here follows the shared date range and the granularity you pick, so what you read matches the window you set.`,
      position: 'center',
    },
    {
      id: 'reports-granularity',
      title: 'Granularity And Date Range',
      body: `Switch between Monthly, Quarterly, and Annual to change how periods are grouped. The From/To range at the top of the workspace scopes this whole tab, so both controls work together. Leave the range unset to see all data.`,
      target: '[data-tour="reports-granularity"]',
      position: 'below',
    },
    {
      id: 'reports-income-statement',
      title: 'The Income Statement',
      body: `The P&L lays out revenue, costs, and net income period by period across your chosen range and granularity. A plain-English executive summary sits above it, describing the same scoped numbers so the story and the figures always agree.`,
      target: '[data-tour="reports-pnl"]',
      position: 'above',
    },
    {
      id: 'reports-key-ratios',
      title: 'Key Ratios And Benchmarks',
      body: `These cards show the latest period's gross and net margin, current ratio, debt-to-equity, ROE, and Altman Z. Each card names the target it was judged against and where that target came from, so you can see whether a per-client, franchise, or default benchmark is in play.`,
      target: '[data-tour="reports-key-ratios"]',
      position: 'above',
    },
    {
      id: 'reports-franchise-comparison',
      title: 'Co-Franchisee Comparison',
      body: `If this client is linked to a franchise, a peer table appears here ranking every franchisee in the group. It is computed on the server, so you only see each peer's summary metrics, never their full books. Non-franchise clients will not see this section.`,
      target: '[data-testid="franchise-comparison"]',
      position: 'above',
    },
    {
      id: 'reports-franchise-median',
      title: 'Rank, Median, And This Client',
      body: `Click any column header to re-rank the franchisees, with blanks always sorted last. This client's row is highlighted with a "this client" pill, and the bottom median row shows the group midpoint so you can see where they stand against the pack.`,
      target: '[data-testid="franchise-comparison-median-row"]',
      position: 'above',
    },
    {
      id: 'reports-scoa-comparison',
      title: 'Corporate Line Comparison',
      body: `For franchise-linked clients with a corporate chart, this section folds every account you mapped into its corporate line and compares this client against the peer median, in % of revenue or dollars. Expand a line to see which accounts roll up. Map accounts on the Mapping tab to populate it.`,
      target: '[data-tour="reports-scoa-comparison"]',
      position: 'above',
    },
    {
      id: 'reports-closing',
      title: 'You Know Reports Now',
      body: `Set your range and granularity, read the summary, scan the ratios against their benchmarks, and if the client is a franchisee, compare them to peers. For a bigger printable view, use the View Full Reports link at the top.`,
      position: 'center',
    },
  ],

  projections: [
    {
      id: 'projections-welcome',
      title: 'Projections Walkthrough',
      body: `This tab forecasts each account forward and rolls it up into projected revenue and net income. You pick a model, a horizon, and optionally a growth rate. Let's walk through what each control does.`,
      position: 'center',
    },
    {
      id: 'projections-model-selector',
      title: 'Choose a Forecast Model',
      body: `Pick how history is extended: Linear, Seasonal, YoY Growth, or Driver-based. Linear, Seasonal, and YoY each project an account's own past forward. One model may show a small "default" badge, which is the suggested model for this client's industry.`,
      target: '[data-tour="projection-model"]',
      position: 'below',
    },
    {
      id: 'projections-driver-based',
      title: 'How Driver-Based Works',
      body: `Driver-based is cost-behavior aware. It grows total revenue at the growth rate, then variable costs scale with that revenue, fixed costs stay flat, and mixed costs split by the fixed percent you set on the Mapping Cost Behavior view. The other models ignore cost behavior.`,
      target: '[data-tour="projection-model"]',
      position: 'below',
    },
    {
      id: 'projections-growth-rate',
      title: 'Set or Read the Growth Rate',
      body: `Click Growth Rate to type a manual annual rate, or leave it off to let FinSight imply one from your revenue history. The line under the button always tells you the rate in use and what it applies to.`,
      target: '[data-testid="growth-rate-display"]',
      position: 'below',
    },
    {
      id: 'projections-growth-rate-source',
      title: 'Where the Rate Comes From',
      body: `When you enter a rate it reads "manual." When off, it shows the rate implied from revenue history, or falls back to "Per-account model trend" when a single rate cannot be derived. That keeps you clear on what is driving the forecast.`,
      target: '[data-testid="growth-rate-display"]',
      position: 'below',
    },
    {
      id: 'projections-persists-shared',
      title: 'Shared With What-If',
      body: `Your chosen model and growth rate are saved on the client and reused everywhere. The What-If page runs its live scenario preview on the same model, so a Driver-based choice here flows straight into What-If without re-entering it.`,
      position: 'center',
    },
    {
      id: 'projections-closing',
      title: "You're Set",
      body: `Switch models to compare, set a horizon from 1 to 10 years, and read the chart: solid line is actuals, dashed is the projection, and the shaded band is the 80 percent confidence range. Note the top date range does not scope this tab, projections always use full history.`,
      position: 'center',
    },
  ],

  whatif: [
    {
      id: 'whatif-welcome',
      title: 'Model What-If Scenarios',
      body: `Adjust revenue and cost assumptions and see the dollar impact against this client's actual baseline. Everything here layers on top of the real numbers, so nothing you do changes your imported data.`,
      position: 'center',
    },
    {
      id: 'whatif-scenarios',
      title: 'Pick a Scenario',
      body: `Each scenario is a saved set of adjustments. Base Case, Best Case, and Worst Case come pre-built. The sliders below stay locked on the Base Case and turn on when you select a non-baseline scenario to edit.`,
      target: '[data-tour="whatif-scenarios"]',
      position: 'below',
    },
    {
      id: 'whatif-sliders',
      title: 'Quick Adjustments',
      body: `Drag the Revenue and Costs sliders to model a percent change against actuals, or fine-tune the biggest revenue and cost accounts one by one under Key Accounts. Adjustments apply from the client's first period forward.`,
      target: '[data-tour="whatif-sliders"]',
      position: 'above',
    },
    {
      id: 'whatif-impact',
      title: 'Impact vs Base Case',
      body: `This panel totals the trailing 12 months under your scenario against the client's real baseline, for both revenue and net income. Green means the scenario improves on the baseline, red means it falls behind. It appears once a non-baseline scenario has adjustments.`,
      target: '[data-tour="whatif-impact"]',
      position: 'above',
      waitForTarget: true,
    },
    {
      id: 'whatif-fullpage',
      title: 'The Full What-If Page',
      body: `Open View Full What-If for a live 12-month preview: projected revenue and net income, the change vs the Base projection, and a chart that recomputes as you drag. It uses the projection model saved on the client, so a Driver-based choice flows your fixed and variable cost splits through these numbers too.`,
      target: '[data-tour="whatif-fullpage"]',
      position: 'left',
    },
    {
      id: 'whatif-closing',
      title: 'You Know What-If',
      body: `Pick a scenario, move the sliders, and read the impact against baseline. For the live projected chart and the driver-based numbers, use the full What-If page linked at the bottom.`,
      position: 'center',
    },
  ],

  operational: [
    {
      id: 'operational-welcome',
      title: 'Operational KPIs',
      body: `This tour covers the Operational tab, where FinSight turns raw counts into the industry KPIs and marketing-funnel math your clients care about. It is driven entirely by the client's industry profile.`,
      position: 'center',
    },
    {
      id: 'operational-tab',
      title: 'Industry-Specific Metrics',
      body: `The Operational tab tracks KPIs chosen by this client's profile. Trades clients see Revenue Per Truck, Close Rate, and Labor Efficiency; SaaS clients see NRR, Churn, and CAC Payback. Every profile also gets a universal Marketing Funnel.`,
      target: '[data-testid="tab-operational"]',
      position: 'below',
    },
    {
      id: 'operational-controls',
      title: 'Pick A Period',
      body: `Choose a single month with the Period selector. The line beside it tells you how many of the profile's metrics have data that month. This tab follows the shared date range, so the months you can pick sit inside your From/To window.`,
      target: '[data-tour="operational-controls"]',
      position: 'below',
      waitForTarget: true,
    },
    {
      id: 'operational-funnel',
      title: 'Marketing Funnel',
      body: `The funnel shows spend, leads, appointments, and new customers, with the conversion rate between stages. It derives Cost Per Lead, cost per customer, and ROI. Leave spend blank and it falls back to your P&L marketing accounts. It appears once funnel numbers exist.`,
      target: '[data-testid="funnel-chart"]',
      position: 'above',
      waitForTarget: true,
    },
    {
      id: 'operational-metrics',
      title: 'KPI Cards And Targets',
      body: `Each card shows the selected month's value against its target. Targets resolve by precedence: a per-client target wins, then a franchise corporate benchmark, then an opt-in industry pack, then the FinSight default. Metrics without data yet read as blank.`,
      target: '[data-tour="operational-metrics"]',
      position: 'above',
      waitForTarget: true,
    },
    {
      id: 'operational-full-page',
      title: 'Enter Data And Custom Metrics',
      body: `Open View Full Operational Metrics for the complete page. There you enter each number once per period with Enter Data, add your own Custom Metric, and watch a completion bar track how many metrics are filled in.`,
      target: '[data-tour="operational-fullpage"]',
      position: 'above',
    },
    {
      id: 'operational-closing',
      title: 'You Are Set',
      body: `That is the Operational tab. Enter your operational counts once per period, and the KPI cards and funnel update for whatever month you select inside the date range.`,
      position: 'center',
    },
  ],

  franchises: [
    {
      id: 'franchises-welcome',
      title: 'Franchise Management',
      body: `This is the firm-level Franchises manager. Create a franchise, then share corporate benchmark targets and a standard chart of accounts across every client workspace linked to it. It is available to firm owners and admins.`,
      position: 'center',
    },
    {
      id: 'franchises-create',
      title: 'Create a Franchise',
      body: `Name a new franchise here, optionally pick an industry profile, then click Create franchise. The profile is optional and only sets the fallback benchmark family for clients linked to this franchise.`,
      target: '[data-testid="franchise-create-name"]',
      position: 'below',
    },
    {
      id: 'franchises-row',
      title: 'Each Franchise at a Glance',
      body: `Every franchise shows its industry profile, how many client workspaces are linked, its benchmark sets with the active one, and its corporate chart of accounts. You can rename or delete a franchise from here too.`,
      target: '[data-testid="franchise-row"]',
      position: 'below',
    },
    {
      id: 'franchises-benchmarks',
      title: 'Corporate Benchmark Sets',
      body: `Click Benchmarks to manage this franchise's targets. You upload a set as CSV or enter it by hand, keep multiple versions, and mark one active. The active set applies to every linked client, but a client's own target still wins for that metric.`,
      target: '[data-testid="franchise-benchmarks-toggle"]',
      position: 'left',
    },
    {
      id: 'franchises-precedence',
      title: 'How Targets Are Chosen',
      body: `For each KPI, FinSight uses the highest available target: a per-client target first, then this franchise's active benchmark set, then an opt-in industry pack, then FinSight's built-in default. Deleting the active set drops linked clients back to packs or defaults.`,
      position: 'center',
    },
    {
      id: 'franchises-scoa',
      title: 'Corporate Chart of Accounts',
      body: `Click SCOA to upload one standard chart of accounts as CSV, with account number and name required. It powers COA audits and account-aligned comparison for linked clients. Uploading again replaces the whole chart.`,
      target: '[data-testid="franchise-scoa-toggle"]',
      position: 'left',
    },
    {
      id: 'franchises-closing',
      title: 'Sharing Across Clients',
      body: `Once a franchise has an active benchmark set and a corporate SCOA, every linked client picks them up automatically. Link clients in the new-client wizard or from a workspace. In the shared demo this page is read-only.`,
      position: 'center',
    },
  ],
};
