/**
 * Stripe integration. SERVER-ONLY. Uses HOSTED Checkout + Billing Portal
 * (full-page redirects), so the browser never talks to Stripe directly and the
 * app CSP needs no Stripe hosts. (If you later embed Stripe.js/Elements, add
 * https://js.stripe.com to script-src + https://api.stripe.com to connect-src
 * in worker.ts.)
 *
 * Required env (wrangler secrets in prod, .env.local in dev):
 *   STRIPE_SECRET_KEY        sk_...
 *   STRIPE_PRICE_ID          price_...  ($97/mo recurring)
 *   STRIPE_WEBHOOK_SECRET    whsec_...  (from the webhook endpoint)
 */

import Stripe from 'stripe';

if (typeof window !== 'undefined') {
  throw new Error('billing/stripe.ts is server-only and must never reach the browser.');
}

/** Fresh client per call (holds only the env API key — no per-request state).
 *  Fetch HTTP client so it works on the Cloudflare Workers runtime. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY.');
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}

/** Create a card-upfront, 7-day-trial subscription Checkout session and return
 *  its hosted URL. metadata carries what the webhook needs to provision. */
export async function createCheckoutSession(params: {
  userId: string;
  email: string;
  firmName: string;
  origin: string;
}): Promise<string> {
  const price = process.env.STRIPE_PRICE_ID;
  if (!price) throw new Error('Missing STRIPE_PRICE_ID.');
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    // Card required up front even though there's a trial.
    payment_method_collection: 'always',
    subscription_data: { trial_period_days: 7 },
    customer_email: params.email,
    client_reference_id: params.userId,
    metadata: { user_id: params.userId, firm_name: params.firmName },
    success_url: `${params.origin}/?welcome=1`,
    cancel_url: `${params.origin}/onboarding?canceled=1`,
  });
  if (!session.url) throw new Error('Stripe did not return a checkout URL.');
  return session.url;
}

/** Create a Billing Portal session (manage card / cancel) and return its URL. */
export async function createBillingPortalSession(params: {
  stripeCustomerId: string;
  origin: string;
}): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: params.stripeCustomerId,
    return_url: `${params.origin}/billing`,
  });
  return session.url;
}

/** Read the current-period-end unix ts across Stripe API versions (it lives on
 *  the subscription top-level in older versions, on items in newer ones). */
export function subscriptionPeriodEndISO(sub: Stripe.Subscription): string | null {
  const s = sub as unknown as {
    current_period_end?: number;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const unix = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
  return typeof unix === 'number' ? new Date(unix * 1000).toISOString() : null;
}
