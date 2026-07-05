# FinSight — Multi-Tenant SaaS Conversion Handoff

**Created:** 2026-07-03 · **Status:** planned, not started · **Read `SESSION_NOTES.md` first.**

This is the execution plan to convert FinSight from a single-user localStorage tool
into a real multi-tenant SaaS: firm signup + card-upfront trial + billing, team
invites/roles, and a limited-access super-admin. It is **multi-session work** — build
on a branch, checkpoint each phase, never iterate on the live path.

---

## 0. Already done (this session, 2026-07-03)

- **Supabase project was auto-paused** (free-tier, ~7 idle days). That was the
  "Failed to fetch" on `/login` — the browser couldn't reach a sleeping backend.
  **Restored to `ACTIVE_HEALTHY`** (project ref `camphmqvrzqpgrhdjafo`). Login works
  again in every session.
- **Auto-pause SOLVED (keep-alive deployed).** A tiny Cloudflare cron Worker
  **`finsight-keepalive`** (`~/finsight-keepalive`, daily `0 6 * * *`) pings
  `GET /auth/v1/settings` with the publishable key (clean 200) so the project never
  idles out. $0, independent of any Claude session. Manual test:
  `curl https://finsight-keepalive.bearman-derek.workers.dev/`. Revisit if moving to
  Supabase Pro later.

## A. Feasibility verdict

The two onboarding paths Derek described are **not either/or** — they're the two front
doors of one multi-tenant system, and they are exactly the "Phases 2–5" already scoped
in SESSION_NOTES but never built:

- **Owner path:** unknown email → sign up → 7-day trial → billing → full access.
- **Member path:** invited by a firm admin → joins that firm → sees its clients.

A real firm product needs **both**, plus the super-admin on top. **All of it is feasible
on the current stack (Supabase + Cloudflare Workers) with no blockers** — Supabase RLS is
built for this tenancy model, Stripe natively does "trial with card upfront, auto-charge
on day 7," and a metadata-only super-admin is a normal service-role area.

**Three parts carry the real risk:**

1. **Client data isn't in the database yet.** Today a "client"/workspace lives in the
   browser's localStorage (Zustand persist), not Postgres. "A firm's users sharing their
   firm's clients" is impossible until workspaces move into the DB with `firm_id` + RLS.
   This migration — **not** auth — is the biggest lift, because it touches every workspace
   read/write in the app.
2. **RLS is safety-critical.** One wrong policy leaks a firm's financial PII to another
   firm. Tenant isolation must be SQL-tested before any real customer touches it.
3. **Billing is real money.** Stripe webhooks must be signature-verified, idempotent, and
   handle trial-end / failed-payment / cancellation, or firms get free access or wrongful
   lockouts.

**Scope reality:** this graduates FinSight from a demo into real software handling money
and financial PII. Several focused sessions, built on a branch.

## B. Product decisions (locked)

- **$97/month flat per firm**, unlimited users + clients (no per-seat metering).
- **7-day trial, card required up front**, auto-charges $97/mo at trial end.
- **Two complementary entry paths:** (1) firm owner signs up → trial → full access;
  (2) team member is invited by their firm admin → joins that firm → sees its clients.
- **Super-admin (Derek):** manages all firms/users for support with **minimum** access to
  client financial data — a metadata/admin console that never reads clients' numbers;
  audit-logged impersonation only if support ever truly needs it.
- **Prior locks (from SESSION_NOTES):** Standard SaaS (data in our DB, RLS tenancy,
  encrypted at rest, audit-logged); Supabase end-to-end; hosting stays Cloudflare Workers;
  **no local-only escape hatch in v1**; import existing localStorage workspaces on first
  login via a **prompt with per-workspace checkboxes** (not auto-import).

## C. Target architecture

**Postgres `public` schema, every tenant table RLS'd:**

- `firms(id, name, stripe_customer_id, stripe_subscription_id,
  plan_status[trialing|active|past_due|canceled], trial_ends_at, current_period_end)`
- `memberships(firm_id, user_id, role[owner|admin|member], status[active|invited],
  invited_by)` — a **JOIN table**, not `users.firm_id`, so invites + future multi-firm
  membership work cleanly.
- `invitations(firm_id, email, role, token_hash, invited_by, expires_at, accepted_at)`
- `workspaces(firm_id, name, industry_profile, data jsonb, created_by, …)` — the current
  localStorage workspace JSON moves into `data`.
- `snapshots(workspace_id, firm_id, label, data jsonb, …)` — optional (Phase 3 in the
  original plan).
- `audit_log(firm_id, actor_user_id, action, target, metadata, created_at)`

