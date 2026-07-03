'use server';

/**
 * Billing server actions used by onboarding + the billing page. Return a URL
 * for the client to redirect to Stripe's hosted pages (no client-side Stripe).
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createCheckoutSession, createBillingPortalSession } from '@/lib/billing/stripe';
import { requireActiveContext } from '@/lib/data/context';
import type { ActionResult } from '@/lib/data/team';

/** Start the card-upfront trial checkout for the signed-in user. */
export async function startCheckout(
  firmName: string,
  origin: string
): Promise<ActionResult<{ url: string }>> {
  const name = firmName.trim();
  if (name.length < 2) return { ok: false, error: 'Please enter a firm name.' };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: 'Not signed in.' };

  // Don't let someone who already has a firm start a second checkout.
  const { data: existing } = await supabase
    .from('memberships')
    .select('firm_id')
    .eq('status', 'active')
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, error: 'You already belong to a firm.' };
  }

  try {
    const url = await createCheckoutSession({
      userId: user.id,
      email: user.email,
      firmName: name,
      origin,
    });
    return { ok: true, data: { url } };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Open the Stripe Billing Portal for the current firm (owner action). */
export async function openBillingPortal(origin: string): Promise<ActionResult<{ url: string }>> {
  const ctx = await requireActiveContext();
  if (ctx.role !== 'owner') return { ok: false, error: 'Only the firm owner can manage billing.' };
  if (!ctx.firm.stripe_customer_id) {
    return { ok: false, error: 'No billing account is linked to this firm yet.' };
  }
  try {
    const url = await createBillingPortalSession({
      stripeCustomerId: ctx.firm.stripe_customer_id,
      origin,
    });
    return { ok: true, data: { url } };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
