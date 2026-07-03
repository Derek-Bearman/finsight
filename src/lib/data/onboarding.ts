'use server';

/**
 * Onboarding "Start a firm" entry point. Branches on environment:
 *  - Production (card-upfront): returns a Stripe Checkout URL to redirect to;
 *    the firm is provisioned by the webhook after payment.
 *  - Dev/branch (FINSIGHT_ALLOW_DIRECT_SIGNUP=true): creates a trialing firm
 *    directly (no card) so the app is usable without Stripe wired up.
 */

import { startFirmDirect } from '@/lib/data/provisioning';
import { startCheckout } from '@/lib/billing/actions';
import type { ActionResult } from '@/lib/data/team';

export type SignupOutcome =
  | { mode: 'redirect'; url: string } // go to Stripe Checkout
  | { mode: 'created' }; // firm created directly (dev) — refresh into the app

export async function beginFirmSignup(
  firmName: string,
  origin: string
): Promise<ActionResult<SignupOutcome>> {
  if (process.env.FINSIGHT_ALLOW_DIRECT_SIGNUP === 'true') {
    const r = await startFirmDirect(firmName);
    return r.ok ? { ok: true, data: { mode: 'created' } } : r;
  }
  const r = await startCheckout(firmName, origin);
  return r.ok ? { ok: true, data: { mode: 'redirect', url: r.data.url } } : r;
}
