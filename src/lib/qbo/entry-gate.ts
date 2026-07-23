/**
 * Visibility gate for the QBO connect ENTRY POINTS that live outside
 * QboControls — the new-client wizard's "Connect QuickBooks instead" link,
 * and any other surface that has no workspace to ask getQboStatus() about
 * yet (the wizard runs BEFORE the workspace exists).
 *
 * This is NOT authorization. /api/qbo/connect and the qbo-actions re-check
 * everything server-side (owner/admin role, demo-firm block, billing 'full')
 * and bounce ineligible callers with ?qbo_error. This helper only decides
 * whether the affordance is worth SHOWING, and must mirror the server's
 * getQboStatus().canManage exactly: owner/admin of a non-demo firm with full
 * billing access.
 */

import type { MembershipRole } from '@/lib/data/context';
import type { AccessLevel } from '@/lib/billing/access';

export interface QboEntryGateInput {
  role: MembershipRole;
  /** True when this is the shared public demo firm (server-computed). */
  isDemoFirm: boolean;
  access: { level: AccessLevel };
}

/** True only for callers the QBO write surface would accept — everyone else
 *  (members, the shared demo, read-only/locked billing) never sees the
 *  affordance. `null` (firm context still resolving) fails closed. */
export function canOfferQboConnect(firm: QboEntryGateInput | null): boolean {
  if (!firm) return false;
  return (
    (firm.role === 'owner' || firm.role === 'admin') &&
    !firm.isDemoFirm &&
    firm.access.level === 'full'
  );
}