**RLS:** a `SECURITY DEFINER` helper `auth_firm_ids()` → firm_ids where the caller has an
active membership; every tenant table `USING (firm_id IN (select auth_firm_ids()))`;
role-gate writes; enforce billing/plan writes **server-side with the service role only**.
**Test tenant isolation with SQL before building any UI.**

**Unified auth routing:** keep the `/login` OTP flow. After auth, a **server-side
membership resolver** routes:
- active membership → firm app;
- pending invitation matching the email → accept + create membership → firm app;
- no membership/invitation → onboarding fork offering **both** "Start a firm" (→ Stripe
  Checkout, subscription, 7-day trial, card required → webhook creates firm + owner
  membership) **and** a "need an invite / ask your admin" path.

**Billing (Stripe):** one $97/mo recurring price; subscription `trial_period_days=7`,
`payment_method_collection=always`; Checkout (`mode=subscription`) → redirect;
signature-verified idempotent webhooks (`checkout.session.completed`,
`customer.subscription.*`, `invoice.payment_failed`) → `firms.plan_status`; `past_due` →
banner + grace then read-only lock; `canceled` → lock; Billing Portal for card/cancel;
Stripe secret via `wrangler secret`; add Stripe hosts to the CSP `connect-src`.

**Super-admin:** allowlist env `SUPER_ADMIN_EMAILS` (server-side, never in the client
bundle). Metadata console via the service role that manages
firms/memberships/invitations/billing/counts but **never selects `workspaces.data` /
`snapshots.data`**. Audit-logged impersonation only later, if support needs it.

**Email:** wire **custom SMTP (Resend free tier)** from a real domain into Supabase Auth
before inviting real firms — built-in email is rate-limited (~3–4/hr) and Outlook-hostile.

## D. Phasing (checkpoint after each)

| Phase | Work |
|---|---|
| **2a** | ✅ **DONE** (branch `phase-2a-tenancy`, 2026-07-03) — see §G. Schema + RLS + helpers + `SUPER_ADMIN_EMAILS`; isolation SQL-proven. |
| **2b** | Move workspaces localStorage → Postgres + first-login import prompt. **Biggest lift.** |
| **3**  | Membership resolver + onboarding fork UI + invitations (admin invite UI + accept-on-login). |
| **4**  | Stripe billing (Checkout + trial + webhooks + lifecycle locks + Billing Portal). |
| **5**  | Super-admin metadata console + audit-log surfacing. |
| *Cross-cutting, early* | Custom SMTP + domain; decide Supabase Pro vs keep-alive to stop auto-pause. |

## E. Decisions — ALL resolved 2026-07-03

2. ✅ **Onboarding fork:** unknown email → **offer both** "Start a firm (free trial)"
   AND "I was invited / ask my admin." Invited teammates come in via their invite link;
   don't dead-end a new customer.
3. ✅ **Roles matrix (default confirmed):** owner = billing + everything; admin =
   invite/manage users + clients; member = work in clients, no billing/invites.
4. ✅ **Trial-end / failed-payment:** **~3-day read-only grace** (banner → read-only →
   hard lock), not an immediate cut.
5. ✅ **Super-admin depth:** metadata-only now; audit-logged impersonation only added
   later if support truly needs it.
6. ✅ **Drop the local-only path in v1:** confirmed.
7. ✅ **Auto-pause:** free keep-alive ping — **`finsight-keepalive` Worker deployed**
   (see §0).

**Resolved 2026-07-03:**
1. ✅ **FinSight domain = `finsight.arktosmarketing.com`** (the subdomain already staged in
   `wrangler.jsonc`; no purchase). Unblocks the email + Stripe prerequisites. Before real
   external users, wire (Phase 4 / SMTP prep): (a) verify `arktosmarketing.com` in Resend +
   add SPF/DKIM in the Cloudflare zone, from-address e.g. `finsight@arktosmarketing.com`,
   into Supabase Auth → SMTP; (b) Supabase Auth Site URL / redirect allowlist →
   `https://finsight.arktosmarketing.com` + `/auth/callback`; (c) Stripe success/cancel +
   branding on that origin. None of this blocks Phase 2b.

## F. Gotchas (do not regress)

- The middleware file is **`middleware.ts`, NOT `proxy.ts`** — @opennextjs/cloudflare still
  bundles the legacy `server/middleware.js` name; `proxy.ts` breaks the build.
- **`NEXT_PUBLIC_*` must live in BOTH** `.env.production` (Next inlines into the client
  bundle at build) **and** `wrangler.jsonc` `vars` (Worker runtime). Keep them in sync.
