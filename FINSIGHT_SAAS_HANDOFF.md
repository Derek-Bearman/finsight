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
- **Time-sensitive:** the free tier **re-pauses after ~7 idle days** and will break
  login again. Decide **Supabase Pro ($25/mo)** vs a **keep-alive ping** (a scheduled
  request every few days) before relying on it. See open decision #7.

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
| **2a** | Schema + RLS + helpers + `SUPER_ADMIN_EMAILS` (migration). Prove isolation with SQL, no UI. |
| **2b** | Move workspaces localStorage → Postgres + first-login import prompt. **Biggest lift.** |
| **3**  | Membership resolver + onboarding fork UI + invitations (admin invite UI + accept-on-login). |
| **4**  | Stripe billing (Checkout + trial + webhooks + lifecycle locks + Billing Portal). |
| **5**  | Super-admin metadata console + audit-log surfacing. |
| *Cross-cutting, early* | Custom SMTP + domain; decide Supabase Pro vs keep-alive to stop auto-pause. |

## E. Open decisions — get these from Derek before the relevant phase

1. **FinSight domain** for email / Stripe / branding (still on `*.workers.dev` +
   `finsight.arktosmarketing.com`).
2. **Onboarding fork:** does a brand-new email always get "Start a firm," or is it
   invite-only with a fallback? *(Recommend: offer both — don't dead-end a new customer.)*
3. **Roles matrix:** owner = billing + everything; admin = invite/manage users + clients;
   member = work in clients, no billing/invites. Confirm or adjust.
4. **Trial-end / failed-payment:** hard lock vs ~3-day read-only grace.
5. **Super-admin depth:** metadata-only now, impersonation added later?
6. **Confirm dropping the local-only path in v1.**
7. **Supabase auto-pause fix:** Pro ($25/mo) vs a keep-alive ping. *(Time-sensitive —
   re-pauses in ~7 idle days and kills login.)*

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

---

*Build on a branch. Isolation-test RLS before UI. Verify Stripe webhooks before trusting
billing state. Custom SMTP + domain before any real external user.*
