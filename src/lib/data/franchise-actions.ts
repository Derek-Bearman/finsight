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
  getFranchise,
  insertFranchise,
  updateFranchiseRow,
  deleteFranchiseRow,
  countLinkedWorkspaces,
  type Franchise,
  type FranchiseBenchmarkSet,
  type FranchiseConfig,
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

// ─────────────────────────────────────────────
// Corporate benchmark sets (FRANCHISE_BENCHMARKS_PLAN.md §F2)
// Versioned sets live inside franchises.config.benchmarkSets (jsonb). All
// three actions are read-modify-write on that array; RLS still gates the
// UPDATE at the database.
// ─────────────────────────────────────────────

const SET_LABEL_MAX = 80;
const SET_METRICS_MAX = 500;
const METRIC_ID_MAX = 120;

/** Returns an error string, or null when the set is valid. */
function validateBenchmarkSet(set: FranchiseBenchmarkSet): string | null {
  if (!set || typeof set.id !== 'string' || !set.id.trim()) {
    return 'Benchmark set id is required.';
  }
  const label = typeof set.label === 'string' ? set.label.trim() : '';
  if (label.length < 1 || label.length > SET_LABEL_MAX) {
    return `Set label must be 1-${SET_LABEL_MAX} characters.`;
  }
  if (!Array.isArray(set.metrics) || set.metrics.length === 0) {
    return 'A benchmark set needs at least one metric.';
  }
  if (set.metrics.length > SET_METRICS_MAX) {
    return `A benchmark set is limited to ${SET_METRICS_MAX} metrics.`;
  }
  for (const m of set.metrics) {
    const id = typeof m?.metricId === 'string' ? m.metricId.trim() : '';
    if (!id) return 'Every metric row needs a metric id.';
    if (id.length > METRIC_ID_MAX) return `Metric id "${id.slice(0, 40)}…" is too long (${METRIC_ID_MAX} max).`;
    if (typeof m.target !== 'number' || !Number.isFinite(m.target)) {
      return `Metric "${id}" needs a finite numeric target.`;
    }
    if (m.direction !== 'gte' && m.direction !== 'lte') {
      return `Metric "${id}" has an invalid direction (use gte or lte).`;
    }
  }
  return null;
}

/** Keep only known fields; stamp uploadedAt/uploadedBy server-side. */
function sanitizeBenchmarkSet(set: FranchiseBenchmarkSet, uploadedBy: string | null): FranchiseBenchmarkSet {
  const clean: FranchiseBenchmarkSet = {
    id: set.id.trim(),
    label: set.label.trim(),
    uploadedAt: new Date().toISOString(),
    active: set.active === true,
    metrics: set.metrics.map((m) => {
      const notes = typeof m.notes === 'string' ? m.notes.trim() : '';
      return {
        metricId: m.metricId.trim(),
        target: m.target,
        direction: m.direction,
        ...(notes ? { notes } : {}),
      };
    }),
  };
  const effectiveDate = typeof set.effectiveDate === 'string' ? set.effectiveDate.trim() : '';
  if (effectiveDate) clean.effectiveDate = effectiveDate;
  if (uploadedBy) clean.uploadedBy = uploadedBy;
  return clean;
}

async function withLinkedCount(franchise: Franchise): Promise<FranchiseWithLinks> {
  const counts = await countLinkedWorkspaces();
  return { ...franchise, linkedCount: counts[franchise.id] ?? 0 };
}

/**
 * Insert or replace a corporate benchmark set (matched by set.id). When the
 * incoming set is active, every other set on the franchise is deactivated —
 * exactly one set can be active at a time.
 */
