# FinSight — Session Notes

**Last updated:** 2026-07-22
**Live app:** https://finsight.arktosmarketing.com (+ workers.dev), branch `phase-2a-tenancy`

> **2026-07-23 — QBO INTEGRATION LIVE IN PRODUCTION (version `4851acc2`).**
> Intuit production approval came through 2026-07-22 night; prod redirect URI
> registered (only `https://finsight.arktosmarketing.com/api/qbo/callback`);
> `feature/qbo-integration` fast-forward-merged into `phase-2a-tenancy` after
> a fresh 6-agent merge-readiness review (0 blockers, 11 check suites + tsc
> green on merge day); all 4 QBO secrets set and `cf:deploy` run per runbook
> §C; smoke-verified (login/legal 200, mock routes 404 in prod, connect
> auth-bounces, demo Statements click-through clean). Remaining: runbook §D
> (Derek's first real QBO connect) + post-merge polish chip (4 minor fixes:
> revoke-on-reconnect, sync-stamp race, dangling parentId, 2 error messages).
>
> **2026-07-22 — QuickBooks Online integration BUILT on branch
> `feature/qbo-integration` (now merged; original build notes follow).**
> Full direct-QBO import: per-client OAuth connect (one QBO company per
> workspace — Intuit has NO bulk/firm-level consent, verified), multi-year
> monthly P&L+BS backfill via the Reports API chunked one year per call,
> authoritative account classification from QBO (bypasses the keyword
> classifier via isManuallyClassified), idempotent re-sync keyed on a new
> `Account.externalId` (+ matcher tier + `mergeOverwrite` for prior-period
> restatements), all riding the existing dataset diff/review/commit flow
> (commit logic extracted to `lib/data/dataset-commit.ts`, shared by
> StatementsView and the sync).
>
> **Read `QBO_INTEGRATION_PLAN.md` first** (verified platform facts + locked
> architecture), then `DEREK_QBO_RUNBOOK.md` (every human-only step, incl.
> pre-drafted Intuit assessment answers). DB: additive `qbo_connections`
> migration applied to prod Supabase (invisible to the live app), RLS +
> column-grants proven 10/10 by impersonation — token ciphertext columns are
> structurally unreadable by `authenticated`; tokens are AES-256-GCM
> (`lib/qbo/crypto.ts`, key = future wrangler secret QBO_TOKEN_KEY).
> **Full mock-Intuit flow click-verified end-to-end** in dev (connect →
> company picker → callback → auto-open backfill → 18mo/30-account review →
> commit → statements render → re-sync "Already up to date" → disconnect w/
> revoke+delete+audit): `FINSIGHT_QBO_MOCK=true` serves a fake Intuit at
> `/api/qbo/mock/*` (404s in prod), fixtures in `lib/qbo/fixtures/`.
> Check suites grew to 11 (qbo-oauth, qbo-transform 101 checks, qbo-server,
> dataset-commit + extended datasets).
>
> **Gotcha burned in this build:** a `'use server'` module must export ONLY
> async functions in this Next version — even `export type { X }` of an
> imported binding leaves a runtime export in the server-actions loader and
> 500s EVERY action on the page (ReferenceError at module eval). Types live
> in `lib/qbo/sync.ts` instead.
>
> **NOT done (needs Derek — see runbook):** Intuit developer account + dev
> keys (→ real-sandbox E2E), production keys via the ~40-min one-shot
> assessment, the 4 wrangler secrets AT DEPLOY TIME ONLY (setting a secret
> cuts a new Worker deployment — never do it early), merge + deploy.
> Deferred by design: nightly auto-sync/token-refresh cron (client-driven
> sync avoids the workspace-blob write race for v1), webhooks (Intuit is
> mid-CloudEvents migration), QBO App Store listing (needs Intuit SSO).

