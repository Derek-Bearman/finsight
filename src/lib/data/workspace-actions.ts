'use server';

/**
 * Phase-2b client-facing server actions — the ONLY bridge the browser app uses
 * to reach the RLS-enforced workspace data layer. The Zustand store (client)
 * calls these; they resolve the caller's firm from the request session and
 * delegate to the server-only `lib/data/*` modules. Everything returned is
 * plain JSON so it serializes cleanly across the server-action boundary.
 *
 * Writes fail CLOSED on billing: they require `access.level === 'full'`. A firm
 * in read-only grace (past_due) or locked can still READ its data (the store is
 * already hydrated), but persistence is refused server-side — defense in depth
 * behind the client-side gating.
 */

import { resolveUserContext } from '@/lib/data/context';
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  importLocalWorkspaces,
  type ImportItem,
  type ImportResult,
} from '@/lib/data/workspaces';
import { isSuperAdmin } from '@/lib/auth/super-admin';
import type { ActionResult } from '@/lib/data/team';
import type { AccessDecision } from '@/lib/billing/access';
import type { MembershipRole } from '@/lib/data/context';
import type { ClientWorkspace } from '@/types';

/** Serializable snapshot the client bootstrap needs to route + hydrate. */
export type FirmAppState =
  | { state: 'unauthenticated' }
  | { state: 'onboarding' }
  | {
      state: 'active';
      firmId: string;
      firmName: string;
      userId: string;
      email: string | null;
      role: MembershipRole;
      access: AccessDecision;
      isSuperAdmin: boolean;
      workspaces: ClientWorkspace[];
    };

/**
 * Resolve the current user's firm context and (when active) load the firm's
 * workspaces from Postgres. Called once by the client-side app gate on load.
 */
export async function loadFirmApp(): Promise<FirmAppState> {
  const ctx = await resolveUserContext();
  if (ctx.state === 'unauthenticated') return { state: 'unauthenticated' };
  if (ctx.state === 'onboarding') return { state: 'onboarding' };

  const workspaces = await listWorkspaces();
  return {
    state: 'active',
    firmId: ctx.firm.id,
    firmName: ctx.firm.name,
    userId: ctx.userId,
    email: ctx.email,
    role: ctx.role,
    access: ctx.access,
    isSuperAdmin: isSuperAdmin(ctx.email),
    workspaces,
  };
}

/** Why a save was refused/failed — lets the client sync engine react
 *  correctly (retry transient errors, stop on conflict, re-resolve access on
 *  auth/billing refusals) instead of treating every failure the same. */
export type SaveErrorCode = 'conflict' | 'read_only' | 'locked' | 'unauthenticated' | 'error';

export type SaveResult<T = ClientWorkspace> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: SaveErrorCode };

/** Guard: only a full-access firm may write. Returns the active context or an error. */
async function requireWritableContext() {
  const ctx = await resolveUserContext();
  if (ctx.state === 'unauthenticated') {
    return {
      ok: false as const,
      error: 'Your session has expired. Sign in again (a new tab works) to keep saving.',
      code: 'unauthenticated' as const,
    };
  }
  if (ctx.state === 'onboarding') {
    return {
      ok: false as const,
      error: 'No active firm for the current user.',
      code: 'unauthenticated' as const,
    };
  }
  if (ctx.access.level !== 'full') {
    return ctx.access.level === 'read_only'
      ? {
          ok: false as const,
          error: 'Your workspace is read-only while payment is being resolved — changes are not saved.',
          code: 'read_only' as const,
        }
      : {
          ok: false as const,
          error: 'Your account is locked. Restore billing to make changes.',
          code: 'locked' as const,
        };
  }
  return { ok: true as const, ctx };
}

/** Create a brand-new workspace in the firm. Returns the stored workspace with
 *  its DB-assigned uuid so the client can swap its temporary local id. */
export async function saveNewWorkspace(
  ws: ClientWorkspace
): Promise<ActionResult<ClientWorkspace>> {
  const guard = await requireWritableContext();
  if (!guard.ok) return guard;
  try {
    const stored = await createWorkspace(guard.ctx.firm.id, guard.ctx.userId, ws);
    return { ok: true, data: stored };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to create workspace.' };
  }
}

/** Persist an existing workspace (by its DB uuid). firm_id/created_by are pinned
 *  immutable by a DB trigger, so only name/profile/data change. Guarded on the
 *  workspace's cloudVersion — a concurrent teammate save returns a conflict. */
export async function saveWorkspace(ws: ClientWorkspace): Promise<SaveResult> {
  const guard = await requireWritableContext();
  if (!guard.ok) return guard;
  try {
    const outcome = await updateWorkspace(ws);
    if (!outcome.ok) {
      return {
        ok: false,
        error: 'This client was changed by a teammate. Reload to see their changes.',
        code: 'conflict',
      };
    }
    return { ok: true, data: outcome.workspace };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to save workspace.',
      code: 'error',
    };
  }
}

/**
 * The public "Explore the live demo" sandbox is shared: every visitor signs in
 * as the same member of the demo firm. Deleting the seeded sample would break
 * the demo for everyone until the nightly reseed. Block destructive workspace
 * ops on that firm so a casual visitor can't wipe it. Env-overridable; falls
 * back to the known demo firm id.
 */
const DEMO_FIRM_ID = process.env.DEMO_FIRM_ID ?? '3f66a9a8-598b-441c-89e9-de190c60c9be';

/** Delete a workspace (by its DB uuid). */
export async function removeWorkspace(id: string): Promise<ActionResult> {
  const guard = await requireWritableContext();
  if (!guard.ok) return guard;
  if (guard.ctx.firm.id === DEMO_FIRM_ID) {
    return {
      ok: false,
      error:
        'This is the shared demo workspace — deleting the sample client is disabled so the demo stays intact for everyone. Sign up to get a workspace of your own.',
    };
  }
  try {
    await deleteWorkspace(id);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to delete workspace.' };
  }
}

/** Import selected localStorage workspaces into the firm (idempotent on
 *  source_local_id). Returns the counts AND the full refreshed workspace list
 *  so the client can re-hydrate the store in one round-trip. */
export async function runImport(
  items: ImportItem[]
): Promise<ActionResult<{ result: ImportResult; workspaces: ClientWorkspace[] }>> {
  const guard = await requireWritableContext();
  if (!guard.ok) return guard;
  try {
    const result = await importLocalWorkspaces(guard.ctx.firm.id, guard.ctx.userId, items);
    const workspaces = await listWorkspaces();
    return { ok: true, data: { result, workspaces } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Import failed.' };
  }
}