export async function saveBenchmarkSetAction(params: {
  franchiseId: string;
  set: FranchiseBenchmarkSet;
}): Promise<FranchiseActionResult> {
  const guard = await requireManageContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  const invalid = validateBenchmarkSet(params.set);
  if (invalid) return { ok: false, error: invalid };
  try {
    const franchise = await getFranchise(params.franchiseId);
    if (!franchise) return { ok: false, error: 'Franchise not found (or you lack permission).' };
    const clean = sanitizeBenchmarkSet(params.set, guard.ctx.email);
    const existing = franchise.config.benchmarkSets ?? [];
    let sets = existing.some((s) => s.id === clean.id)
      ? existing.map((s) => (s.id === clean.id ? clean : s))
      : [...existing, clean];
    if (clean.active) {
      sets = sets.map((s) => (s.id === clean.id ? s : { ...s, active: false }));
    }
    const config: FranchiseConfig = { ...franchise.config, benchmarkSets: sets };
    const updated = await updateFranchiseRow(params.franchiseId, { config });
    if (!updated) return { ok: false, error: 'Franchise not found (or you lack permission).' };
    return { ok: true, data: await withLinkedCount(updated) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to save benchmark set.' };
  }
}

/** Make one set active and deactivate the rest. */
export async function activateBenchmarkSetAction(params: {
  franchiseId: string;
  setId: string;
}): Promise<FranchiseActionResult> {
  const guard = await requireManageContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  try {
    const franchise = await getFranchise(params.franchiseId);
    if (!franchise) return { ok: false, error: 'Franchise not found (or you lack permission).' };
    const sets = franchise.config.benchmarkSets ?? [];
    if (!sets.some((s) => s.id === params.setId)) {
      return { ok: false, error: 'Benchmark set not found.' };
    }
    const config: FranchiseConfig = {
      ...franchise.config,
      benchmarkSets: sets.map((s) => ({ ...s, active: s.id === params.setId })),
    };
    const updated = await updateFranchiseRow(params.franchiseId, { config });
    if (!updated) return { ok: false, error: 'Franchise not found (or you lack permission).' };
    return { ok: true, data: await withLinkedCount(updated) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to activate benchmark set.' };
  }
}

/** Remove a set. Deleting the active set leaves no set active — linked
 *  workspaces simply fall back to the next tier (pack or defaults). */
export async function deleteBenchmarkSetAction(params: {
  franchiseId: string;
  setId: string;
}): Promise<FranchiseActionResult> {
  const guard = await requireManageContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  try {
    const franchise = await getFranchise(params.franchiseId);
    if (!franchise) return { ok: false, error: 'Franchise not found (or you lack permission).' };
    const sets = franchise.config.benchmarkSets ?? [];
    if (!sets.some((s) => s.id === params.setId)) {
      return { ok: false, error: 'Benchmark set not found.' };
    }
    const config: FranchiseConfig = {
      ...franchise.config,
      benchmarkSets: sets.filter((s) => s.id !== params.setId),
    };
    const updated = await updateFranchiseRow(params.franchiseId, { config });
    if (!updated) return { ok: false, error: 'Franchise not found (or you lack permission).' };
    return { ok: true, data: await withLinkedCount(updated) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to delete benchmark set.' };
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

// ─────────────────────────────────────────────
// Corporate SCOA (FRANCHISE_BENCHMARKS_PLAN.md §F4)
// One SCOA per franchise, stored in config.scoa; replacing overwrites.
// ─────────────────────────────────────────────

const SCOA_ACCOUNTS_MAX = 2000;

export async function saveScoaAction(params: {
  franchiseId: string;
  accounts: Array<{ number: string; name: string; type?: string; statementType?: 'pnl' | 'balance'; parentNumber?: string }>;
}): Promise<FranchiseActionResult> {
  const guard = await requireManageContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  const rows = Array.isArray(params.accounts) ? params.accounts : [];
  if (rows.length === 0) return { ok: false, error: 'The SCOA needs at least one account.' };
  if (rows.length > SCOA_ACCOUNTS_MAX) {
    return { ok: false, error: `A SCOA is limited to ${SCOA_ACCOUNTS_MAX} accounts.` };
  }
  const seen = new Set<string>();
  const clean = [];
  for (const r of rows) {
    const number = typeof r.number === 'string' ? r.number.trim() : '';
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!number || !name) return { ok: false, error: 'Every SCOA row needs an account number and a name.' };
    if (seen.has(number)) return { ok: false, error: `Duplicate SCOA account number "${number}".` };
    seen.add(number);
    clean.push({
      number,
      name,
      ...(typeof r.type === 'string' && r.type.trim() ? { type: r.type.trim() } : {}),
      ...(r.statementType === 'pnl' || r.statementType === 'balance' ? { statementType: r.statementType } : {}),
      ...(typeof r.parentNumber === 'string' && r.parentNumber.trim() ? { parentNumber: r.parentNumber.trim() } : {}),
    });
  }
  try {
    const franchise = await getFranchise(params.franchiseId);
    if (!franchise) return { ok: false, error: 'Franchise not found.' };
    const config: FranchiseConfig = {
      ...franchise.config,
      scoa: {
        uploadedAt: new Date().toISOString(),
        ...(guard.ctx.email ? { uploadedBy: guard.ctx.email } : {}),
        accounts: clean,
      },
    };
    const updated = await updateFranchiseRow(params.franchiseId, { config });
    if (!updated) return { ok: false, error: 'Franchise not found (or you lack permission).' };
    return { ok: true, data: await withLinkedCount(updated) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to save the SCOA.' };
  }
}

export async function clearScoaAction(params: { franchiseId: string }): Promise<FranchiseActionResult> {
  const guard = await requireManageContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  try {
    const franchise = await getFranchise(params.franchiseId);
    if (!franchise) return { ok: false, error: 'Franchise not found.' };
    const config: FranchiseConfig = { ...franchise.config };
    delete config.scoa;
    const updated = await updateFranchiseRow(params.franchiseId, { config });
    if (!updated) return { ok: false, error: 'Franchise not found (or you lack permission).' };
    return { ok: true, data: await withLinkedCount(updated) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to remove the SCOA.' };
  }
}