> **2026-07-19 — Session-loss bug FIXED: bounced to /login ~1hr after
> sign-in, on every navigation.** Same bug as CallGauge (its commit
> `0872f57` in `~/callgauge`), same fix. Root cause in
> `src/lib/supabase/proxy-client.ts`: the factory returned its `response`
> object BY VALUE before middleware awaited `getUser()`; when Supabase
> rotated the session mid-request, `setAll` reassigned a closure-local and
> the refreshed cookies landed on a response nobody returned. The browser
> kept a burned refresh token → Supabase revoked the token family → every
> protected page bounced to `/login?next=…`.
>
> Fix: `createSupabaseProxyClient` now returns a **`getResponse()` getter**
> (middleware reads it AFTER the auth call), and `middleware.ts` copies auth
> cookie writes onto its redirect responses too
> (`getResponse().cookies.getAll().forEach((c) => res.cookies.set(c))`).
>
> **Proven with a doctored-expiry probe** (recipe, if this ever regresses):
> mint a real session via the demo account password grant
> (`demo@finsight.test`, see DEMO_RUNBOOK.md), set the session JSON's
> `expires_at` an hour into the past, encode as the
> `sb-camphmqvrzqpgrhdjafo-auth-token` cookie (`'base64-' + base64url(JSON)`,
> chunk at 3180 chars into `.0`/`.1` suffixes if longer), GET a protected
> page with that Cookie header, count `headers.getSetCookie()`. Before fix
> (reproduced against prod): 200 with ZERO Set-Cookie. After fix: 200 with
> the refreshed cookie set, and a follow-up request using it stays 200.
> **Gotcha found while verifying: `next dev` does NOT run `middleware.ts`
> in this repo** (no /login redirect at all on plain `next dev`) — verify
> middleware behavior via `wrangler dev` on the OpenNext bundle
> (`npm run cf:preview`) or against prod, never via `next dev`.

> **2026-07-07 — Bob Volpe readiness overnight run (8 commits, deployed + prod
> click-verified).** Everything below in one night; full detail in the commit
> messages `95130dd..` and `~/finsight-handoff/FINSIGHT_BOB_HANDOFF.md`:
>
> **Correctness:** `Account.isExcluded` now honored across the ENTIRE calc
> engine (pnl/balance-sheet/health/profitability/efficiency/projections/
> scenarios/period-comparison — excluded QBO summary rows were double-counting
> everywhere); CSV parser headerToIndex is first-wins (the standard QBO
> blank-header shape silently parsed to ZERO rows); print report no longer
> renders "as of" the OLDEST month and uses the real current-ratio math.
>
> **Sync/billing hardening:** workspaces.version optimistic concurrency
> (+ DB trigger; teammate edits conflict instead of clobber), cloud-sync
> rewrite (visible sync chip Saving…/Saved/Not saved+Retry/conflict+Reload,
> bounded backoff, beforeunload guard, access re-resolve on auth/billing
> refusals), trialing fails closed to read_only after trial_ends_at, open
> redirect sanitized (incl. control-char bypass), workspaces_metadata view
> stripped to SELECT, getClaims() replaces the 2nd serial getUser round-trip,
> read-only firms get real edit gating (ReadOnlyGuard, inert).
>
> **Bob features:** shared-input operational entry (enter each number ONCE
> per period — OperationalInputPool + "Used by" callouts + legacy fallback);
> universal Marketing Funnel group in all 6 profiles (spend/leads/appts/
> customers → CPL, stage %, CAC, ROI + FunnelChart w/ trend); per-client KPI
> targets w/ provenance ("Corporate target" vs "FinSight default benchmark")
> across Overview/Reports/Print/metric cards + Targets editor dialog;
> deterministic plain-English executive summary on Overview/Reports/Print;
> first-run home tour fixed (anchors + per-tour storage keys).
>
> **Checks:** `scripts/checks/*.check.ts` (tsx, headless) — calc exclusion,
> csv fixtures, billing matrix, funnel/pool resolution, exec-summary. Run
> all before deploying. **Seeding:** `scripts/seed/` has the deterministic
> Bella Roma Pizza #42 franchise-client generator + PROVISION_BOB.md (proven
> runbook for Bob's complimentary firm — waiting on his email).
> Demo firm Arktos Advisory now has 3 clients incl. the Bella Roma showcase.
>
> **Known/flagged:** firm "Arktos Bookkeeping" (plan_status=trialing) goes
> read-only when its trial_ends_at passes 2026-07-12 — intended fail-closed
> behavior; set plan_status='active' if it should stay complimentary.
> ~~Resend SMTP still not wired~~ **RESOLVED 2026-07-07 (later session):
> Resend custom SMTP live in Supabase Auth, delivery verified end-to-end
> (real OTP → Resend "delivered" from finsight@arktosmarketing.com).**
**GitHub:** https://github.com/Derek-Bearman/finsight
**Deploy command:** `cd ~/Documents/finsight && git pull && npm run cf:deploy`

