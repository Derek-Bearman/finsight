/**
 * Billing access-state machine checks, runnable headless:
 *   npx tsx scripts/checks/billing-access.check.ts
 *
 * Covers the full plan_status matrix plus the audit fix 3a-3A: an expired
 * trial must fail toward read-only (missed Stripe webhooks must never grant
 * indefinite full access).
 */

import { resolveAccess, canWrite, canRead, type FirmBillingState } from '../../src/lib/billing/access';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

const NOW = new Date('2026-07-07T12:00:00Z');
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000).toISOString();

const firm = (over: Partial<FirmBillingState>): FirmBillingState => ({
  plan_status: 'active',
  trial_ends_at: null,
  current_period_end: null,
  grace_ends_at: null,
  ...over,
});

// active → full
{
  const d = resolveAccess(firm({}), NOW);
  check(d.level === 'full' && d.banner === null, 'active should be full, no banner');
  check(canWrite(d) && canRead(d), 'active should read+write');
}

// trialing, plenty of runway → full, no banner
{
  const d = resolveAccess(firm({ plan_status: 'trialing', trial_ends_at: daysFromNow(6) }), NOW);
  check(d.level === 'full' && d.banner === null, 'trialing(6d) should be full, no banner');
  check(d.trialDaysLeft === 6, `trialing(6d) daysLeft ${d.trialDaysLeft} != 6`);
}

// trialing, ending soon → full with info banner
{
  const d = resolveAccess(firm({ plan_status: 'trialing', trial_ends_at: daysFromNow(2) }), NOW);
  check(d.level === 'full' && d.banner?.severity === 'info', 'trialing(2d) should be full + info banner');
}

// trialing, EXPIRED → read_only with warning (audit fix 3a-3A)
{
  const d = resolveAccess(firm({ plan_status: 'trialing', trial_ends_at: daysFromNow(-1) }), NOW);
  check(d.level === 'read_only', `expired trial should be read_only, got ${d.level}`);
  check(d.banner?.severity === 'warning', 'expired trial should show warning banner');
  check(!canWrite(d) && canRead(d), 'expired trial should read but not write');
}

// trialing, expired long ago → still read_only (never silently full, never hard-locked)
{
  const d = resolveAccess(firm({ plan_status: 'trialing', trial_ends_at: daysFromNow(-90) }), NOW);
  check(d.level === 'read_only', `long-expired trial should be read_only, got ${d.level}`);
}

// trialing with NO trial_ends_at → full (cannot judge; complimentary seeds use 'active' anyway)
{
  const d = resolveAccess(firm({ plan_status: 'trialing', trial_ends_at: null }), NOW);
  check(d.level === 'full', `trialing w/o end date should be full, got ${d.level}`);
}

// past_due inside grace → read_only warning
{
  const d = resolveAccess(firm({ plan_status: 'past_due', grace_ends_at: daysFromNow(2) }), NOW);
  check(d.level === 'read_only' && d.banner?.severity === 'warning', 'past_due in grace should be read_only');
}

// past_due after grace / missing anchor → locked
{
  const d1 = resolveAccess(firm({ plan_status: 'past_due', grace_ends_at: daysFromNow(-1) }), NOW);
  const d2 = resolveAccess(firm({ plan_status: 'past_due', grace_ends_at: null }), NOW);
  check(d1.level === 'locked', 'past_due after grace should be locked');
  check(d2.level === 'locked', 'past_due w/o grace anchor should be locked');
}

// terminal states → locked
for (const status of ['canceled', 'unpaid', 'paused', 'incomplete', 'incomplete_expired']) {
  const d = resolveAccess(firm({ plan_status: status }), NOW);
  check(d.level === 'locked', `${status} should be locked, got ${d.level}`);
}

// unknown/blank → locked (fail closed)
{
  const d1 = resolveAccess(firm({ plan_status: '???' }), NOW);
  const d2 = resolveAccess(firm({ plan_status: '' }), NOW);
  check(d1.level === 'locked' && d2.level === 'locked', 'unknown/blank status should fail closed');
}

if (failures > 0) {
  console.error(`\n${failures} billing-access check(s) FAILED`);
  process.exit(1);
}
console.log('All billing-access checks passed.');
