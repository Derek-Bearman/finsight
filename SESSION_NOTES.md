# FinSight — Session Notes

**Last updated:** 2026-05-25
**Live app:** https://finsight.bearman-derek.workers.dev (version `3007e0a0` — post Cowork bug sweep)
**GitHub:** https://github.com/Derek-Bearman/finsight
**Deploy command:** `cd ~/Documents/finsight && git pull && npm run cf:deploy`

> Future-Claude pickup doc. Read this first when resuming work on FinSight.
> If something here contradicts the actual codebase, trust the codebase
> — but tell the user the doc drifted so we can update it.

---

## Current state

All 8 phases of the original spec are built (data model, CSV import,
mapping UI, calculations, projections, visualization, what-if scenarios,
operational metrics). On top of that, recent sessions shipped:

- **Phase 3.5** — mapping UI iteration (bulk select, keyboard shortcuts,
  source filter chips, section-context conflict warnings, refresh-auto
  button that preserves manual overrides)
- **Security hardening** — Tier 1 from the audit (xlsx pinned to CDN
  patched build, Next bumped to 16.2.6, CSP + 5 other defense-in-depth
  headers via a custom Worker wrapper, privacy-mode toggle)
- **JSON workspace export/import** — portable `.finsight.json` files for
  backup, cross-browser migration, and colleague handoff