> **SaaS conversion in progress.** As of 2026-05-25 FinSight is mid-pivot
> from a localStorage-only single-browser tool to a multi-firm SaaS on
> Supabase. Phase 1 (auth shell) is DONE and live. Phases 2-5 (firm
> tables, workspace CRUD + RLS, snapshots, invites, billing) are NOT
> built yet — workspaces still persist to browser localStorage. See
> "SaaS conversion plan" section below.
>
> **2026-07-03 — full execution plan written: `FINSIGHT_SAAS_HANDOFF.md`.**
> Locks the product decisions ($97/mo per firm, 7-day card-upfront trial,
> firm signup + team invites/roles, limited-access super-admin) and the target
> schema/RLS/Stripe/super-admin architecture, phasing, gotchas, and 7 open
> decisions. Read that doc before starting Phases 2–5. Also: the Supabase
> project auto-paused on the free tier (that was a "Failed to fetch" login
> outage) and was restored to ACTIVE_HEALTHY — but it **re-pauses after ~7 idle
> days**; decide Pro vs keep-alive.

> Future-Claude pickup doc. Read this first when resuming work on FinSight.
> If something here contradicts the actual codebase, trust the codebase
> — but tell the user the doc drifted so we can update it.

---

## Current state

All 8 phases of the original spec are built (data model, CSV import,
mapping UI, calculations, projections, visualization, what-if scenarios,
operational metrics). On top of that, recent sessions shipped:

- **2026-07-08 Stripe TEST-mode billing LIVE + verified end-to-end (live
  version `e5d7956c`)** — product/price ($97/mo)/webhook created via API in
  Derek's Stripe account (test mode), all 3 wrangler secrets set. Proven with
  a real throwaway signup: /onboarding → hosted Checkout (card 4242, 7-day
  trial, card-upfront) → `checkout.session.completed` webhook →
  `create_firm_with_owner` + `apply_stripe_status` → firm `trialing`,
  `trial_ends_at` +7d → /billing renders status + working Billing Portal.
  Test firm/user/customer all deleted after. **Found + fixed in the process:
  `FINSIGHT_ALLOW_DIRECT_SIGNUP=true` in `.env.local` had been BAKED INTO the
  prod bundle by `next build`, so prod signup silently skipped Stripe and
  created free firms** — flag moved to `.env.development.local` (dev-only;
  production builds never load it), rebuilt, redeployed. Live-mode Stripe
  (real keys + live price + live webhook) still pending — see
  DEPLOY_RUNBOOK step 1.

