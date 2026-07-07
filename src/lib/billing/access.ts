/**
 * Billing access-state machine (PURE, no I/O — unit-testable + safe to import
 * on client or server). Maps a firm's billing state to what the app should
 * allow, so gating lives in ONE reviewed place instead of scattered checks.
 *
 * Product rules (FINSIGHT_SAAS_HANDOFF.md):
 *   trialing / active         -> full access
 *   past_due                  -> ~3-day READ-ONLY grace (banner), then locked
 *   canceled / unpaid /
 *   incomplete* / paused      -> locked
 * Unknown status              -> locked (fail closed).
 *
 * The grace window end is `grace_ends_at`, stamped server-side by
 * apply_stripe_status when the firm enters past_due (see the phase4_billing
 * migration). This module only READS it.
 */

export type PlanStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

export type AccessLevel = 'full' | 'read_only' | 'locked';

export interface FirmBillingState {
  plan_status: PlanStatus | string;
  trial_ends_at: string | null; // ISO 8601
  current_period_end: string | null; // ISO 8601
  grace_ends_at: string | null; // ISO 8601 (set only while past_due)
}

export interface AccessBanner {
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface AccessDecision {
  level: AccessLevel;
  reason: string;
  banner: AccessBanner | null;
  /** Whole days left in the trial (>= 0), when trialing and trial_ends_at is set. */
  trialDaysLeft: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * Resolve what a firm may do right now. `now` is injectable for testing.
 * Fails CLOSED: any unrecognized status is treated as locked.
 */
export function resolveAccess(
  firm: FirmBillingState,
  now: Date = new Date()
): AccessDecision {
  const status = firm.plan_status;
  const trialEnds = parseDate(firm.trial_ends_at);
  const graceEnds = parseDate(firm.grace_ends_at);

  switch (status) {
    case 'active':
      return { level: 'full', reason: 'subscription active', banner: null, trialDaysLeft: null };

    case 'trialing': {
      // Fail toward restriction if the trial window has passed but Stripe
      // never moved us off 'trialing' (dropped/failed webhook): read-only —
      // not locked — until billing state is confirmed. Without this check a
      // missed webhook granted full access forever.
      if (trialEnds && now.getTime() > trialEnds.getTime()) {
        return {
          level: 'read_only',
          reason: 'trial ended — awaiting billing confirmation',
          banner: {
            severity: 'warning',
            message:
              'Your trial has ended and we are confirming your subscription. Your workspace is read-only until billing is confirmed — check the Billing page.',
          },
          trialDaysLeft: 0,
        };
      }
      const daysLeft = trialEnds ? Math.max(0, daysBetween(now, trialEnds)) : null;
      let banner: AccessBanner | null = null;
      if (daysLeft !== null && daysLeft <= 3) {
        banner = {
          severity: 'info',
          message:
            daysLeft <= 0
              ? 'Your free trial ends today. Your card will be charged $97/mo to continue.'
              : `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
        };
      }
      return { level: 'full', reason: 'in trial', banner, trialDaysLeft: daysLeft };
    }

    case 'past_due': {
      // Within the read-only grace window? (No/blank anchor => grace has lapsed.)
      if (graceEnds && now < graceEnds) {
        return {
          level: 'read_only',
          reason: 'payment past due — read-only grace',
          banner: {
            severity: 'warning',
            message:
              'We could not charge your card. Update your payment method to keep full access — your workspace is read-only until then.',
          },
          trialDaysLeft: null,
        };
      }
      return {
        level: 'locked',
        reason: 'payment past due — grace expired',
        banner: {
          severity: 'error',
          message: 'Your account is locked for non-payment. Update your payment method to restore access.',
        },
        trialDaysLeft: null,
      };
    }

    case 'canceled':
      return lockedDecision('Your subscription was canceled. Resubscribe to restore access.');
    case 'unpaid':
      return lockedDecision('Your account is locked for non-payment. Update your payment method to restore access.');
    case 'paused':
      return lockedDecision('Your subscription is paused. Resume it to restore access.');
    case 'incomplete':
    case 'incomplete_expired':
      return lockedDecision('Finish setting up your subscription to access FinSight.');

    default:
      // Unknown/blank status: fail closed.
      return lockedDecision('Your subscription needs attention. Contact support to restore access.');
  }
}

function lockedDecision(message: string): AccessDecision {
  return {
    level: 'locked',
    reason: 'billing state does not permit access',
    banner: { severity: 'error', message },
    trialDaysLeft: null,
  };
}

/** Convenience predicates for gating UI/actions. */
export function canWrite(decision: AccessDecision): boolean {
  return decision.level === 'full';
}
export function canRead(decision: AccessDecision): boolean {
  return decision.level === 'full' || decision.level === 'read_only';
}
