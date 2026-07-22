# Derek's QBO Runbook

Every human-only step for taking FinSight's QuickBooks Online integration from
zero to live. Written so you can execute it without a Claude session open.
Work top to bottom; each section says when to do it.

Companion doc: `QBO_INTEGRATION_PLAN.md` (the technical spec). You never need
it to follow this runbook.

---

## A. NOW: Intuit developer account + dev keys (~15 min)

Do this whenever. Nothing here touches the live app.

1. Go to https://developer.intuit.com and click **Sign In** (top right). Use
   your existing Intuit login if you have one (the same login that runs your
   own QuickBooks works fine), otherwise create a free account. The developer
   program costs $0.

2. From the dashboard, click **Create an app**.
   - Platform: **QuickBooks Online and Payments**.
   - Name: **FinSight**.
   - Scope: check **com.intuit.quickbooks.accounting** ONLY. Do NOT check
     OpenID Connect and do NOT check Payments. Adding a scope later forces
     every connected company to re-authorize, so we start and stay minimal.

3. In the app, open **Keys & credentials** (left sidebar).
   - On the **Development** tab, under Redirect URIs, add:
     `http://localhost:3011/api/qbo/callback`
   - On the **Production** tab, under Redirect URIs, add:
     `https://finsight.arktosmarketing.com/api/qbo/callback`
     (You can also do this later in section B. Redirect URIs are exact-match,
     so no trailing slash, no variations.)

4. Still on the **Development** tab, copy the **Client ID** and
   **Client Secret** into the file
   `~/Documents/finsight/.env.development.local` (create the file if it does
   not exist) as two lines:

   ```
   QBO_CLIENT_ID=paste-the-development-client-id-here
   QBO_CLIENT_SECRET=paste-the-development-client-secret-here
   QBO_ENVIRONMENT=sandbox
   ```

   (`QBO_ENVIRONMENT=sandbox` matters: Intuit Development keys only work
   against sandbox companies, and that line points FinSight's API calls at the
   sandbox host. Production deploys omit it.)

   This file is gitignored, so the secret never lands in the repo. Once the
   values are in place, a Claude session can take it from there (flip
   `FINSIGHT_QBO_MOCK=false` and run the sandbox end-to-end test).

5. Create a sandbox company: dashboard top nav → your profile / **Sandbox**
   (Intuit sometimes files it under "API Docs & Tools" → "Sandbox"). Click
   **Add a sandbox company**, country **United States**, type **QuickBooks
   Online Plus**. It comes pre-seeded with a few months of fake data. You can
   have up to 10; one is enough.

Done. That is everything needed for development and sandbox testing.

---

## B. LATER: production approval (~1 hour, do before deploy day)

Do this once the feature is built and you are within sight of deploying. It is
self-serve, free, and does not require a QuickBooks App Store listing.

### B0. Review the legal pages first

The app details form cites FinSight's privacy policy and terms to Intuit, so
read them once before you point Intuit at them:

- Open the dev preview (or production once deployed) at `/legal/privacy` and
  `/legal/terms`.
- Skim both and confirm you are comfortable standing behind every claim
  (they were written to match how the app actually works: read-only QBO scope,
  AES-256-GCM token encryption, the subprocessor list, the $97/mo + 7-day
  trial billing terms, Missouri governing law).
- If anything reads wrong, have a session fix it BEFORE submitting the Intuit
  forms.

### B1. Complete the production app details

In the app's **Keys & credentials** → **Production** tab, Intuit requires app
details before it shows production keys. Use these exact values:

| Field | Value |
|---|---|
| Privacy Policy URL | `https://finsight.arktosmarketing.com/legal/privacy` |
| EULA / Terms of Service URL | `https://finsight.arktosmarketing.com/legal/terms` |
| Host domain | `finsight.arktosmarketing.com` |
| Launch URL | `https://finsight.arktosmarketing.com/login` |
| Disconnect URL | `https://finsight.arktosmarketing.com/login` |
| Connect / Reconnect URL | `https://finsight.arktosmarketing.com` |
| Redirect URI (production) | `https://finsight.arktosmarketing.com/api/qbo/callback` |

The **Reconnect URL** field is mandatory for all apps from 2026-02-24, so it
will not let you skip it. Fill it with `https://finsight.arktosmarketing.com`.

Category / app description fields, if asked: "Financial analysis and reporting
tool for accounting firms" is accurate.

### B2. The assessment questionnaire

**WARNING: the questionnaire CANNOT be edited after you submit it.** A
rejection freezes NEW connections until resolved. Read through all the
pre-drafted answers below, have them ready to paste, and only then open the
questionnaire. The good news: approval is usually about 5 minutes and the
whole thing takes roughly 40 minutes.

#### Pre-drafted answers

**App purpose / description** (paste or adapt):

> FinSight is a financial analysis web application for accounting firms and
> small businesses. With the customer's authorization, it imports a QuickBooks
> Online company's chart of accounts and historical monthly Profit and Loss
> and Balance Sheet reports, and uses that data to power read-only analytics:
> financial statement views, trend analysis, projections, and what-if
> scenarios. The integration is strictly read-only; FinSight never creates,
> modifies, or deletes any data in QuickBooks Online. Each QuickBooks company
> is connected individually by the customer through Intuit's standard OAuth
> consent flow, and the customer can disconnect at any time from inside
> FinSight or from Intuit's connected-apps page.

**Data security questions** (adapt to the exact wording asked):

- OAuth tokens are encrypted at rest using AES-256-GCM. The encryption key is
  stored separately from the database, as a Cloudflare Workers secret, and is
  available only to server-side code. Tokens are never sent to or readable by
  browsers.
