/**
 * Membership resolver — the server-side routing brain. Given the request's
 * authenticated user, resolves which firm they act in, their role, and the
 * firm's billing access level. This is what the app root uses to route:
 *   unauthenticated -> /login
 *   authenticated, no firm -> onboarding fork
 *   authenticated with an active firm -> the firm app (gated by `access`)
 *
 * All reads go through the request-scoped, RLS-enforced server client, so a
 * user can only ever resolve their OWN firms. v1 is single-firm-per-user; if a
 * user has several active memberships we pick the earliest deterministically
 * (a firm switcher can come later).
 */

// Server-only by construction: importing @/lib/supabase/server pulls in
// next/headers, which fails the build if reached from a client component.
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveAccess, type AccessDecision, type FirmBillingState } from '@/lib/billing/access';
import type { Tables, Enums } from '@/lib/supabase/database.types';

export type FirmRow = Tables<'firms'>;
export type MembershipRole = Enums<'membership_role'>;

export interface ActiveContext {
  state: 'active';
  userId: string;
  email: string | null;
  firm: FirmRow;
  role: MembershipRole;
  access: AccessDecision;
}
export type UserContext =
  | { state: 'unauthenticated' }
  | { state: 'onboarding'; userId: string; email: string | null }
  | ActiveContext;

export async function resolveUserContext(): Promise<UserContext> {
  const supabase = await createSupabaseServerClient();
  // getClaims verifies the JWT locally (asymmetric keys; falls back to a
  // network getUser on legacy HS256 projects) instead of paying a second
  // serial GoTrue round-trip on every server action/page — the middleware
  // already did the authoritative getUser + token refresh for this request.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return { state: 'unauthenticated' };
  const userId = claims.sub;

  const email = typeof claims.email === 'string' && claims.email.length > 0 ? claims.email : null;

  // Active memberships for THIS user, earliest first. The memberships_select
  // RLS policy is firm-scoped (co-members are visible to each other), so an
  // explicit user_id filter is required — without it, `[0]` resolves to the
  // firm's earliest membership (the owner) for every teammate, silently
  // granting them the owner's role.
  const { data: memberships, error } = await supabase
    .from('memberships')
    .select('firm_id, role, created_at, firms(*)')
    .eq('status', 'active')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const first = memberships?.[0];
  if (!first || !first.firms) {
    return { state: 'onboarding', userId, email };
  }

  const firm = first.firms as FirmRow;
  const billing: FirmBillingState = {
    plan_status: firm.plan_status,
    trial_ends_at: firm.trial_ends_at,
    current_period_end: firm.current_period_end,
    grace_ends_at: firm.grace_ends_at,
  };

  return {
    state: 'active',
    userId,
    email,
    firm,
    role: first.role as MembershipRole,
    access: resolveAccess(billing),
  };
}

/** Convenience: throw unless there's an active firm context. For server code
 *  that must run inside a firm (workspace CRUD, team management). */
export async function requireActiveContext(): Promise<ActiveContext> {
  const ctx = await resolveUserContext();
  if (ctx.state !== 'active') {
    throw new Error('No active firm for the current user.');
  }
  return ctx;
}
