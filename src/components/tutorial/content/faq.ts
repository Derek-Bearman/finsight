// ── Per-page FAQ content ───────────────────────────────────────────────────
//
// The "?" help button opens a page-scoped FAQ panel. Answers are grounded in
// how each feature actually works. Keys: 'home' (the wizard) + each page-tour
// id. scripts/checks/tutorial-content.check.ts pins that every surface has
// entries and that no em dashes sneak in.

export interface FaqEntry {
  q: string;
  a: string;
}

export const PAGE_FAQ: Record<string, FaqEntry[]> = {
  home: [
    {
      q: `Do I have to upload a P&L and a balance sheet to create a client?`,
      a: `No. Both uploads are optional. You can click Continue with no file on either step and create an empty workspace, then import a P&L or balance sheet anytime later. Adding a balance sheet is what enables ratio analysis and balance-sheet metrics.`,
    },
    {
      q: `What file formats can I import in the wizard?`,
      a: `CSV and Excel (.xlsx, .xls, .xlsm). The wizard auto-detects the column headers and expects a by-month layout, like a QuickBooks "Profit and Loss by Month" export where months are columns and accounts are rows. Exports from QuickBooks, Xero, and most accounting systems work.`,
    },
    {
      q: `How do I mark a client as a franchisee and link it to a franchise?`,
      a: `On the Profile step, check "This client is a franchisee," then pick an existing franchise or choose "New franchise" to create one inline. This designation is optional. It only appears if you are an owner or admin who can manage franchises. Members and the shared demo firm do not see it.`,
    },
    {
      q: `What does "Connect QuickBooks instead" do?`,
      a: `It skips the file upload, creates the workspace right away, and hands off to connect it to one QuickBooks Online company by OAuth. It is read-only and does not push anything back to QuickBooks. The link only shows for owners and admins on a paid, non-demo firm. The connect step re-checks eligibility on the server.`,
    },
    {
      q: `I built a client on another computer. How do I bring it here?`,
      a: `On the Profile step, use "Import workspace" and pick the .finsight.json file you exported from the other browser or a backup. FinSight validates it, saves it to your firm, and opens it. Read-only firms cannot import until billing is resolved.`,
    },
    {
      q: `What is Privacy mode and when should I use it?`,
      a: `The Privacy mode button in the header wipes all workspaces from this browser immediately and stops new data from being saved locally. Anything already in memory stays usable for the session, but refreshing or closing the tab loses it. Use it on shared or public computers and one-off demos.`,
    },
    {
      q: `What happens to my accounts after I upload a file?`,
      a: `The wizard reads your columns, then auto-classifies each account into a type using the industry profile you picked, and flags summary lines like Net Income so they are not double-counted. On the Review Classification step you can override any account's type or cost behavior before the workspace is created.`,
    },
    {
      q: `Where are my workspaces stored, and can I see them on other devices?`,
      a: `Workspaces are synced to your firm in the cloud and are available on every device you sign in from. The home page lists your recent workspaces above the new-client form. Deleting a workspace cannot be undone, and read-only firms cannot create, import, or delete until billing is resolved.`,
    },
  ],

  overview: [
    {
      q: `Does the date range on this tab affect the other tabs?`,
      a: `Yes. It is a shared window that scopes Overview, Statements, Reports, and Operational to the same From and To months. Mapping, Projections, and What-If are intentionally not scoped and always use the full dataset.`,
    },
    {
      q: `What is the difference between the date range and the Monthly/Quarterly/Annual toggle?`,
      a: `The date range chooses the span of months you are looking at. Monthly, Quarterly, and Annual is the granularity, meaning how those months are rolled up within that span. They are two separate controls.`,
    },
    {
      q: `Why do my KPI cards show no data even though this client has financials?`,
      a: `The selected date range probably excludes every month that has data, so the tab shows a "No financial data in this range" prompt instead of a grid of zeros. Widen the range or click Reset to go back to all data.`,
    },
    {
      q: `How does setting a target change what I see on the Overview?`,
      a: `A target replaces FinSight's default benchmark everywhere that ratio renders, and the number is labeled with its source (corporate or custom). Unchecked rows keep the FinSight default benchmark.`,
    },
    {
      q: `When two benchmarks could apply, which one wins?`,
      a: `Effective targets follow a fixed precedence, highest first: a per-client target, then a franchise corporate benchmark set, then the industry pack (opt-in), then FinSight's built-in default. The industry-pack tier is shown with an asterisk and a hover disclaimer.`,
    },
    {
      q: `What does the industry benchmarks toggle in the Targets editor do?`,
      a: `It is off by default. When on, FinSight applies an industry benchmark pack for a metric only when no corporate or custom value already applies. You can set a region and use Refresh benchmarks to move to the current pack version.`,
    },
    {
      q: `Where do the corporate benchmarks come from?`,
      a: `They come from a benchmark set uploaded per franchise. If this client is linked to a franchise, the Benchmarks section of the Targets editor shows the active set and the franchise it came from. It only appears for franchise-linked clients.`,
    },
    {
      q: `Why is the Targets button greyed out for me?`,
      a: `The Targets button is disabled while a firm is read-only (for example, billing being resolved), so edits cannot be saved. The shared public demo firm also cannot manage these owner and admin controls.`,
    },
  ],

  statements: [
    {
      q: `What file formats can I import?`,
      a: `CSV, XLSX, XLS, and XLSM files exported from QuickBooks, Xero, or similar tools. You import a Profit & Loss or a Balance Sheet laid out by month, and choose which type you are uploading before picking the file.`,
    },
    {
      q: `Will importing overwrite my existing data?`,
      a: `No. Nothing saves until you choose an action. FinSight diffs the file against the current dataset and shows matched cells, changed cells, new periods, and new accounts. You then decide to add only the new data, apply changed values while keeping the rest, or import it as a separate dataset.`,
    },
    {
      q: `What are datasets and why would I keep more than one?`,
      a: `Each import can be saved as its own dataset, so you can hold, for example, an original import and a restated version side by side. The dataset selector switches which one drives the statements and the rest of the workspace. It is disabled until you have more than one.`,
    },
    {
      q: `How does the QuickBooks connection work?`,
      a: `It is a read-only import over Intuit's OAuth. You connect one QuickBooks company per workspace and pull multi-year monthly P&L and Balance Sheet history. FinSight never writes anything back to QuickBooks. Intuit does not offer firm-level consent, so each workspace connects its own company.`,
    },
    {
      q: `Why can't I see the Connect QuickBooks button?`,
      a: `Connecting, syncing, and disconnecting QuickBooks are owner and admin only. On the shared public demo firm those controls are hidden because it is a member-role account. An owner or admin on a real workspace will see the Connect button when no company is linked yet.`,
    },
    {
      q: `How much history does a QuickBooks sync pull, and is re-syncing safe?`,
      a: `In the Sync dialog you pick 1 to 10 years, defaulting to 3 (this year plus 2 prior). It fetches one calendar year per request, run one at a time because Intuit throttles per company. Re-syncing is idempotent, keyed on each account's QuickBooks id, and every sync lands in the review panel first.`,
    },
    {
      q: `If I disconnect QuickBooks, do I lose the imported data?`,
      a: `No. Disconnecting revokes and deletes FinSight's QuickBooks tokens for that company, but all data already imported into the workspace stays exactly as it is. Only the live connection is removed, and you can reconnect at any time.`,
    },
  ],

  mapping: [
    {
      q: `How do I reclassify an account?`,
      a: `Drag its card between the type columns, or use the keyboard: click one or more cards and press 1 to 6 to set a type, or E to exclude. There is also a Change account types without drag panel with an inline dropdown per account. Any manual change gets a manual badge and is remembered for similar accounts next time.`,
    },
    {
      q: `What is the Excluded column for?`,
      a: `Drag summary or subtotal rows like Net Income or Gross Profit there. Excluded accounts keep their type but are left out of every calculation so they do not double-count. Drag one back to a type column, or use the x button, to restore it.`,
    },
    {
      q: `What is the difference between Refresh auto-classified and Reset all?`,
      a: `Refresh auto-classified re-runs classification only on accounts you have not touched, so your manual overrides are preserved. Reset all is destructive: it reverts every account, including your manual overrides, back to fresh auto-classification. Reset asks you to confirm first and is disabled when there are no overrides.`,
    },
    {
      q: `What does the fixed and variable slider actually change?`,
      a: `By itself, the mixed split only affects breakeven (shown on the Overview) and contribution margin (shown on the Overview and in the Reports income statement). It does not change reported net income on its own. It also drives projected net income and the What-If preview, but only when your projection model is set to Driver-based. In linear, seasonal, or YoY modes the split is ignored for projections.`,
    },
    {
      q: `Why do I not see the Cost Behavior slider on my accounts?`,
      a: `The slider only appears in the Cost Behavior view, and only on accounts whose behavior is set to mixed. Switch the toolbar toggle to Cost Behavior, and look for an account marked mixed. Fixed-only and variable-only accounts have no split to set.`,
    },
    {
      q: `When does the Corporate SCOA section appear?`,
      a: `Only when this client workspace is linked to a franchise and that franchise has uploaded a corporate standard chart of accounts. For unlinked clients, or a franchise with no SCOA on file, the section does not render. It is an owner or admin feature and is hidden on the shared demo firm.`,
    },
    {
      q: `Does mapping change my source file or push to QuickBooks?`,
      a: `No. Classifications, cost behavior, and SCOA numbers are stored on the workspace, not written back to your uploaded file or to QuickBooks Online. The QBO import is read-only, so nothing here syncs back to your books.`,
    },
  ],

  reports: [
    {
      q: `Does the date range affect the Reports tab?`,
      a: `Yes. The shared From/To range scopes this tab, so the executive summary, income statement, and ratio cards all reflect the window you set. With no range chosen it shows all data. Granularity (Monthly, Quarterly, Annual) then controls how the periods inside that window are grouped.`,
    },
    {
      q: `Which period do the Key Ratios cards use?`,
      a: `The ratio cards show the latest period in your current view. Change the granularity or the date range and the "latest period" they summarize changes with it. They cover gross and net margin, current ratio, debt-to-equity, ROE, and the Altman Z zone.`,
    },
    {
      q: `Where do the ratio targets come from?`,
      a: `Each ratio card shows the threshold it was measured against plus where that threshold came from. Targets follow a precedence: a per-client target wins, then a franchise corporate benchmark, then an opt-in industry pack, then the FinSight default. Industry-pack targets carry an asterisk and a hover note.`,
    },
    {
      q: `Why don't I see the franchise comparison section?`,
      a: `The co-franchisee comparison only appears when this client workspace is linked to a franchise. If the client is not a franchisee, the section is hidden entirely. You link a client to a franchise in the new-client wizard or from a link control on the workspace.`,
    },
    {
      q: `Is the franchise comparison using my clients' full financials?`,
      a: `No. The peer snapshots are computed on the server, and only summary metrics reach your browser, never each franchisee's full ledgers. You see revenue and net income over the trailing 12 months plus the same ratios, one row per franchisee.`,
    },
    {
      q: `What does the median row in the franchise table mean?`,
      a: `It is the midpoint of all linked franchisees for each column, so half sit above and half below. For an even number of peers it can land on a half value, which is shown honestly rather than rounded. Your current client's own row is highlighted with a "this client" pill.`,
    },
    {
      q: `What is the View Full Reports link at the top?`,
      a: `It opens a dedicated, larger reports page for this workspace, useful for a fuller or more printable layout. The tab you are on gives you the same core income statement and ratios inline.`,
    },
  ],

  projections: [
    {
      q: `What makes the Driver-based model different from the others?`,
      a: `Driver-based is cost-behavior aware. It projects total revenue at the growth rate, then variable costs scale with that projected revenue, fixed costs stay flat, and mixed costs split by their fixed percent share. Linear, Seasonal, and YoY instead project each account's own history forward independently and ignore how costs behave. Driver-based also relies on the fixed/variable splits you set on the Mapping Cost Behavior view.`,
    },
    {
      q: `Do I have to enter a growth rate?`,
      a: `No. Leave the Growth Rate button off and FinSight implies a rate from your revenue history, shown as "model-implied from revenue history." If a single rate cannot be derived it falls back to a per-account model trend. Click Growth Rate to type your own annual percent instead, which then reads "manual."`,
    },
    {
      q: `Do my model and growth rate choices carry over to What-If?`,
      a: `Yes. Both the model and any manual growth rate are saved on the client workspace, so they survive navigation and are reused by the What-If page. Setting Driver-based here means the What-If live preview projects on Driver-based too, with no need to re-select it.`,
    },
    {
      q: `How much history do I need before projections appear?`,
      a: `You need at least 3 distinct months of data. With less than that the tab shows a prompt to import a P&L with at least 3 months of history, and no forecast is drawn.`,
    },
    {
      q: `Does the date range at the top of the workspace change my projections?`,
      a: `No. Projections intentionally use the full dataset and are not scoped by the shared From/To date range. That range scopes the Overview, Statements, Reports, and Operational tabs, but Projections and What-If always run on all available history.`,
    },
    {
      q: `What do the lines and shaded band on the chart mean?`,
      a: `The solid line is your actuals, the dashed line is the projection, and the shaded band is the 80 percent confidence range around the projected revenue. The caption also names the model in use so you can switch models above and compare the results.`,
    },
    {
      q: `Why does one model show a small "default" badge?`,
      a: `The badge marks the model FinSight suggests for this client's industry profile. It only appears when that suggested model is not already the one selected, so it points you to the recommended starting point without competing with your current choice.`,
    },
  ],

  whatif: [
    {
      q: `What does the live projection actually show?`,
      a: `On the full What-If page it projects the next 12 months with your scenario's adjustments applied, totals projected revenue and net income, and compares each to the straight Base projection. The chart plots the Base path against the scenario path month by month, and everything recomputes as you move the sliders.`,
    },
    {
      q: `Why does it say I need at least 3 months of data?`,
      a: `The projection needs at least 3 unique months of history, plus at least one account, to establish a trend. Until then the preview shows "At least 3 months of financial data is required to project" instead of numbers.`,
    },
    {
      q: `What does "vs Base" mean on the tiles?`,
      a: `Base is the straight projection of your unadjusted history, with no scenario applied. The delta under each tile is the scenario total minus the Base total for the same 12 months. A difference under one dollar is shown as "no change" because the two paths match.`,
    },
    {
      q: `What is the difference between the What-If tab and the full What-If page?`,
      a: `The tab gives you the scenario pills, the Quick Adjustment sliders, and an Impact vs Base Case panel over the trailing 12 months. The full page adds the live 12-month projection preview with its revenue and net income tiles and the Base vs scenario chart. Both share the same scenarios and saved projection model.`,
    },
    {
      q: `How does Driver-based projection affect this scenario?`,
      a: `The preview uses the projection model saved on the workspace. Under Driver-based, projected variable costs scale with projected revenue, fixed costs stay flat, and mixed accounts split by their fixed% share, so your Cost Behavior splits move these numbers. The other models ignore cost behavior and project each account's own history forward.`,
    },
    {
      q: `Why do the Base and scenario lines sometimes overlap exactly?`,
      a: `When the active scenario is the Base Case or has no adjustments, the adjusted path equals the straight projection, so the lines coincide. Pick or adjust a non-baseline scenario, such as Best or Worst, to see them separate.`,
    },
    {
      q: `Do my slider changes save, and can I model on the demo firm?`,
      a: `You can move the sliders to explore on any firm, but on a read-only or shared demo firm those scenario edits are not persisted. On your own firm the adjustments save to the scenario so the impact and the live preview stay in sync.`,
    },
  ],

  operational: [
    {
      q: `Why do different clients show different KPIs on this tab?`,
      a: `Each client's industry profile defines its own metrics. A Trades profile shows Revenue Per Truck, Close Rate, and Labor Efficiency; a SaaS profile shows NRR, Churn, and CAC Payback. There is no hardcoded list, so changing the profile changes the metric set. Every profile also includes the universal Marketing Funnel.`,
    },
    {
      q: `How do I enter the underlying numbers?`,
      a: `On the full Operational Metrics page, click Enter Data. You type each figure once per period as a shared input, and every rate that depends on it derives automatically. Clearing a field deletes that stored value instead of leaving a stale number behind.`,
    },
    {
      q: `Does the shared date range affect the Operational tab?`,
      a: `Yes. This tab respects the shared From/To range, so the months available in the Period selector are the ones inside that window. Mapping, Projections, and What-If are the tabs that ignore the range and always use the full dataset.`,
    },
    {
      q: `What happens if I leave marketing spend blank in the funnel?`,
      a: `The funnel falls back to the marketing and advertising expense accounts detected in your imported P&L for that period. If you do enter a spend figure, that entered number wins instead. This helps clients who do not break marketing out as its own account.`,
    },
    {
      q: `Why does the Marketing Funnel not show a target?`,
      a: `Funnel economics vary too much by industry and franchise for a built-in benchmark, so FinSight ships none for those metrics. If you want a comparison, set a per-client or corporate target in the Targets editor and it will apply here.`,
    },
    {
      q: `How are the KPI targets on each card decided?`,
      a: `Effective targets compose by precedence: a per-client target beats a franchise corporate benchmark, which beats an opt-in industry pack, which beats the FinSight built-in default. This precedence applies to operational metrics too, so corporate benchmark mandates flow through to these cards.`,
    },
    {
      q: `Can I track a metric the profile does not include?`,
      a: `Yes. On the full Operational Metrics page, use Add Custom Metric to define your own. It appears in its own section of the metric grid alongside the profile metrics, computed for the same selected period.`,
    },
    {
      q: `Why is a metric card or the funnel showing blank?`,
      a: `A metric reads blank until its inputs exist for the selected period, and the funnel section stays hidden until lead numbers are entered. The coverage line at the top tells you how many of the profile's metrics have data for that month.`,
    },
  ],

  franchises: [
    {
      q: `Who can create franchises and upload benchmarks or a SCOA?`,
      a: `Only firm owners and admins. Members and the shared public demo firm see a read-only list and cannot create franchises or manage benchmark sets or the corporate chart of accounts.`,
    },
    {
      q: `Does a corporate benchmark override a target I set on an individual client?`,
      a: `No. Client-specific targets win per metric. The franchise's active benchmark set only fills in metrics where the client has no target of its own, and it sits above industry packs and FinSight defaults.`,
    },
    {
      q: `What format does the benchmark CSV need?`,
      a: `Columns are metric_id, target, direction, and an optional notes column. Direction is gte (at or above passes) or lte (at or below passes). Percent metrics are entered as whole percents, so 30 means 30%. Lines starting with # are skipped, and a Download template button gives you a starting file.`,
    },
    {
      q: `Can I keep more than one benchmark set per franchise?`,
      a: `Yes. Sets are versioned. You can store several, expand any set to inspect its metric rows, and activate exactly one at a time. Only the active set applies to linked clients.`,
    },
    {
      q: `What happens if I delete the active benchmark set?`,
      a: `Linked clients fall back to the next tier in order, an opt-in industry pack if one is enabled, otherwise FinSight's built-in defaults, until you activate another set.`,
    },
    {
      q: `What does the corporate SCOA do, and what does its CSV need?`,
      a: `It is one standard chart of accounts shared by every linked client, powering COA audits and account-aligned comparison on each client's Mapping tab. The CSV columns are number, name, type, statement, and parent, with only number and name required. Statement accepts pnl or balance. Uploading a new SCOA replaces the current one wholesale.`,
    },
    {
      q: `If I remove the SCOA, do client account mappings get lost?`,
      a: `No. Removing the SCOA keeps each client's existing account-to-number mappings, but COA audits and account-aligned comparison stop working until you upload a new one.`,
    },
  ],
};
