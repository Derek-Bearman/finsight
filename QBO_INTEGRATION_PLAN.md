# FinSight — QuickBooks Online Integration Plan

**Created:** 2026-07-22 · **Branch:** `feature/qbo-integration` (off `phase-2a-tenancy`) · **Status:** building

> **Prime directive for every session and agent working on this:** the LIVE app
> (deployed from `phase-2a-tenancy`, live at finsight.arktosmarketing.com) must not
> change. NO `cf:deploy`. NO `wrangler secret put` (it cuts a new Worker deployment
> version even with unchanged code). Database changes are STRICTLY ADDITIVE (new
> objects only — never alter existing tables, policies, grants, triggers, or RPCs).
> The public demo must keep working untouched throughout.

## 0. What this is

Direct QuickBooks Online import for FinSight. Two personas, one feature:

- **Accounting firm owner** (QBO Accountant user): connects their own books AND each
  client's books. One FinSight client workspace = one QBO company.
- **Solo business owner**: a firm with one workspace connecting one company.

Goal: import real historical monthly P&L + Balance Sheet (multi-year) plus the chart
of accounts, with exact account classification, idempotent re-sync, and clean handling
of prior-period restatements.

## 1. Verified platform facts (researched + adversarially fact-checked 2026-07-22)

All confirmed against live developer.intuit.com docs. Do not re-litigate these.

**OAuth / connection model**
- Authorization is strictly per-company: one grant = one `realmId`. No firm-level or
  bulk consent exists anywhere in the platform. An accountant connects each client
  company one at a time via Intuit's company picker (~3 clicks per company). Intuit's
  own docs model exactly our scenario (accountant + N clients = N+1 connections under
  one Intuit login, mapped by realmId).
- Endpoints: authorize `https://appcenter.intuit.com/connect/oauth2`; token
  `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`; revoke
  `https://developer.api.intuit.com/v2/oauth2/tokens/revoke`. Scope for us:
  `com.intuit.quickbooks.accounting` ONLY (adding a scope later forces every
  connected company to re-authorize — do not add openid for v1).
- `state` param is REQUIRED (server rejects without it). PKCE is NOT supported —
  confidential client only; the token exchange needs the client secret, so the
  callback is server-side.
- `realmId` arrives as a query param on the redirect (not in the token response).
- Redirect URIs are exact-match, HTTPS-only, no IPs, no query params. Register ONLY
  `https://finsight.arktosmarketing.com/api/qbo/callback` in production (not
  workers.dev). Sandbox/dev may use `http://localhost:3011/api/qbo/callback`.
- Auth codes are single-use: a duplicate exchange invalidates the first exchange's
  tokens. Guard against double-firing callback handlers.