- **2026-07-07 final polish pass (this session, commits `f6b60a6..`,
  live version `05b3d3e7`)** — Resend custom SMTP is LIVE in Supabase
  (sender finsight@arktosmarketing.com, delivery verified end-to-end via
  a real OTP → Resend "delivered"; email rate limit 30/hr). A 6-dimension
  full-app adversarial review (cross-feature datasets, multi-tab sync,
  calc correctness, responsive/theme, first-run, import/merge) raised 22
  findings, 21 CONFIRMED, all fixed + regression-checked:
  - Imports: dataset switch discards in-flight review (was: merge could
    pollute the wrong dataset); duplicate-name matcher claims Nth↔Nth;
    additive merge paths for same-period BS imports and new-accounts-only
    imports; merge toast reports actual result.
  - Calcs: quarterly/annual series now snapshot balance-sheet ENDING
    balances instead of summing months (`aggregateValuesStockAware` in
    period-aggregation, used by balance-sheet/efficiency/profitability/
    health series); breakeven with CM ≤ 0 is Infinity + red (never green
    "$0 breakeven"); bucket day-counts fixed (was 30 hardcoded); exec
    summary anchors on the latest month WITH P&L data.
  - Sync: mid-session read_only no longer permanently kills cloud sync —
    30s access recheck + visibilitychange re-resolve, pending saves flush
    on recovery.
  - What-If: impact panels compute TRAILING 12 MONTHS (were mislabeled
    all-history totals); orphaned adjustments (stale account ids after
    re-import) excluded from calc + surfaced with names; picker filtered
    to non-excluded P&L accounts; 375px layout; touch-visible card actions.
  - First-run: wizard manual account entry actually persists (was no-op);
    wizard seeds REAL Best/Worst adjustments; empty-state Import CTAs
    deep-link to the workspace's Statements import (`?tab=` param now
    honored) instead of the duplicate-creating home wizard.
  - Print/PDF: P&L chunks into stacked 6-month fit-width tables (was
    clipping everything past ~6 columns in the letter page); BS column
    labeled "Ending"; dark: utilities stripped from banners (app is
    single-theme).
  All 6 check suites green (datasets/calculations/insights grew new
  regressions that fail on the old code). Prod click-verified: print fit
  (612px=612px), trailing-12 impact, quarterly ratios ending-balance,
  "Ending" label, ?tab= deep link, header flex-wrap + pointer-coarse CSS.

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

- **PDF export** (commit `6e66f24`) — `/workspace/[clientId]/print`
  route renders a full client report (cover, exec summary, P&L, ratios,
  12mo projection, operational metrics), auto-fires `window.print()`
  ~1.5s after hydration. "↓ PDF" button in the workspace header. Print
  CSS in globals.css. Recharts SVGs print at vector quality, no
  react-pdf dependency. Sections skip gracefully on missing data.

- **Phase 1 — Supabase auth shell** (commits `e6e19ed` → `6206371` →
  `cf1de87` → `d2e5edd`) — the app is now gated behind a login.
  Passwordless OTP-code sign-in (user enters email → 6-to-8-digit code
  arrives → types it → session). Verified end-to-end against a real
  Outlook inbox: code email delivered, sign-in succeeded, dashboard
  loaded, sign-out returned to /login. **No firm/multi-tenancy yet** —
  this is purely "who are you?". Workspaces still live in localStorage.
  Full detail in the "SaaS conversion plan" + "Auth architecture"
  sections below.

---

## SaaS conversion plan (the big arc)

Decision (2026-05-25): FinSight is going from localStorage-only to a
multi-firm SaaS. Derek chose **Standard SaaS** (data in our DB,
encrypted at rest by the provider, no customer-managed keys) over the
client-side-encryption option. Positioning shifts from "data never
leaves the browser" to "your firm's data, scoped to your firm,
encrypted at rest, audit-logged, never used to train AI or sold."

Stack chosen (constraint: free tier, Derek already has Supabase +
Cloudflare, wants to learn fundamentals):
- **Supabase end-to-end** — Auth + Postgres + (later) Storage. Single
  vendor. Free tier covers v1. RLS enforces tenancy at the DB layer.
- Hosting stays **Cloudflare Workers** via @opennextjs/cloudflare.
- NOT using Clerk (would've abstracted away the multi-tenancy learning
  + adds a vendor). NOT using D1 (Supabase Postgres chosen instead for
  RLS + single-vendor simplicity).

Phases:
- **Phase 1 — auth shell** ✅ DONE (this session). Login gate, OTP
  sign-in, sign-out, session middleware. No firm, no DB tables yet.