- **CSP `connect-src` in `worker.ts`** must allowlist Supabase (and Stripe once billing
  lands). **Never widen to `*`.**
- **OTP is 8 digits** for this project — keep the login input length-agnostic.
- **Supabase Auth Site URL / redirect allowlist** must include the login origin.
- **Deploy:** `cd ~/Documents/finsight && git pull && npm run cf:deploy`.
- Anon key is the new `sb_publishable_` format; service role is a `wrangler secret`.

## G. Phase 2a — as built (2026-07-03, branch `phase-2a-tenancy`)

**Migrations (both applied to `camphmqvrzqpgrhdjafo`, empty `public` schema → purely
additive; repo files are the idempotent source of truth):**
1. `supabase/migrations/20260703155527_phase2a_multitenant_schema.sql` — schema + RLS.
2. `supabase/migrations/20260703162211_phase2a_rls_hardening.sql` — the fixes an
   adversarial multi-agent RLS review drove (see "Hardening" below).

**Built:** tables `firms`, `memberships`, `invitations`, `workspaces` (`data jsonb` =
financial PII; `name` + `industry_profile` denormalized so lists/admin never read the
blob; `source_local_id` for idempotent Phase-2b import), `audit_log` (append-only). Enums
`membership_role` (owner/admin/member), `membership_status` (active/invited/revoked).
`plan_status` is a text+CHECK superset of Stripe's statuses so a webhook never fails to
persist. SECURITY DEFINER helpers `auth_firm_ids()` + `auth_has_firm_role()` (search_path
`''`, owner-rights read of memberships → no recursive RLS). RLS on all 5 tables; anon has
zero grants; **defense in depth** — firms is SELECT-only and audit_log is append-only at
BOTH the privilege and RLS layers (Supabase default-grants all DML to `authenticated`, so
the migration revokes-then-regrants the intended surface). Billing columns on `firms` are
service-role-write-only. Snapshots table deferred (not in the 2a scope list).

**Isolation proof:** 33/33 SQL impersonation checks passed (2 firms, 5 users across every
membership shape). Verified: cross-firm SELECT of every table → 0 rows; cross-firm
INSERT/UPDATE → blocked (42501); member can't read audit_log or create invites (role gate);
no-membership user sees nothing; invitee sees only their own pending invite by email;
positive controls succeed. All test data cleaned up (the 3 real tester users were untouched
— cleanup filtered on `@finsight.test`). Advisors: anon EXECUTE on the helpers revoked;
remaining warns are expected (authenticated-EXECUTE, required for RLS) or N/A (leaked-
password protection — app is passwordless OTP).

