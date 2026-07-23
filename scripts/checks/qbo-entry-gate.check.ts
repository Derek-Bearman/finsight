/**
 * QBO connect entry-point visibility checks, runnable headless:
 *   npx tsx scripts/checks/qbo-entry-gate.check.ts
 *
 * canOfferQboConnect decides whether the pre-workspace QBO entry points (the
 * wizard's "Connect QuickBooks instead" link) are SHOWN. It must mirror the
 * server gates exactly — owner/admin + non-demo firm + billing 'full' — the
 * same matrix getQboStatus().canManage computes for per-workspace surfaces.
 * The server still re-checks everything on /api/qbo/connect; these checks
 * pin the hide-the-button matrix so a member, the shared demo firm, or a
 * billing-restricted firm never sees the affordance.
 */

import { canOfferQboConnect, type QboEntryGateInput } from '../../src/lib/qbo/entry-gate';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

const firm = (over: Partial<QboEntryGateInput>): QboEntryGateInput => ({
  role: 'owner',
  isDemoFirm: false,
  access: { level: 'full' },
  ...over,
});

// Eligible callers — exactly the ones the write actions would accept
check(canOfferQboConnect(firm({})), 'owner + non-demo + full should see the affordance');
check(canOfferQboConnect(firm({ role: 'admin' })), 'admin + non-demo + full should see the affordance');

// Role gate: members never see it
check(!canOfferQboConnect(firm({ role: 'member' })), 'member must NOT see the affordance');

// Demo gate: the shared demo firm never sees it, regardless of role
check(!canOfferQboConnect(firm({ isDemoFirm: true })), 'demo-firm owner must NOT see the affordance');
check(
  !canOfferQboConnect(firm({ isDemoFirm: true, role: 'admin' })),
  'demo-firm admin must NOT see the affordance'
);

// Billing gate: anything below 'full' hides it
check(
  !canOfferQboConnect(firm({ access: { level: 'read_only' } })),
  'read-only billing must NOT see the affordance'
);
check(
  !canOfferQboConnect(firm({ access: { level: 'locked' } })),
  'locked billing must NOT see the affordance'
);

// Compound: an ineligible role stays hidden even with everything else right
check(
  !canOfferQboConnect(firm({ role: 'member', isDemoFirm: true, access: { level: 'read_only' } })),
  'member + demo + read-only must NOT see the affordance'
);

// Null firm context (still resolving) fails closed
check(!canOfferQboConnect(null), 'null firm context must fail closed');

if (failures > 0) {
  console.error(`\n${failures} qbo-entry-gate check(s) FAILED`);
  process.exit(1);
}
console.log('All qbo-entry-gate checks passed.');