- **Phase 2 — firm tables + workspace CRUD + RLS** ⬜ NOT STARTED.
  `firms`, `users` (firm_id FK + role), `workspaces` (firm_id FK).
  Pool-model tenancy: every row has firm_id, RLS policies scope all
  reads/writes. Workspaces sync localStorage ⇄ Postgres. On first
  login, prompt to import existing localStorage workspaces (Derek's
  choice: prompt, not auto-import, not ignore).
- **Phase 3 — snapshots** ⬜. Point-in-time saved reports per workspace
  (store workspace JSON + re-render PDF on demand from the print route).
  This is the "log in from anywhere and review historical reports" use
  case.
- **Phase 4 — firm invites + roles** ⬜. Owner invites teammates; shared
  client list.
- **Phase 5 — billing** ⬜. Stripe, per-firm plans. Only when revenue
  justifies.

Decisions locked for v1: NO "local-only workspace" escape hatch (drop
it; add later if a customer asks). Import-on-first-login = prompt with
per-workspace checkboxes.

---

## Auth architecture (Phase 1, as shipped)

**Provider:** Supabase Auth, passwordless email OTP. Project ref
`camphmqvrzqpgrhdjafo`. Org "Derek-Bearman's Org", free tier.

**Files:**
- `src/lib/supabase/client.ts` — browser client (anon/publishable key).
- `src/lib/supabase/server.ts` — server client for Server Components /
  Actions / Route Handlers. Uses Next 16's **async** `cookies()`.
- `src/lib/supabase/proxy-client.ts` — variant for middleware.ts; uses
  request/response cookie adapters instead of `next/headers`.
