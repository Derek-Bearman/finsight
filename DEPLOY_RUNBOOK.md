# FinSight SaaS — Go-Live Runbook

Exact steps to take the `phase-2a-tenancy` branch live. The code is built + tested;
the full Workers bundle dry-run passes (Stripe SDK bundles fine). What's left is
account/dashboard/DNS setup only you can do, then deploy. Do the steps in order.

Domain (decided): **`finsight.arktosmarketing.com`** — already staged in `wrangler.jsonc`.

---

## 1. Stripe (test mode first)

Dashboard → toggle **Test mode** ON (top right).

**a. Product + Price**
- Products → **Add product** → Name `FinSight`.
- Pricing: **Recurring**, `$97.00`, **Monthly**. Save.
- Copy the **Price ID** → `price_...`  → this is `STRIPE_PRICE_ID`.

**b. Secret key**
- Developers → API keys → copy the **Secret key** `sk_test_...` → `STRIPE_SECRET_KEY`.

**c. Webhook endpoint** (create AFTER the domain resolves — step 4 — so test events verify)
- Developers → Webhooks → **Add endpoint**.
- URL: `https://finsight.arktosmarketing.com/api/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
- Copy the **Signing secret** `whsec_...` → `STRIPE_WEBHOOK_SECRET`.

Repeat in **Live mode** when ready for real customers (new keys + a live webhook + live Price).

## 2. Resend SMTP (so trial codes + invites actually land)

- Create/log in to Resend → **Domains → Add** `arktosmarketing.com` (or `finsight.arktosmarketing.com`).
- Add the DKIM/SPF (and return-path) DNS records Resend shows you into **Cloudflare DNS**
  for the arktosmarketing.com zone → wait for **Verified**.
- Create an **API key**.
- Supabase dashboard → **Project Settings → Auth → SMTP Settings → Enable custom SMTP**:
  - Host `smtp.resend.com`, Port `465` (SSL), Username `resend`, Password = the Resend API key.
  - Sender `finsight@arktosmarketing.com`, Sender name `FinSight`.

## 3. Supabase Auth URL config

Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL**: `https://finsight.arktosmarketing.com`
- **Redirect URLs**: add `https://finsight.arktosmarketing.com/auth/callback`
  (keep `http://localhost:3000/auth/callback` for dev).

## 4. Set secrets + deploy

```bash
cd ~/Documents/finsight
git checkout phase-2a-tenancy          # review it, then merge to main if you prefer
npm install                            # adds stripe@17

# Secrets (values from steps 1–3). Non-interactive form:
echo "bearman.derek@gmail.com" | npx wrangler secret put SUPER_ADMIN_EMAILS
echo "sk_test_XXXX"            | npx wrangler secret put STRIPE_SECRET_KEY
echo "price_XXXX"             | npx wrangler secret put STRIPE_PRICE_ID
echo "whsec_XXXX"            | npx wrangler secret put STRIPE_WEBHOOK_SECRET
# SUPABASE_SERVICE_ROLE_KEY was set in Phase 1; re-set only if missing:
# npx wrangler secret list        # to check
# (paste value) | npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# Commit the staged custom-domain change, then deploy:
git add wrangler.jsonc && git commit -m "Enable finsight.arktosmarketing.com custom domain"
npm run cf:deploy
```

- The deploy provisions the `finsight.arktosmarketing.com` cert + DNS route (may take a few min for SSL).
- Do **NOT** set `FINSIGHT_ALLOW_DIRECT_SIGNUP` in prod — leaving it unset forces firms
  through Stripe checkout (card required). It's only for local dev.

## 5. Verify (once live)

- `curl -I https://finsight.arktosmarketing.com/login` → 200.
- `stripe trigger checkout.session.completed` (Stripe CLI) or a real test checkout → confirm a
  `firms` row + owner `memberships` row appear (Supabase table editor).
- Sign in with a real email → confirm the trial-code email arrives (Resend).
- Invite a teammate from `/team` → open the link → `/invite/<token>` → accept → they join.
- `/billing` shows status + Manage-billing (owner). `/admin` (from SUPER_ADMIN_EMAILS) lists firms.

## Code status (2026-07-05): localStorage → Postgres wiring DONE + click-verified

The `/` app is now firm-aware and cloud-persisted (see FINSIGHT_SAAS_HANDOFF.md §I). Verified
end to end against a real Supabase session: create/persist/hard-refresh, write-through, the
first-login import prompt (idempotent), delete, invite→accept→shared clients, and the
full→read-only→locked billing gate. `next build` green; committed on `phase-2a-tenancy`; **not
deployed**. What remains before real users is the external-dependency setup in steps 1–4 above
(Stripe, Resend, Supabase Auth URLs, secrets + deploy) — the in-app code is complete.