**Hardening (adversarial review, migration #2):** a 4-lens multi-agent review + independent
verification (25 raised → 18 confirmed → **4 Phase-2a blockers**, all fixed & re-proven with
16/16 SQL checks incl. a dual-firm actor):
1. `invitations_select` trusted the raw JWT `email` claim (unverified, config-dependent) →
   dropped the email branch; SELECT now owner/admin-only. Invitee self-view moves to a
   Phase-3 SECURITY DEFINER RPC keyed on the plaintext token.
2/4. `memberships` had live `authenticated` PostgREST writes (self-promote to owner, revoke
   the real owner, graft arbitrary users = intra-firm takeover) → **revoked authenticated
   INSERT/UPDATE/DELETE**; all membership writes are service_role / RPC now.
3. `workspaces_update` didn't pin `firm_id`, so a dual-firm member could relocate a
   workspace + its `data` PII across the tenant boundary → **BEFORE UPDATE trigger** pins
   `firm_id` (+ `created_by`); RLS WITH CHECK can't reference OLD.
   Plus: revoked authenticated writes on `invitations` + `audit_log` (both server-mediated
   by design); DB-side invitation email normalization.

**Net authenticated surface:** firms = SELECT; memberships = SELECT; invitations = SELECT
(owner/admin); **workspaces = full CRUD (firm_id/created_by immutable)**; audit_log = SELECT
(owner/admin). Everything else is service_role / Phase-3 RPC.

**Super-admin wiring:** `src/lib/auth/super-admin.ts` (server-only guard, `isSuperAdmin()`,
fails closed). Reads `SUPER_ADMIN_EMAILS` at runtime via `process.env`; set it via
`wrangler secret put SUPER_ADMIN_EMAILS` (NOT wrangler.jsonc) + `.env.local`. Not yet set
(no value guessed/committed).

**Deferred to Phase 3/4 (documented by the review, NOT blockers — no cross-tenant leak):**
the accept-invite RPC must cap the granted role to the inviter's and enforce a "≥1 owner"
invariant; the team-management RPCs own "no self-promote / no last-owner-removal"; the
metadata-only super-admin needs a *structural* PII boundary (a `data`-omitting view or a
non-BYPASSRLS `finsight_metadata` role — comment + service_role is not enforcement); billing
writes should funnel through one `apply_stripe_status` RPC so a buggy server action can't
grant free access; firm+owner bootstrap should be one SECURITY DEFINER `create_firm_with_owner()`.
`workspaces` delete is allowed for all active members ("member = work in clients"); flip to
owner/admin if preferred. `FORCE ROW LEVEL SECURITY` considered and declined (postgres +
service_role are BYPASSRLS, so it adds no real protection and risks the definer-helper path).

## H. Phases 2b–5 — autonomous build (2026-07-03, branch `phase-2a-tenancy`)

Built end-to-end WITHOUT deploying or touching live external services. Everything is on the
branch, committed per phase, and either SQL/unit-tested (DB + logic) or `next build`-verified
(app + UI). NOT pushed, NOT deployed.

**All migrations (idempotent, applied to `camphmqvrzqpgrhdjafo`, committed):**
1. `20260703155527_phase2a_multitenant_schema.sql` — schema + RLS
2. `20260703162211_phase2a_rls_hardening.sql` — the 4 review blockers
3. `20260703172427_phase3_server_rpcs.sql` — server-mediated write RPCs
4. `20260703173132_phase5_metadata_boundary.sql` — `workspaces_metadata` view (PII-safe)
5. `20260703173412_phase4_billing.sql` — `grace_ends_at` + `apply_stripe_status`
6. `20260703174143_phase3b_list_members.sql` — `list_firm_members` roster

**DB layer (fully SQL-tested via impersonation, all fixtures cleaned up):**
- RPCs — `create_firm_with_owner` (service-role only, idempotent on customer id),
  `create_invitation` (role-capped), `accept_invitation` (confirmed-email + token verified),
  `revoke_invitation`, `set_membership_role` / `remove_membership` (no self-promote, owner-tier
  owner-only, ≥1-owner), `list_firm_members`, `apply_stripe_status` (billing funnel, grace
  anchor). **29/29 RPC checks + 9/9 billing checks + 6/6 metadata checks + 2/2 roster checks.**
- The metadata-admin PII boundary is now structural: `workspaces_metadata` (security_invoker,
  no `data` column) is what the super-admin queries.

**App layer (typed against generated `database.types.ts`, `tsc` clean, `next build` green):**
- `lib/data/context.ts` (membership resolver → unauthenticated / onboarding / active + billing
  access), `workspaces.ts` (Phase-2b CRUD + idempotent import), `team.ts` / `provisioning.ts` /
  `onboarding.ts` (action wrappers), `admin/super-admin-data.ts` (isSuperAdmin-gated, view-only).
- `lib/billing/access.ts` (pure state machine, **16/16** unit checks via tsx), `stripe.ts`
  (hosted Checkout + Portal, Workers-safe async webhook verify), `actions.ts`.
- `app/api/stripe/webhook` (public, signature-verified, funnels to `apply_stripe_status`),
  `middleware.ts` allowlists it.
- Supabase clients typed with `<Database>`; server-only `service.ts`.

**UI routes (`next build` green + curl smoke-test: app boots, middleware redirects, webhook
public):** `/onboarding` (two-door fork), `/invite/[token]` (accept), `/team` (roster + invite +
roles), `/billing` (status + Portal), `/admin` (firm metadata). `BillingBanner` component ready
to mount. NOTE: these are build-verified, not click-tested (no auth+firm session available here).

**Deploy readiness:** `npm run cf:deploy:dry` passes — the full OpenNext + wrangler Workers
bundle builds with the Stripe SDK (11 MB / 2.3 MB gzip), so the deploy will work once secrets
are set. Wrangler is authenticated. **Copy-paste steps: `DEPLOY_RUNBOOK.md`.**

### What only Derek can do (human-only punch-list — none of this is done)
1. **Stripe** — create the account; a $97/mo recurring **Price**; a webhook endpoint at
   `https://finsight.arktosmarketing.com/api/stripe/webhook` subscribed to
   `checkout.session.completed`, `customer.subscription.created|updated|deleted`,
   `invoice.payment_failed`. Then set wrangler secrets: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`,
   `STRIPE_WEBHOOK_SECRET`. (Code reads these at runtime; nothing works until they exist.)
2. **Resend SMTP** — verify `arktosmarketing.com` (or `finsight.` subdomain) + SPF/DKIM in the
   Cloudflare zone; wire SMTP into Supabase Auth → Email (from e.g. `finsight@arktosmarketing.com`).
3. **Supabase Auth → URL config** — add `https://finsight.arktosmarketing.com` (Site URL) +
   `/auth/callback` to the redirect allowlist.
4. **wrangler secrets** — `SUPER_ADMIN_EMAILS` (Derek's email) + the 3 Stripe secrets above.
   `SUPABASE_SERVICE_ROLE_KEY` was already set in Phase 1.
5. **Deploy** — `npm install` (adds `stripe`), commit the staged `wrangler.jsonc` domain change,
   `npm run cf:deploy`. Keep `FINSIGHT_ALLOW_DIRECT_SIGNUP` UNSET in prod (dev-only bypass).

### Phase 2b integration — DONE + click-verified (2026-07-05)

The localStorage `/` app is now wired to Postgres and click-tested end to end against a
real authenticated Supabase session. See §I below for what was built and how it was proven.

### Still needs a real session (remaining after 2b)
- Full E2E of the *external-dependency* flows (signup→**Stripe checkout**→webhook→firm,
  trial-code / invite **emails** via Resend) once Stripe + SMTP exist. The in-app halves
  (firm resolve/route, workspace CRUD, invite→accept, billing lifecycle gating, super-admin
  data layer) are verified; only the third-party legs are unexercised.
- Dev harness: `.env.local` (gitignored) holds the public keys + `FINSIGHT_ALLOW_DIRECT_SIGNUP=true`.
  Note it does **not** hold `SUPABASE_SERVICE_ROLE_KEY` or `SUPER_ADMIN_EMAILS`, so the two
  server-role paths — dev-direct onboarding (`startFirmDirect`) and the `/admin` console — throw
  in `npm run dev` until you add them. Add both to `.env.local` to click-test those locally.
  `~/.claude/launch.json` has a `finsight-dev` config (port 3011) for the preview tooling.

## I. Phase 2b — as built + verified (2026-07-05, branch `phase-2a-tenancy`)

**Commit:** `Phase 2b: wire localStorage app to Postgres (firm-aware store + cloud sync)`.
`next build` green. Not deployed.

**Design:** the Zustand store stays the single in-memory source of truth; it was made
*cloud-aware* rather than rewriting the two large page files.
- `lib/data/workspace-actions.ts` (`'use server'`) — the client's only bridge to the RLS data
  layer: `loadFirmApp` (context + workspaces + access + isSuperAdmin), `saveNewWorkspace` /
  `saveWorkspace` / `removeWorkspace`, `runImport`. Writes fail closed unless `access.level==='full'`.
- `components/app/FirmAppGate.tsx` — mounted in `layout.tsx`; on `/` and `/workspace/*` it
  resolves the firm once, routes unauth→/login and onboarding→/onboarding, hydrates the store
  from Postgres, starts write-through, blocks the app when billing is `locked`, and provides
  `firm/access/role/isSuperAdmin` via `firm-context.tsx`. Other routes render untouched.
- store (`enterCloudMode`/`hydrateFromCloud` + `cloudMode` flag): cloud mode **disables
  localStorage writes** so firm PII never mirrors to the browser; the pre-cloud
  `finsight-workspaces` key is preserved for the one-time import prompt.
- `lib/data/cloud-sync.ts` — subscribes to the store and **debounce-persists** any workspace
  whose `updatedAt` moved, so every existing mutation flows to Postgres unchanged; create/delete
  are explicit at the call sites (`noteCreated`/`noteDeleted`).
- `components/app/ImportPrompt.tsx` — first-login per-workspace checkbox import (idempotent on
  `source_local_id`); `AppNav.tsx` — Team/Billing/(Admin) links in both page headers; both page
  headers mount `<BillingBanner>` and gate writes by access level; home trust copy now reads
  "Synced to <firm> · available on every device".

**Verified (preview browser + Supabase table checks, firm "Arktos Bookkeeping"):**
create workspace → row in Postgres with a DB uuid → survives hard refresh AND a full
localStorage wipe (proves data is server-side; `finsight-workspaces` stays null in cloud mode);
write-through (a mutation advanced `updated_at` + the data blob); import prompt imports **once,
not twice** (idempotent + per-firm dismissed flag); cloud-backed delete removes the row;
invite from `/team` → accept via `/invite/<token>` as a second user → teammate sees the same
client (membership owner+member both active); billing gate full→read-only(banner)→locked(app
blocked) by flipping `plan_status`. Team/Billing nav present; Admin correctly hidden (no
`SUPER_ADMIN_EMAILS` in dev).

---

*Build on a branch. Isolation-test RLS before UI. Verify Stripe webhooks before trusting
billing state. Custom SMTP + domain before any real external user.*
