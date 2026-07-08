#!/usr/bin/env bash
#
# FinSight — flip Stripe billing to LIVE mode.
#
# Run this YOURSELF (Derek) so your live secret key never passes through Claude:
#
#     cd ~/Documents/finsight
#     STRIPE_LIVE_KEY='sk_live_xxx' bash scripts/go-live-stripe.sh
#
# Get the key at: Stripe Dashboard → toggle to LIVE mode (top-right) →
# Developers → API keys → reveal the Secret key (starts sk_live_).
#
# What it does (idempotent — safe to re-run):
#   1. Creates/reuses a LIVE "FinSight" product + $97/mo recurring price.
#   2. Creates a LIVE webhook at the prod URL with the 5 events the app handles
#      (deletes any prior endpoint for that URL so the signing secret is fresh).
#   3. Sets the three Worker secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_ID,
#      STRIPE_WEBHOOK_SECRET.  Secrets take effect on the live Worker immediately
#      — no redeploy needed.
#
# It prints only non-secret IDs. Your key and the webhook signing secret are
# never echoed.
set -euo pipefail

KEY="${STRIPE_LIVE_KEY:-}"
WEBHOOK_URL="https://finsight.arktosmarketing.com/api/stripe/webhook"

if [ -z "$KEY" ]; then
  echo "ERROR: set STRIPE_LIVE_KEY (your sk_live_ key). See the header of this file." >&2
  exit 1
fi
case "$KEY" in
  sk_live_*) : ;;
  sk_test_*) echo "ERROR: that is a TEST key. Toggle Stripe to LIVE mode and use the sk_live_ key." >&2; exit 1 ;;
  *) echo "ERROR: that does not look like a Stripe secret key (expected sk_live_...)." >&2; exit 1 ;;
esac

api() { curl -s -u "$KEY:" "$@"; }

echo "→ Verifying the account can take live charges..."
api https://api.stripe.com/v1/account | python3 -c "
import json,sys
a=json.load(sys.stdin)
assert a.get('charges_enabled'), 'account charges_enabled is FALSE — finish Stripe activation first'
print('  account', a['id'], '| charges_enabled:', a['charges_enabled'], '| payouts_enabled:', a['payouts_enabled'])
"

echo "→ Product (FinSight)..."
PROD=$(api "https://api.stripe.com/v1/products?active=true&limit=100" | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']
p=next((x for x in d if x['name']=='FinSight'),None)
print(p['id'] if p else '')")
if [ -z "$PROD" ]; then
  PROD=$(api -X POST https://api.stripe.com/v1/products -d name=FinSight | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
  echo "  created $PROD"
else echo "  reused $PROD"; fi

echo "→ Price (\$97/mo recurring)..."
PRICE=$(api "https://api.stripe.com/v1/prices?product=$PROD&active=true&limit=100" | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']
p=next((x for x in d if x.get('unit_amount')==9700 and (x.get('recurring') or {}).get('interval')=='month'),None)
print(p['id'] if p else '')")
if [ -z "$PRICE" ]; then
  PRICE=$(api -X POST https://api.stripe.com/v1/prices -d product="$PROD" -d unit_amount=9700 -d currency=usd -d "recurring[interval]=month" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
  echo "  created $PRICE"
else echo "  reused $PRICE"; fi

echo "→ Webhook endpoint (fresh, for a clean signing secret)..."
for ID in $(api "https://api.stripe.com/v1/webhook_endpoints?limit=100" | python3 -c "
import json,sys
for x in json.load(sys.stdin)['data']:
    if x['url']=='$WEBHOOK_URL': print(x['id'])"); do
  api -X DELETE "https://api.stripe.com/v1/webhook_endpoints/$ID" >/dev/null
  echo "  deleted prior endpoint $ID"
done
WHSEC=$(api -X POST https://api.stripe.com/v1/webhook_endpoints \
  -d url="$WEBHOOK_URL" \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=customer.subscription.created" \
  -d "enabled_events[]=customer.subscription.updated" \
  -d "enabled_events[]=customer.subscription.deleted" \
  -d "enabled_events[]=invoice.payment_failed" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['secret'])")
echo "  created webhook with 5 events"

echo "→ Setting Worker secrets (values not echoed)..."
printf '%s' "$KEY"   | npx wrangler secret put STRIPE_SECRET_KEY    >/dev/null && echo "  STRIPE_SECRET_KEY set (sk_live_…)"
printf '%s' "$PRICE" | npx wrangler secret put STRIPE_PRICE_ID      >/dev/null && echo "  STRIPE_PRICE_ID set ($PRICE)"
printf '%s' "$WHSEC" | npx wrangler secret put STRIPE_WEBHOOK_SECRET >/dev/null && echo "  STRIPE_WEBHOOK_SECRET set (whsec_…)"

echo ""
echo "✅ LIVE. finsight.arktosmarketing.com now runs real \$97/mo checkout with a 7-day trial."
echo "   Do one real signup with a real card to confirm, then cancel from /billing if you like."
echo "   (Tell Claude it's done and it will run the end-to-end verification.)"
