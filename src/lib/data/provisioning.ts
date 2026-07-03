'use server';

/**
 * Firm provisioning. In PRODUCTION a firm is created by the Stripe webhook
 * after a completed card-upfront checkout (createFirmFromCheckout below, called
 * server-side with the Stripe customer/subscription). A user can never
 * self-provision a firm through RLS (memberships_insert is service-role-only),
 * which is the point — no free access without a card.
 *
 * `startFirmDirect` is a DEV/branch stopgap so the whole app can be exercised
 * without Stripe. It is gated behind FINSIGHT_ALLOW_DIRECT_SIGNUP=true and
 * refuses otherwise, so it can NEVER be used in prod to skip billing.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { ActionResult } from '@/lib/data/team';

/** DEV ONLY (env-gated): create a trialing firm + owner for the current user,
 *  no card. Refuses in prod. */
export async function startFirmDirect(firmName: string): Promise<ActionResult<{ firmId: string }>> {
  if (process.env.FINSIGHT_ALLOW_DIRECT_SIGNUP !== 'true') {
    return {
      ok: false,
      error:
        'Direct firm signup is disabled. Firms are provisioned through Stripe checkout (card required).',
    };
  }
  const name = firmName.trim();
  if (name.length < 2) return { ok: false, error: 'Please enter a firm name.' };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  // Guard: one firm per user in v1 — don't let a repeat click create duplicates.
  const { data: existing } = await supabase.from('memberships').select('firm_id').eq('status', 'active').limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, error: 'You already belong to a firm.' };
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc('create_firm_with_owner', {
    p_firm_name: name,
    p_owner_user_id: user.id,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { firmId: data as string } };
}

/**
 * Provision a firm from a completed Stripe checkout. Server-side only (called
 * by the webhook / checkout-complete handler with values Stripe verified).
 * Idempotent on stripe_customer_id (the RPC returns the existing firm).
 */
export async function createFirmFromCheckout(params: {
  firmName: string;
  ownerUserId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  planStatus: string;
}): Promise<string> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc('create_firm_with_owner', {
    p_firm_name: params.firmName,
    p_owner_user_id: params.ownerUserId,
    p_stripe_customer_id: params.stripeCustomerId,
    p_stripe_subscription_id: params.stripeSubscriptionId,
    p_plan_status: params.planStatus,
  });
  if (error) throw error;
  return data as string;
}
