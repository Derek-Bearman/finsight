'use client';

/**
 * React context carrying the resolved firm/billing state to the two client app
 * pages (home + workspace) so their headers can render the billing banner, the
 * team/billing/admin nav, and gate writes by access level — without each page
 * re-resolving the session.
 */

import { createContext, useContext } from 'react';
import type { AccessDecision } from '@/lib/billing/access';
import type { MembershipRole } from '@/lib/data/context';

export interface FirmContextValue {
  firmId: string;
  firmName: string;
  userId: string;
  email: string | null;
  role: MembershipRole;
  access: AccessDecision;
  isSuperAdmin: boolean;
  /** Convenience: true when the firm is in read-only billing grace. */
  readOnly: boolean;
}

const FirmContext = createContext<FirmContextValue | null>(null);

export const FirmProvider = FirmContext.Provider;

/** The active firm context, or null when not in an active firm app route. */
export function useFirmContext(): FirmContextValue | null {
  return useContext(FirmContext);
}

/** True when the firm is in read-only billing grace — editing surfaces must
 *  disable themselves (edits would be silently refused server-side). */
export function useReadOnly(): boolean {
  return useContext(FirmContext)?.readOnly ?? false;
}