- **Pre-demo Cowork bug sweep** (2026-05-25, commits `dd5acb9` + `1011b8d`)
  — wizard P&L/BS steps explicitly labeled "(Optional)" with the
  redundant "Skip for now" link removed; Done page copy now conditional
  on account count; Clear Data swapped from `window.confirm` to a shadcn
  Dialog ("Cancel" / "Clear data" with a destructive variant);
  Recent Workspaces moved to TOP of home when present with a "+ New
  Workspace" CTA and a bolded "Saved in this browser only · no cloud
  sync" trust signal; granularity (Monthly/Quarterly/Annual) now shared
  across Overview + Reports via lifted state at `WorkspacePage`
  level; industry icons swapped from emoji to Lucide via a new
  `src/components/ui/profile-icon.tsx` helper (HardHat / Briefcase /
  Store / UtensilsCrossed / Cloud / Building2); Projections "default"
  badge hides itself when its model is selected (kills the
  double-blue); tutorial resets to step 1 on every "?" click and the
  bubble counter now prepends a `tourLabel` ("Home tour" vs "Workspace
  tour"); Privacy mode toggle ON state is now solid red fill + "PRIVACY
  ON" label + a "LIVE" micro-badge; "3 scenarios" pill restyled as
  non-interactive badge; Export disabled on empty with tooltip and
  fires a success toast on click; What-If tab guards against zero-data
  with an empty-state message; Projections horizon collapsed "12 Mo" +
  "1 Yr" into a single "1 Yr" option; Step indicator label
  "Classification" → "Classify"; empty-state copy across all 6 tabs
  standardized to "No financial data yet — import a P&L or balance
  sheet to see [feature]"; Operational header reads as natural
  language instead of "0 metrics · 0 with data"; mapping toolbar
  audit-log button restyled with proper button affordance + count
  badge; source-filter chip tooltips added; reset-all-mapping disabled
  tooltip clarified.

Deliberately NOT addressed: the Beta badge stays (correctly sets
pre-1.0 expectations), and the FileDropzone already has drag-active
styling (Cowork didn't drag-test).

## How the deploy works

- Local repo: `~/Documents/finsight`
- `npm run cf:deploy` → `next build` → `opennextjs-cloudflare build` → `wrangler deploy`
- Custom `worker.ts` at project root wraps the OpenNext-generated
  `.open-next/worker.js` to inject security headers. wrangler.jsonc
  `"main"` points to `worker.ts`, not the generated worker.
- gh CLI is installed and OAuth'd as `Derek-Bearman` for git push
- macOS keychain is seeded — `git push` works non-interactively

## Tooling permissions

`~/.claude/settings.local.json` has Bash allowlist entries for:
- git push/pull/fetch/reset/merge/rebase/checkout/stash/branch/remote/commit/add/status/log/diff
- npm install/run cf:deploy/run cf:build/run build/run dev/run test
- npx wrangler/npx tsc
- gh
- brew

Auto Mode classifier may still block some commands (it blocked
`wrangler whoami` in the recent session with a spurious "pushing to
main" reason). To bypass for a session: `Shift+Tab` to cycle permission
modes until "bypass permissions" shows at the bottom.

---

## Architecture decisions worth knowing

### Parser → Classifier section pipeline (most important recent change)

The CSV/XLSX parser walks rows in document order and tracks which section
header it's currently under (ASSETS, LIABILITIES, EQUITY, Income, COGS,
Expenses, plus subsection headers like "Current Assets", "Property,
Plant & Equipment", "Long-Term Liabilities"). Each surviving ParsedRow
gets a `section?: 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense'`
field. Section header rows themselves are filtered from the output —
**unless** they have non-zero values (handles the common case where a
template uses the same name for both a section header and a leaf
account, e.g. "Other Assets" appearing twice in a BS template).

The classifier (`classifyAll`) accepts an optional `statementType`
('pnl' | 'balance_sheet'). When set, the parser's section hint **always
wins** over keyword-based classification. Example: "Customer Deposits"
keyword-matches `deposits` → asset, which IS valid on a BS, so a naive
"only override if invalid type" rule would let it through as asset.
But if the row sits under a LIABILITIES section header, it's clearly a
liability. Section wins unconditionally → correctly classified.

The Account type persists `detectedSection` so the classifier can be
re-run on existing workspaces (via the "Refresh auto-classified" button
in the mapping toolbar) without re-importing.

### Mapping UI selection model

`MappingViewA` owns three pieces of state for bulk + keyboard nav:
- `selectedIds: Set<string>` — bulk selection
- `lastClickedId: string | null` — anchor for shift-click range
- `focusedId: string | null` — keyboard focus indicator

Click behaviors:
- Plain click → replace selection with just this card
- Shift-click → range-extend from `lastClickedId` across the
  `visibleAccountsOrdered` list (which spans all columns + excluded)
- Cmd/Ctrl-click → toggle this card in/out of selection
- Cmd/Ctrl-A → select all visible cards
- Esc → clear selection

Drag behavior: if the dragged card is in `selectedIds` AND size > 1,
the drop affects every selected account with **one** bulk audit entry
(not N). The drag overlay shows a `+N` count badge.

Keyboard shortcuts (active when not typing in an input/select/textarea):
- `1`-`6` → set type (Revenue / COGS / Expense / Asset / Liability / Equity)
- `E` → exclude (for subtotal rows)
- `Esc` → clear selection
- `Cmd/Ctrl-A` → select all visible

When nothing is selected, `1`-`6` and `E` apply to the focused card
(set on any click), so single-card workflows still benefit.

### Privacy mode

Module-level `privacyModeEnabled` flag inside a custom Zustand
`StateStorage` adapter (`conditionalStorage`). When ON, writes to
localStorage are silently dropped. Enabling it via the header toggle:
1. Shows a confirm dialog explaining the trade-off
2. Wipes the existing `finsight-workspaces` localStorage key
3. Sets the module flag
4. In-memory Zustand state continues to work for the session

The mode itself is NOT persisted — users opt in fresh per session.
Closing the tab loses everything (which is the point).

### Security headers wrapper

`worker.ts` at project root imports the OpenNext-generated worker and
wraps its fetch handler to add 6 response headers on every request:

- `Content-Security-Policy` — `default-src 'self'` with `'unsafe-inline'`
  for scripts/styles (Next hydration + Tailwind), `connect-src 'self'`
  blocks exfiltration if XSS slips in, `frame-ancestors 'none'` blocks
  clickjacking
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Referrer-Policy: same-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), …`

`tsconfig.json` excludes `worker.ts` and `.open-next/` from the Next
build's tsc pass — `worker.ts` is a Workers entrypoint, not part of
the Next app.

### ProfileIcon helper (post-bug-sweep)

`src/components/ui/profile-icon.tsx` exports a `<ProfileIcon profileId=…
size=… />` component that maps profile id → Lucide icon. **The
`IndustryProfile.icon` string field on each profile is now ignored by
renderers** — it's kept for backward compat with persisted workspaces
but no UI reads it. To swap or add an icon: edit the `ICON_MAP` in
profile-icon.tsx, NOT the individual profile files. This keeps the
data-only profile system clean.

### Shared period state across Overview + Reports

`granularity` state lives at the top-level `WorkspacePage` component
(`sharedGranularity`) and is passed down to `<OverviewTab>` and
`<ReportsTab>` as `granularity` + `onGranularityChange` props. Both
tabs render their own period selector but write through the shared
setter, so switching tabs preserves the user's choice. Default is
`'monthly'`. Reports used to default to `'annual'` (deliberate
income-statement choice) — that was sacrificed for cross-tab
consistency because Cowork's testing showed users assumed it
persisted. If a future session wants tab-specific defaults again,
fork the state back to per-tab and add a top-level toggle.

### Tour overlay reset effect

`TourOverlay` has a `useEffect` that resets `currentIdx` to
`startAtStep` whenever that prop changes — guards against the
re-render case where the parent reopens the tour at a different step
but React reuses the component instance and skips re-init of the
initial state. Combined with `tourHook.openTour(0)` from both
`HelpButton` triggers, "?" always restarts the tour at step 1.

The `tourLabel` prop is shown in the step counter ("Home tour · Step 1
of 5" vs "Workspace tour · Step 1 of 8") so users can tell the two
tours apart.

### Clear Data confirmation pattern

`<Dialog>` from `@/components/ui/dialog` (shadcn / base-ui), opened by
local state `showClearConfirm` in `WorkspacePage`. Two buttons —
`variant="outline"` Cancel + `variant="destructive"` "Clear data" —
plus the X close. Single-step confirm, not typed-DELETE: appropriate
for browser-local data scope. On confirm, calls `clearWorkspaceData`
(keeps scenarios, wipes accounts + values) and fires a
`showHeaderToast` "Imported data cleared". Same toast helper also
fires on successful Export.

### JSON workspace export format

```json
{
  "format": "finsight-workspace",
  "version": 1,
  "exportedAt": "ISO 8601",
  "app": { "name": "FinSight" },
  "workspace": { /* full ClientWorkspace */ }
}
```

A bare `ClientWorkspace` (no envelope) is also accepted on import for
hand-edited or legacy files, with a warning. Future-version envelopes
import with a warning, not a hard error. Id collisions get a suffix.
**Mapping memory is deliberately NOT exported** — it's cross-client,
scoped per-profile, and including it would pollute classifications in
other workspaces on the receiving machine.

---

## What's queued (next-action menu)

Rough effort estimates assume one focused Claude session.

### Tier 1 — biggest demo / production impact
- **PDF export of reports** (~1-2hrs) — in the original spec's
  "Done Definition for the Demo" but doesn't exist yet. Use react-pdf
  or print-CSS. Accountants present in PDF.
- **Cash flow reconciliation** (~2-3hrs) — when P&L net income diverges
  from cash balance changes, flag it ("strong profit but receivables/
  inventory are choking the business"). Spec called this out as
  real-world accountant gold.
- **Side-by-side period comparison view** (~2hrs) — "This Q3 vs last
  Q3" with variance + percent change columns. Spec asked for it, math
  already exists in `lib/calculations/period-aggregation.ts`.

### Tier 2 — meaningful polish
- **Statement-type view filter on mapping** (~30min) — for BS-only or
  P&L-only workspaces, hide the irrelevant columns
- **Undo/redo on mapping** (~1.5hrs) — wrap mutations in a small undo
  stack (~10 levels). Audit log already records each change.
- **Mobile/touch drag** (~10min) — add `TouchSensor` to `@dnd-kit`
  config; activation distance bump for touch.
- **"What changed?" session summary** (~2hrs) — modal on "View Reports"
  showing impact of mapping changes ("gross margin +4.2pts, current
  ratio +0.15, breakeven −$8,200").
- **Workspace passphrase encryption** (~3hrs) — WebCrypto AES-GCM with
  PBKDF2-derived key. Encrypts localStorage value. Mandatory: clear
  "forgot passphrase = data is gone forever" UX warning.
- **PII redaction at import** (~2hrs) — toggle "Anonymize customer/
  vendor names". Replaces matched names with `Customer_001`,
  `Vendor_A`, etc. before saving.
- **Access audit log** (~30min) — add `viewedAt` events to the audit
  log so user can spot anomalies.
- **Workspace rename UI** (~45min) — Cowork bug report #22. No
  discoverable way to rename a workspace once created. Likely a pencil
  icon next to the workspace title in the header that opens an inline
  edit. Store already supports the mutation.
- **Slug-based workspace URLs** (~1.5hrs) — Cowork bug report #23.
  Currently URL is `/workspace/ws-1779707018806` which is
  unprofessional in a screenshare. Switch to client-name slug
  (`/workspace/acme-plumbing-llc`) with an id-based fallback for
  legacy bookmarks. Workspace store needs id↔slug index.

### Tier 3 — bigger swings
- **Stage-and-commit mapping mode** — defer changes until user clicks
  Apply
- **Mapping memory inspector UI** — view/edit/export the
  cross-workspace memory store
- **Column pin/collapse on mapping** — manage large COAs better
- **Custom account add-in-place** — inline "+" per column on mapping

---

## Known gaps / non-bugs

- **BluefinPlumbing 3Yr model has ~$3K Dec-22 BS rounding diff.** This
  is rounding noise in the source file (typed totals, not formula-
  derived), not a parser bug. The $10 BS-balance threshold suppresses
  the warning. User has accepted this as expected behavior.
- **mappingMemory has no UI.** The store writes per-workspace
  classifications to `mappingMemory[]` but there's nowhere to view,
  edit, or export them. Tier 3 item.
- **No mobile drag** — the mapping page is desktop-only until TouchSensor
  is added.
- **Excluded column visual** — currently a 7th drop zone; could be a
  filter chip instead (Tier 3).
- **xlsx 0.20.3 pinned to CDN tarball.** When SheetJS publishes a newer
  patched version, update `package.json` manually (npm won't see CDN
  versions in the registry).

---

## Things explicitly NOT to do

- **Don't add usage analytics, telemetry, or error reporting that sends
  data off-device.** Right now the app has a rare and valuable property:
  no user data EVER leaves the browser. Even Sentry would capture stack
  traces with variable values that might include account names or
  amounts. For a financial tool, this trade isn't worth it pre-launch.
- **Don't roll your own crypto** if implementing passphrase encryption.
  WebCrypto API only. Never write your own AES or hash.
- **Don't put `if (profile === 'restaurant')` branches in components.**
  All industry-specific logic must live in `lib/profiles/` as data.
  The whole point of the profile system is data-driven, not code-
  branching.
- **Don't bump Next.js across minor versions blindly.** This project's
  `AGENTS.md` warns Next has breaking changes — read
  `node_modules/next/dist/docs/` first when planning a minor bump.
- **Don't add fetch calls to third-party APIs.** Same reasoning as
  analytics — the no-network-egress property is a feature.

---

## How to pick up work

A clean way for a future Claude to resume:

1. Read this file (you're doing that now).
2. `git log --oneline -20` to see recent commit titles.
3. `git log --format='%H %s%n%n%b' -10` to see commit bodies with the
   architectural rationale.
4. Check the live app version vs latest commit hash to confirm
   nothing's drifted. As of last update the live version was
   `3007e0a0` and the latest commit was `1011b8d`.
5. Ask the user what they want to tackle, or propose from the queued
   list above. **Top of Tier 1 is still PDF export** — listed in the
   original "Done Definition for the Demo" but never built.

When in doubt about whether something already exists: search the
codebase. The architecture is intentionally clean — pure calculation
functions in `lib/calculations/`, classifier in `lib/classifiers/`,
profile configs in `lib/profiles/`, parsers in `lib/parsers/`, types
in `src/types/`. Component code is thin and shouldn't contain business
logic.