**Tokens (the #1 place QBO integrations die)**
- Access token: 3,600 s. Refresh token: 100-day ROLLING expiry (extended on each
  use), ROTATES roughly every 24 h — any refresh response may carry a new
  refresh_token and the old one silently dies. Persist the newest pair atomically on
  every refresh. NEVER run two refreshes concurrently for one realm (Intuit's
  anti-replay can revoke the whole token family → full re-consent).
- NEW (Nov 2025 policy): hard 5-year max refresh-token validity
  (`x_refresh_token_hard_expires_in`; request header
  `x-include-refresh-token-hard-expires-in: true`). A "Reconnect URL" field in the
  developer portal is mandatory from 2026-02-24. Build reauth UX as a first-class
  state, not an error.
- After 100 idle days (or revocation/disconnect) there is NO programmatic recovery —
  user must redo consent.

**Data API**
- Reports: `GET /v3/company/<realmId>/reports/ProfitAndLoss` and `/reports/BalanceSheet`
  with `start_date`, `end_date` (YYYY-MM-DD), `summarize_column_by=Month`,
  `accounting_method=Accrual|Cash` (default Accrual for us). BS monthly columns are
  month-END balances (matches FinSight's ending-balance semantics). Response is a
  recursive `Header/Columns/Rows` tree with `ColData` leaves; account rows carry the
  QBO account `id` attribute.
- No documented lookback limit; hard 400,000-cell cap per response and 504 risk above
  ~25 columns → chunk multi-year pulls ONE YEAR PER CALL (12–13 monthly columns).
- Chart of accounts: `SELECT * FROM Account WHERE Active IN (true,false)` via
  `/query` (STARTPOSITION/MAXRESULTS pagination, max 1000/page — include inactive:
  old P&L lines map to now-inactive accounts). Fields: Id, Name, AcctNum,
  AccountType, AccountSubType, Classification (Asset|Equity|Expense|Liability|Revenue
  — note: NO COGS in Classification; COGS comes from AccountType
  "Cost of Goods Sold"), Active, SubAccount, ParentRef, FullyQualifiedName.
- Rate limits (re-enforced Nov 2024): 500 req/min per realm, 10 concurrent/s per
  realm+app, 429 = ThrottleExceeded → back off. Parallelize across companies,
  serialize within one.
- Webhooks are entity-level only (no report webhooks) AND mid-migration to
  CloudEvents (deadline 2026-05-15). v1 uses on-demand/scheduled re-pull, NO webhooks.
- `minorversion=75` is the only version; values <75 silently coerced since 2025-08-01.
- Pricing: App Partner Program (live Nov 2025). Free "Builder" tier = 500K metered
  read (CorePlus) calls/month; overage HARD-BLOCKS reads (not billed). Our volume is
  trivially under (backfill ≈ 12 calls/company; keep loop guards anyway). Sandbox
  calls unmetered.
- Sandbox: up to 10 pre-seeded companies per dev account, own base URL
  `https://sandbox-quickbooks.api.intuit.com`; shallow data (a few months) — fine for
  schema work, won't exercise multi-year chunking.

**Going to production (Derek's side — see DEREK_QBO_RUNBOOK.md)**
- Self-serve, $0, NO App Store listing required for an unlisted app serving arbitrary
  customers; no connection cap (>500 connections triggers annual Intuit review).
- Requires: hosted Privacy Policy URL + EULA URL, host domain, launch/disconnect/
  connect URLs, HTTPS redirect URI, then a ~40-min assessment questionnaire
  (CANNOT be edited after submit; rejection freezes NEW connections — prep answers
  first). Approval status typically ~5 minutes.
- Ongoing obligations: encrypted token storage (AES; key stored separately), annual
  security attestation, breach reporting, Intuit vuln-scan cooperation on 2 weeks
  notice, support channel, TLS 1.2+.
- QBOA Apps-tab discovery (in-QuickBooks marketing) would need App Store listing +
  Intuit SSO — explicitly OUT of scope for v1. Accountants connect from FinSight's UI.

## 2. Architecture decisions (locked)

1. **One QBO company per workspace.** `qbo_connections` is keyed
   `UNIQUE(workspace_id)` + `UNIQUE(firm_id, realm_id)`. Two different firms MAY
   connect the same realm (accountant and owner both using FinSight) — no global
   unique on realm_id.
2. **Client-triggered sync, v1.** The backfill/sync loop is driven from the browser:
   server actions fetch+transform one year-chunk per call and return
   `{accounts, values}` slices; the client accumulates, runs the existing
   diff/merge/review flow, and commits through the Zustand store → existing
   cloud-sync engine (debounce, version guard, conflict chip) persists it. This
   avoids a server-side writer racing open tabs on the whole-workspace jsonb blob.
   A nightly server-side auto-sync is deliberately deferred (Phase Q5) — but a
   token-refresh keepalive IS needed before 100-day idle windows become real
   (also Q5; keepalive-Worker pattern exists in ~/finsight-keepalive).
3. **Tokens: AES-256-GCM app-side encryption** (WebCrypto, Workers-native) with key
   `QBO_TOKEN_KEY` (base64 32 bytes) via wrangler secret / .env. Ciphertext format
   `base64(iv[12] || ciphertext+tag)`. Column-level grants keep token columns
   invisible to the `authenticated` role entirely (structural boundary, like the
   Phase-5 metadata view). All writes service-role only, from server code.
   (supabase_vault is installed and was considered; app-side crypto is simpler,
   testable, and satisfies Intuit's "AES, key stored separately" requirement.)
4. **Signed state binds the OAuth flow.** `state` =
   `base64url(payload).base64url(hmac-sha256(payload, QBO_STATE_SECRET))` where
   payload = `{u: userId, f: firmId, w: workspaceId, n: nonce, exp: now+10min}`.
   `/api/qbo/connect` also sets an httpOnly SameSite=Lax nonce cookie;
   `/api/qbo/callback` verifies signature + expiry + nonce-cookie match.
   Callback goes on middleware PUBLIC_PATHS (the login bounce drops query strings,
   which would kill the flow) — the signed state carries the authz.
5. **Classification is authoritative from QBO.** Map AccountType
   "Cost of Goods Sold" → `cogs`; otherwise Classification → revenue/expense/asset/
   liability/equity. Set `isManuallyClassified: true`, `classificationSource:
   'manual'`, and `detectedSection` accordingly. Skip classifyAll entirely for
   typing; still run `classifyCostBehavior` (QBO has no fixed/variable concept).
6. **`Account.externalId`** (new optional field) stores QBO's internal Account.Id.
   `buildMatcher` gains an externalId tier ABOVE number — rename-proof idempotent
   re-sync. CSV imports leave it undefined (behavior unchanged).
7. **Restatements get a real merge.** New `mergeOverwrite` (next to
   `mergeNewPeriods`) applies changed overlapping cells + new periods + new
   accounts. UI review shows changed cells old→new+delta before applying
   (reuses the existing diffImport review surfaces).
8. **Dataset-commit logic moves out of components.** The ~30 lines of dataset
   bookkeeping in `StatementsView.tsx` (commitMergeNewPeriods /
   commitReplaceAsNewDataset / ensureRegistry) extract to
   `src/lib/data/dataset-commit.ts` pure helpers; StatementsView refactors onto
   them with zero behavior change; QBO sync uses the same helpers. QBO-synced data
   lands as a dataset labeled `QuickBooks — <CompanyName>`.
9. **Cash flow stays out of scope.** FinSight's model is P&L + BS only
   (StatementType has no cash-flow variant). Documented, not built.
10. **Mock mode for dev.** `FINSIGHT_QBO_MOCK=true` (dev-only,
    `.env.development.local`, NEVER `.env.local` — see the 2026-07-08
    FINSIGHT_ALLOW_DIRECT_SIGNUP prod-bake incident) points oauth+api at local
    mock routes serving deterministic fixtures, so the whole flow is click-testable
    with zero Intuit credentials. Real sandbox keys drop in later without code
    changes.
11. **Gates:** connect/disconnect/sync are owner/admin-only (members work in
    clients; wiring an external books feed is admin surface). DEMO_FIRM_ID is
    blocked from connect entirely. Sync respects billing access (`full` required),
    both client- and server-side.

## 3. Database (additive migration, applied to camphmqvrzqpgrhdjafo)

`supabase/migrations/<ts>_qbo_connections.sql` — idempotent, house style:

- Table `public.qbo_connections`: id uuid PK; firm_id → firms ON DELETE CASCADE;
  workspace_id → workspaces ON DELETE CASCADE UNIQUE; realm_id text NOT NULL;
  company_name text; access_token_enc text; access_token_expires_at timestamptz;
  refresh_token_enc text; refresh_token_expires_at timestamptz (rolling-100d);
  refresh_token_hard_expires_at timestamptz (5-yr cap); status text CHECK
  ('active','needs_reauth','revoked','error') DEFAULT 'active'; last_synced_at;
  last_sync_error text; connected_by uuid; created_at/updated_at (+ trigger);
  UNIQUE(firm_id, realm_id).
- RLS: SELECT for authenticated via `firm_id in (select public.auth_firm_ids())`.
- Grants: authenticated gets COLUMN-LEVEL SELECT on everything EXCEPT
  `access_token_enc`/`refresh_token_enc`; zero INSERT/UPDATE/DELETE (service_role
  only). BEFORE UPDATE trigger pins firm_id + workspace_id immutable (house
  pattern). anon: zero.
- Nothing existing is altered. Live app cannot observe this table.
- SQL impersonation tests required before UI (house rule): cross-firm SELECT = 0
  rows; token columns SELECT as authenticated = permission denied; authenticated
  INSERT/UPDATE/DELETE = denied; firm-member SELECT sees meta columns; immutability
  trigger blocks firm_id/workspace_id moves.

## 4. Code layout

```
src/lib/qbo/
  config.ts        endpoints, scopes, env access (incl. mock switch, fixed redirect origin)
  crypto.ts        AES-256-GCM encrypt/decrypt (WebCrypto)
  state.ts         signed-state build/verify (HMAC-SHA256, WebCrypto)
  oauth.ts         buildAuthorizeUrl, exchangeCode, refreshTokens, revoke
  api.ts           authed fetch (401→single refresh retry, 429 backoff, minorversion=75),
                   getCompanyInfo, queryAccounts (paginated, incl. inactive),
                   getProfitAndLossMonthly(year), getBalanceSheetMonthly(year)
  transform.ts     report JSON + COA → { accounts: Account[], values: AccountValue[] }
  sync.ts          chunk planning + per-chunk orchestration (pure core, injected fetchers)
  connections.ts   server-only service-role CRUD; token encrypt/decrypt at the edge;
                   rotation-safe persist (UPDATE ... guarded on prior refresh_token_enc,
                   re-read on 0 rows); audit_log writes
  mock/            deterministic Intuit mock (fixtures + handlers), dev-only
src/app/api/qbo/
  connect/route.ts   GET — auth+role gate, demo-firm block, state+nonce, 302 to Intuit/mock
  callback/route.ts  GET — verify state, exchange code once, CompanyInfo, upsert
                     connection, audit, redirect to /workspace/[id]?qbo=connected
  mock/[...]/route.ts  dev-only mock Intuit endpoints (404 in prod builds)
src/lib/data/
  dataset-commit.ts  extracted pure commit helpers (shared by StatementsView + QBO sync)
  qbo-actions.ts     'use server' actions: getQboStatus, startQboSyncChunk,
                     disconnectQbo — all requireActiveContext + role + billing gated
src/components/qbo/
  QboConnectCard.tsx / QboStatusChip.tsx / QboSyncDialog.tsx (backfill range picker,
  chunk progress, review+commit via existing diff surfaces, reauth prompt)
scripts/checks/qbo.check.ts          transform/crypto/state/merge/idempotence suite
scripts/checks/dataset-commit.check.ts  extraction regression suite
```

Env additions (dev): `.env.development.local` → `FINSIGHT_QBO_MOCK=true`,
`QBO_CLIENT_ID/QBO_CLIENT_SECRET` (dummy in mock), `QBO_TOKEN_KEY`, `QBO_STATE_SECRET`
(dev-only values), `QBO_REDIRECT_ORIGIN=http://localhost:3011`. Production values are
wrangler secrets set ONLY at deploy time (see runbook) — `QBO_REDIRECT_ORIGIN` is a
wrangler.jsonc var staged in the branch, `https://finsight.arktosmarketing.com`.

## 5. Phases

- **Q1 — Foundations** ✅ DONE 2026-07-22: migration applied + RLS-proven 10/10;
  `Account.externalId`; crypto/state/oauth/config (+ sandbox host switch via
  QBO_ENVIRONMENT); matcher tier; mergeOverwrite; dataset-commit extraction
  (parity-proven; all suites green).
- **Q2 — Data path** ✅ DONE 2026-07-22: api.ts, transform.ts, sync.ts, fixtures,
  101-check qbo-transform suite.
- **Q3 — Routes + actions + UI** ✅ DONE 2026-07-22: connect/callback/mock routes,
  qbo-actions, connections store, QboControls/QboSyncDialog, StatementsView review
  integration, ?qbo params.
- **Q4 — Verification** ✅ DONE 2026-07-22: tsc + next build + cf:build + deploy
  --dry-run (NO deploy), 11 check suites green, full mock flow click-verified
  (connect → backfill → commit → idempotent re-sync → disconnect), adversarial
  review workflow run + confirmed findings fixed. Legal pages + runbook shipped.
  Found+fixed en route: 'use server' type re-export 500'd every page action.
- **Q5 (deferred, post-Derek):** real sandbox E2E once dev keys exist; production
  keys; nightly token-refresh/auto-sync Worker; entity-webhook change detection
  (CloudEvents); QBO App Store listing decision.

## 6. What only Derek can do (full detail in DEREK_QBO_RUNBOOK.md)

1. Create the Intuit developer account + app (accounting scope only) → paste sandbox
   Client ID/Secret into `.env.development.local` (or hand to a session).
2. Review + bless the legal pages (/legal/privacy, /legal/terms) before they're cited
   to Intuit.
3. Production App Details + assessment questionnaire (answers pre-drafted in the
   runbook), Reconnect URL field.
4. At deploy time (NOT before): `wrangler secret put` × 4 (QBO_CLIENT_ID,
   QBO_CLIENT_SECRET, QBO_TOKEN_KEY, QBO_STATE_SECRET) + merge branch + `cf:deploy`.
5. Connect his own real QBO company as the first multi-year backfill test.

## 7. Standing risks / gotchas for future sessions

- Whole-workspace jsonb blob writes: any server-side sync must respect the
  `version` guard AND the open-tab race — this is WHY v1 sync is client-driven.
- `.env.local` IS loaded by `next build` — dev-only flags go in
  `.env.development.local` ONLY (prod-bake incident 2026-07-08).
- `next dev` does NOT run middleware in this repo — verify middleware behavior via
  `npm run cf:preview` or prod, never `next dev`.
- Report JSON parser must be built against the recursive Rows tree (Section rows
  nest Rows; ColData positional against Columns metadata) — docs' samples are
  truncated; fixtures in the repo are the contract.
- Summary rows: use STRUCTURAL markers (Row type/group), never name matching
  (`AUTO_EXCLUDE_NAMES` is a CSV-layer fallback; a real account named "Total
  Income" must survive).
- Exchange each auth code exactly once; guard the callback against replays
  (nonce cookie is cleared on first use).
- The AGENTS.md warning is real: read `node_modules/next/dist/docs/` before writing
  route/middleware code — this Next 16 differs from training data.