- `middleware.ts` (project root) — refreshes session on every matched
  request, redirects unauthenticated users to `/login?next=…`, bounces
  authenticated users off `/login`. PUBLIC_PATHS = /login, /auth/*.
- `src/app/login/page.tsx` — two-step OTP form (email → code).
- `src/app/auth/callback/route.ts` — magic-link fallback (exchangeCode).
- `src/app/auth/signout/route.ts` — POST-only signout.
- "Sign out" button in the home header (POST form, never GET).

**Login flow:** `signInWithOtp({ email })` emails a code → user types it
→ `verifyOtp({ email, token, type: 'email' })` sets the session cookie →
`window.location.assign(next)` so middleware sees the fresh cookie.

**Why OTP code, not magic link:** Outlook Safe Links (and corporate
email gateways) flag/block URLs pointing at the random-string Supabase
subdomain (`camphmqvrzqpgrhdjafo.supabase.co`). A numeric code in the
email body has no URL to scan. The magic-link path (`/auth/callback`)
still works as a fallback if a user clicks the link instead.

### Gotchas burned into the build (DO NOT regress)

1. **It's `middleware.ts`, not `proxy.ts`.** Next 16 renamed Middleware
   → Proxy at the user-facing level, but @opennextjs/cloudflare 1.19.x
   still tracks the legacy `server/middleware.js` filename when bundling
   the standalone output. Using `proxy.ts` → build fails with "File
   server/middleware.js does not exist". So the file is `middleware.ts`
   and exports `middleware()`. Revisit when OpenNext catches up.

2. **NEXT_PUBLIC_* must be in `.env.production`, NOT just wrangler.jsonc
   vars.** Next inlines NEXT_PUBLIC_* into the CLIENT bundle at
   `next build` time. wrangler.jsonc `vars` only exist at Worker
   RUNTIME. Symptom if missing: browser console "Missing
   NEXT_PUBLIC_SUPABASE_URL". `.env.production` is committed (values are
   public-safe; RLS protects) via a .gitignore exception. The same two
   values live in BOTH .env.production (build) and wrangler.jsonc vars
   (runtime) — keep them in sync.

3. **CSP `connect-src` must allowlist Supabase.** worker.ts ships a
   strict CSP. The original `connect-src 'self'` blocked all browser→
   Supabase fetches (symptom: "Failed to fetch", no network request
   leaves the page). Now `connect-src 'self' https://*.supabase.co
   wss://*.supabase.co`. NEVER widen to `*`.

4. **OTP length is server-side and is currently 8 digits, not 6.**
   Supabase emits 8-digit codes for this project. The login input is
   length-agnostic on purpose (label "Verification code", accepts ≥4
   digits, maxLength 12) — do NOT hard-code 6. Length is configurable
   under Supabase → Auth → Email provider settings if 6 is ever wanted.

### Supabase dashboard config that lives OUTSIDE the repo

These are set in the Supabase dashboard, not in git — if the project is
ever recreated, re-do them:
- **Auth → URL Configuration:** Site URL = the Workers URL; Redirect
  URLs include `/auth/callback` (prod) + `http://localhost:3000/auth/callback`.
- **Auth → Emails → template:** the "Magic Link" template body was
  replaced with a code-only template (`{{ .Token }}`, no
  `{{ .ConfirmationURL }}`) so no link ships in the email. (Subject line
  may still say "sign-in link" — harmless, can be updated to "code".)
- **wrangler secret:** `SUPABASE_SERVICE_ROLE_KEY` set via
  `wrangler secret put` (NOT in wrangler.jsonc). Not used in Phase 1 but
  ready for Phase 2 admin ops (firm provisioning, invites).

### Pending auth follow-ups (not blocking 3-person testing)

- **Custom SMTP via Resend** — built-in Supabase email is capped ~3-4/hr
  shared + middling deliverability. Resend free tier = 3k/mo from your
  own domain. Requires the domain first. Do before wider testing.
- **Custom domain** — still on `*.workers.dev`. Buying ~$15 domain this
  week (finsight.app / getfinsight.com / etc.). Wire to Worker via
  Cloudflare custom domain after purchase.
- **Supabase Pro custom auth domain** (tier 4, $25/mo) — only if going
  back to magic links or enterprise procurement demands it. Premature.

---

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
  for scripts/styles (Next hydration + Tailwind). `connect-src` is
  `'self' https://*.supabase.co wss://*.supabase.co` (widened from
  `'self'` in Phase 1 so the browser can reach Supabase Auth — see Auth
  architecture gotcha #3; never widen to `*`). `frame-ancestors 'none'`
  blocks clickjacking
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

> **As of 2026-05-25 the #1 priority is Phase 2 of the SaaS conversion**
> (firm tables + workspace CRUD + RLS), NOT the Tier 1 analysis features
> below. The analysis layer is feature-complete enough for testing;
> Micah + Vince are test-driving it. What unblocks the product now is
> persistence + multi-tenancy. Pick up Phase 2 unless Derek redirects
> based on tester feedback. See "SaaS conversion plan" near the top.
>
> Before Phase 2 coding, the cheap infra follow-ups (Resend SMTP +
> custom domain) should land so testing doesn't trip the email rate
> limit — see "Pending auth follow-ups".

### Tier 1 — biggest demo / production impact
- ~~**PDF export of reports**~~ — **shipped** in commit `6e66f24`. New
  route at `/workspace/[clientId]/print` that renders a full client
  report (cover, exec summary, P&L, ratios, projections, operational
  metrics), auto-fires `window.print()` ~1.5s after hydration, and the
  workspace header has a new "↓ PDF" button. Print CSS in
  `globals.css` handles page-breaks + chrome-hiding. Recharts SVGs
  print at vector quality — no react-pdf dep needed.
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
   `05b3d3e7` and the latest commit was the 2026-07-07 final-polish
   series (see Current state, top entry).
5. Ask the user what they want to tackle, or propose from the queued
   list above. **Default next priority is Phase 2 of the SaaS
   conversion** (firm tables + workspace CRUD + RLS) — see "SaaS
   conversion plan" near the top. The Tier 1 analysis features (cash
   flow recon, period comparison) are deprioritized below persistence /
   multi-tenancy. Check whether Micah + Vince's testing feedback has
   landed first — it may reshape priorities.

When in doubt about whether something already exists: search the
codebase. The architecture is intentionally clean — pure calculation
functions in `lib/calculations/`, classifier in `lib/classifiers/`,
profile configs in `lib/profiles/`, parsers in `lib/parsers/`, types
in `src/types/`. Component code is thin and shouldn't contain business
logic.
