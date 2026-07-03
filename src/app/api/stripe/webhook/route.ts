/**
 * Stripe webhook. PUBLIC (Stripe posts here with no session) — allowlisted in
 * middleware.ts. Signature-verified with the ASYNC verifier (Web Crypto, so it
 * works on the Cloudflare Workers runtime). Idempotent: create_firm_with_owner
 * is idempotent on stripe_customer_id and apply_stripe_status is a state-set, so
 * Stripe retries are safe.
 *
 * Handled events:
 *   checkout.session.completed          -> provision firm + owner from metadata
 *   customer.subscription.created/updated/deleted -> sync plan_status/period
 *   invoice.payment_failed              -> mark past_due (starts the grace clock)
 */

import type Stripe from 'stripe';
import { getStripe, subscriptionPeriodEndISO } from '@/lib/billing/stripe';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

async function syncSubscription(sub: Stripe.Subscription) {
  const service = createSupabaseServiceClient();
  await service.rpc('apply_stripe_status', {
    p_stripe_customer_id: sub.customer as string,
    p_status: sub.status,
    p_current_period_end: subscriptionPeriodEndISO(sub) ?? undefined,
    p_stripe_subscription_id: sub.id,
  });
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response('webhook not configured', { status: 500 });
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('missing signature', { status: 400 });

  const stripe = getStripe();
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, secret);
  } catch (err) {
    return new Response(`invalid signature: ${(err as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = (session.metadata?.user_id ?? session.client_reference_id) as string | undefined;
        const firmName = session.metadata?.firm_name ?? 'My Firm';
        const customerId = session.customer as string | null;
        const subscriptionId = session.subscription as string | null;
        if (!userId || !customerId || !subscriptionId) break;

        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const service = createSupabaseServiceClient();
        // Provision (idempotent on customer id) with the initial status...
        await service.rpc('create_firm_with_owner', {
          p_firm_name: firmName,
          p_owner_user_id: userId,
          p_stripe_customer_id: customerId,
          p_stripe_subscription_id: subscriptionId,
          p_plan_status: sub.status,
        });
        // ...then reconcile period/grace via the billing funnel.
        await syncSubscription(sub);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        if (inv.customer) {
          const service = createSupabaseServiceClient();
          await service.rpc('apply_stripe_status', {
            p_stripe_customer_id: inv.customer as string,
            p_status: 'past_due',
          });
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // Return 500 so Stripe retries; log for observability.
    console.error('stripe webhook handler error', event.type, err);
    return new Response('handler error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
}
