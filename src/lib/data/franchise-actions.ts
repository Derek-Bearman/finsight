'use server';

/**
 * Franchise server actions (FRANCHISE_BENCHMARKS_PLAN.md §F1) — the only
 * bridge the browser uses to manage firm-level franchises. Reads are open to
 * any active firm member (analysis in linked workspaces needs benchmark data);
 * writes require owner/admin + full billing access and are blocked for the
 * public demo firm. The database enforces the same write gates independently
 * (franchises_* RLS policies), so these checks are UX, not the boundary.
 *
 * NOTE (Next 16 house gotcha): this module must export ONLY async functions —
 * even a type re-export leaves a runtime export in the server-actions loader
 * and 500s every action on the page. Types live in lib/data/franchises.ts.
 */

import { resolveUserContext } from '@/lib/data/context';
import {
  listFranchises,
  insertFranchise,
  updateFranchiseRow,
  deleteFranchiseRow,
  countLinkedWorkspaces,
  type Franchise,
} from '@/lib/data/franchises';
import { getProfile } from '@/lib/profiles';

const DEMO_FIRM_ID = process.env.DEMO_FIRM_ID ?? '3f66a9a8-598b-441c-89e9-de190c60c9be';

type FranchiseWithLinks = Franchise & { linkedCount: number };

type FranchiseStateResult =
  | {
      ok: true;
      canManage: boolean;
      isDemo: boolean;
      franchises: FranchiseWithLinks[];
    }
  | { ok: false; error: string };

type FranchiseActionResult<T = FranchiseWithLinks> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function requireManageContext() {
  const ctx = await resolveUserContext();
  if (ctx.state !== 'active') {
    return { ok: false as const, error: 'Your session has expired. Sign in again to manage franchises.' };
  }
  if (ctx.firm.id === DEMO_FIRM_ID) {
    return { ok: false as const, error: 'Franchises are read-only in the shared demo.' };
  }
  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return { ok: false as const, error: 'Only firm owners and admins can manage franchises.' };
  }
  if (ctx.access.level !== 'full') {
    return { ok: false as const, error: 'Franchise changes are unavailable while billing is limited.' };
  }
  return { ok: true as const, ctx };
}

/** Everything the franchise UI surfaces need in one round-trip. */
export async function getFranchiseState(): Promise<FranchiseStateResult> {
  try {
    const ctx = await resolveUserContext();
    if (ctx.state !== 'active') return { ok: false, error: 'Not signed in.' };
    const [franchises, counts] = await Promise.all([listFranchises(), countLinkedWorkspaces()]);
    const isDemo = ctx.firm.id === DEMO_FIRM_ID;
    return {
      ok: true,
      canManage: !isDemo && (ctx.role === 'owner' || ctx.role === 'admin') && ctx.access.level === 'full',
      isDemo,
      franchises: franchises.map((f) => ({ ...f, linkedCount: counts[f.id] ?? 0 })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to load franchises.' };
  }
}

export async function createFranchiseAction(params: {
  name: string;
  industryProfileId?: string | null;
}): Promise<FranchiseActionResult> {
  const guard = await requireManageContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  const name = params.name?.trim();
  if (!name) return { ok: false, error: 'Franchise name is required.' };
  if (name.length > 120) return { ok: false, error: 'Franchise name is too long (120 max).' };
  if (params.industryProfileId && !getProfile(params.industryProfileId)) {
    return { ok: false, error: 'Unknown industry profile.' };
  }
  try {
    const franchise = await insertFranchise({
      firmId: guard.ctx.firm.id,
      name,
      industryProfileId: params.industryProfileId ?? null,
    });
    return { ok: true, data: { ...franchise, linkedCount: 0 } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to create franchise.' };
  }
}

export async function updateFranchiseAction(params: {
  id: string;
  name?: string;
  industryProfileId?: string | null;
}): Promise<FranchiseActionResult> {
  const guard = await requireManageContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (params.name !== undefined && !params.name.trim()) {
    return { ok: false, error: 'Franchise name is required.' };
  }
  if (params.industryProfileId && !getProfile(params.industryProfileId)) {
    return { ok: false, error: 'Unknown industry profile.' };
  }
  try {
    const updated = await updateFranchiseRow(params.id, {
      name: params.name,
      industryProfileId: params.industryProfileId,
    });
    if (!updated) return { ok: false, error: 'Franchise not found (or you lack permission).' };
    const counts = await countLinkedWorkspaces();
    return { ok: true, data: { ...updated, linkedCount: counts[updated.id] ?? 0 } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to update franchise.' };
  }
}

export async function deleteFranchiseAction(params: { id: string }): Promise<FranchiseActionResult<{ id: string }>> {
  const guard = await requireManageContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  try {
    const counts = await countLinkedWorkspaces();
    const linked = counts[params.id] ?? 0;
    if (linked > 0) {
      return {
        ok: false,
        error: `This franchise still has ${linked} linked client${linked === 1 ? '' : 's'}. Unlink them first.`,
      };
    }
    const deleted = await deleteFranchiseRow(params.id);
    if (!deleted) return { ok: false, error: 'Franchise not found (or you lack permission).' };
    return { ok: true, data: { id: params.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to delete franchise.' };
  }
}