- All traffic is served over HTTPS with TLS 1.2 or higher (Cloudflare edge).
- Customer data is stored in a managed Postgres database (Supabase) encrypted
  at rest, with row-level security policies enforcing per-tenant (per-firm)
  isolation at the database layer.
- We do not sell, share, or resell customer data or QuickBooks data to any
  third party. Data is used solely to provide the analysis features the
  customer sees.
- Breach handling: we commit to promptly notifying affected customers and
  Intuit of any security breach involving QuickBooks-sourced data, and to
  cooperating with Intuit's security review processes.
- Access to production infrastructure is limited to the operator (sole
  proprietor) with MFA on all provider accounts.

**Platform usage questions** (adapt to the exact wording asked):

- Data accessed: the Accounting API only. Specifically the Account entity
  (chart of accounts, via query) and the ProfitAndLoss and BalanceSheet
  reports (monthly summarize, via the Reports API).
- Read-only: the app performs zero writes to QuickBooks Online. No entities
  are created, updated, or deleted.
- Volume: very low. Initial historical backfill is roughly 12 API calls per
  connected company (one call per year of history per report, plus the chart
  of accounts). After backfill, syncs are on-demand when the customer clicks
  refresh. No polling, no webhooks in v1.
- One QuickBooks company maps to one workspace in FinSight; an accounting firm
  connects each client company individually via the standard OAuth flow.

Submit, wait for approval (typically ~5 minutes), then the **Production
Client ID and Client Secret** appear on the Production tab. Copy them
somewhere safe (password manager). Do NOT put them in wrangler yet; that
happens only on deploy day (section C).

---

## C. DEPLOY DAY (only after the feature branch is reviewed + merged)

**WARNING, in bold on purpose: `wrangler secret put` cuts a new Worker
deployment version the moment you run it, even with unchanged code. Do NOT
set any of these secrets before you intend to deploy. All of section C
happens in one sitting, at deploy time, never earlier.**

All commands run from `~/Documents/finsight`.

1. Generate the two random keys. Run this one-liner twice and save both
   outputs; the first is QBO_TOKEN_KEY, the second is QBO_STATE_SECRET:

   ```
   node -e "console.log(crypto.randomBytes(32).toString('base64'))"
   ```

2. Set the four production secrets. Each command prompts you to paste the
   value (input is hidden). For the first two, paste the PRODUCTION Client ID
   and Client Secret from section B2 (not the Development ones). For the last
   two, paste the two generated keys from step 1 in order.

   ```
   npx wrangler secret put QBO_CLIENT_ID
   npx wrangler secret put QBO_CLIENT_SECRET
   npx wrangler secret put QBO_TOKEN_KEY
   npx wrangler secret put QBO_STATE_SECRET
   ```

3. Deploy:

   ```
   npm run cf:deploy
   ```

4. Quick smoke: load https://finsight.arktosmarketing.com/login and
   https://finsight.arktosmarketing.com/legal/privacy in a private window.
   Both should render. Sign in and confirm the app still works before moving
   to section D.

---

## D. FIRST REAL TEST: connect your own QBO company

1. Sign in to production with your real firm account (not the demo; the demo
   firm is blocked from connecting QBO by design).
2. Open (or create) a client workspace for your own books. Click **Connect
   QuickBooks** on the workspace. You must be the firm owner or an admin.
3. Intuit's consent screen opens. Sign in with your Intuit login, pick your
   company, approve. You should land back in the workspace with a connected
   status.
4. Run a sync with a multi-year backfill range (as far back as your books go).
   Expect roughly one chunk per year; the dialog shows progress, then a review
   of what will be imported. Commit it.
5. Sanity checks to eyeball against QuickBooks itself:
   - Pick one full year. Run QBO's own Profit and Loss report (accrual basis,
     columns by month) and compare a few numbers: total revenue, net income,
     one or two specific expense accounts. FinSight should match to the cent.
   - Balance Sheet spot check: pick one month-end, compare total assets and
     total liabilities + equity.
   - Chart of accounts: account names and types look right, COGS accounts
     landed in COGS (not generic expenses).
   - The imported data shows up as a dataset named "QuickBooks — <your
     company name>".
6. Run the sync a second time over the same range. It should come back clean
   (no duplicate accounts, no re-imported rows); that proves idempotent
   re-sync.

---

## E. Ops notes (keep for later)

**What `needs_reauth` means.** A connection flips to `needs_reauth` when
Intuit will no longer honor its refresh token. Three causes: (1) 100 days
passed with no token use (the refresh token has a 100-day rolling expiry),
(2) the hard 5-year maximum token lifetime was reached, or (3) the user
revoked access (disconnected from Intuit's side). There is no programmatic
recovery from any of these: the fix is always the user clicking reconnect and
going through Intuit's consent screen again. This is expected lifecycle, not
a bug.

**API quota.** FinSight is on Intuit's free Builder tier: 500,000 metered
read calls per month. Going over does not bill you; it HARD-BLOCKS further
reads until the month resets. Our usage is tiny (about 12 calls per company
for a full backfill, a handful per manual refresh), so hitting the cap would
signal a runaway loop, not real usage. Usage graphs are on the app's
dashboard at developer.intuit.com.

**Where to see connection status.** In the app: the QBO card on each
workspace shows connected company, status, and last sync. Under the hood:
the `qbo_connections` table in the FinSight Supabase project
(`camphmqvrzqpgrhdjafo`) has `status` (`active` / `needs_reauth` /
`revoked` / `error`), `last_synced_at`, and `last_sync_error`. The token
columns are unreadable except via service role, by design.

**Keepalive reminder.** Until the nightly token-refresh Worker exists
(deferred Phase Q5), a connection that nobody syncs for 100 days will lapse
into `needs_reauth`. If FinSight gets real QBO users, prioritize that Worker
(the pattern already exists in `~/finsight-keepalive`).
