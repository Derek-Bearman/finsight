'use server';

/**
 * QBO client-facing server actions — the ONLY surface the browser app uses to
 * reach the QuickBooks integration (plan §4). Follows workspace-actions.ts
 * conventions: fail-closed result objects (never thrown errors across the
 * boundary), context resolved from the request session, plain-JSON returns.
 *
 * Shared gating (every action):
 *  - caller must have an active firm context;
 *  - the workspace must belong to the caller's firm, verified by fetching the
 *    workspace row through the RLS server client (cross-firm ids resolve to
 *    nothing);
 *  - connect/disconnect/sync are owner/admin-only (plan §2.11 — members work
 *    in clients; wiring an external books feed is admin surface);
 *  - the shared demo firm (DEMO_FIRM_ID) is blocked from all writes;
 *  - billing access must be 'full' for sync (read-only grace can still VIEW
 *    connection status). Disconnect is deliberately allowed regardless of
 *    billing level — severing a data feed must not be paywalled.
 *
 * Sync is CLIENT-driven (plan §2.2): planQboSync returns calendar-year
 * chunks, runQboSyncChunk returns RAW report payloads one chunk at a time,
 * and the client runs the pure transform once over all accumulated chunks
 * before committing through the existing diff/merge/review flow. The client
 * then calls completeQboSync to stamp last_synced_at.
 */

import { resolveUserContext, type ActiveContext } from '@/lib/data/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  buildApiContext,
  deleteConnection,
  getConnectionForWorkspace,
  markSyncResult,
  QboReauthRequiredError,
  type QboConnectionRow,
} from '@/lib/qbo/connections';
import {
  fetchBalanceSheetMonthly,
  fetchChartOfAccounts,
  fetchCompanyInfo,
  fetchProfitAndLossMonthly,
} from '@/lib/qbo/api';
import { planSyncChunks, type QboSyncChunk } from '@/lib/qbo/sync';
import type { QboAccount, QboReport } from '@/lib/qbo/qbo-types';

// NOTE: no `export type { QboSyncChunk }` here — a 'use server' module may only
// export async functions in this Next version; even a type re-export of an
// imported binding leaves a runtime export in the server-actions loader and
// crashes EVERY action on the page (ReferenceError at module evaluation).
// Import the chunk type from '@/lib/qbo/sync' instead.

// ─────────────────────────────────────────────
// Result shapes
// ─────────────────────────────────────────────

export interface QboStatusResult {
  connected: boolean;
  companyName: string | null;
  /** QBO company (realm) id — non-token column; the transform layer
   *  realm-qualifies imported externalIds with it. Null when disconnected.
   *  getQboStatus ALWAYS returns it; typed optional only so UI-side literals
   *  built before the realmId wave keep compiling. */
  realmId?: string | null;
  status: 'active' | 'needs_reauth' | 'revoked' | 'error' | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  /** True only for owner/admin of a non-demo firm with full billing access —
   *  exactly the callers the write actions would accept. */
  canManage: boolean;
  /** True when the dev mock-Intuit flow is active, so the UI can label it. */
  mockMode: boolean;
}

export type QboPlanResult =
  | {
      ok: true;
      companyName: string;
      /** QBO company (realm) id from the connection row — the client passes
       *  it to the transform layer to realm-qualify imported externalIds. */
      realmId: string;
      chunks: QboSyncChunk[];
    }
  | { ok: false; reason: 'needs_reauth' }
  | { ok: false; reason: 'error'; message: string };

export type QboSyncChunkResult =
  | { ok: true; pnl: QboReport; bs: QboReport; coa?: QboAccount[] }
  | { ok: false; reason: 'needs_reauth' }
  | { ok: false; reason: 'error'; message: string };

export type QboSimpleResult = { ok: true } | { ok: false; reason: string };

// ─────────────────────────────────────────────
// Shared gating
// ─────────────────────────────────────────────

/** Same shared-demo guard as workspace-actions.ts: the public demo firm is
 *  blocked from every QBO write so a casual visitor can't wire (or unwire) a
 *  books feed on the shared sandbox. */
const DEMO_FIRM_ID = process.env.DEMO_FIRM_ID ?? '3f66a9a8-598b-441c-89e9-de190c60c9be';

/** Matches config.ts getQboEnv() mockMode without requiring the full QBO env
 *  (getQboEnv throws when secrets are unset — e.g. prod before the runbook
 *  steps — but status must stay viewable there). */
function qboMockFlag(): boolean {
  return process.env.FINSIGHT_QBO_MOCK === 'true';
}

type Gate = { ok: true; ctx: ActiveContext } | { ok: false; message: string };

/** Active context + workspace-in-firm + owner/admin + demo block. Billing is
 *  checked separately (sync requires 'full'; disconnect does not). */
async function gateManage(workspaceId: string): Promise<Gate> {
  const ctx = await resolveUserContext();
  if (ctx.state !== 'active') {
    return { ok: false, message: 'No active firm for the current user.' };
  }
  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return {
      ok: false,
      message: 'Only firm owners and admins can manage the QuickBooks connection.',
    };
  }
  if (ctx.firm.id === DEMO_FIRM_ID) {
    return {
      ok: false,
      message:
        'QuickBooks connections are disabled in the shared demo. Sign up to connect your own books.',
    };
  }
  const inFirm = await workspaceInFirm(workspaceId, ctx.firm.id);
  if (!inFirm.ok) return inFirm;
  return { ok: true, ctx };
}

/** RLS-scoped workspace fetch: a cross-firm (or nonexistent) id resolves to
 *  no row, and the firm_id equality is re-checked explicitly on top. */
async function workspaceInFirm(
  workspaceId: string,
  firmId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, firm_id')
    .eq('id', workspaceId)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data || data.firm_id !== firmId) {
    return { ok: false, message: 'Workspace not found in your firm.' };
  }
  return { ok: true };
}

function billingBlockedMessage(ctx: ActiveContext): string | null {
  if (ctx.access.level === 'full') return null;
  return ctx.access.level === 'read_only'
    ? 'Your workspace is read-only while payment is being resolved — QuickBooks sync is paused.'
    : 'Your account is locked. Restore billing to sync from QuickBooks.';
}

/** Shared entry for the sync-path actions: full manage gate + billing 'full'
 *  + a connection row must exist. */
async function gateSync(
  workspaceId: string
): Promise<
  | { ok: true; ctx: ActiveContext; connection: QboConnectionRow }
  | { ok: false; reason: 'needs_reauth' }
  | { ok: false; reason: 'error'; message: string }
> {
  const gate = await gateManage(workspaceId);
  if (!gate.ok) return { ok: false, reason: 'error', message: gate.message };
  const billingBlock = billingBlockedMessage(gate.ctx);
  if (billingBlock) return { ok: false, reason: 'error', message: billingBlock };

  let connection: QboConnectionRow | null;
  try {
    connection = await getConnectionForWorkspace(workspaceId);
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'Failed to load the QuickBooks connection.',
    };
  }
  if (!connection) {
    return { ok: false, reason: 'error', message: 'No QuickBooks connection for this workspace.' };
  }
  if (connection.status === 'needs_reauth' || connection.status === 'revoked') {
    return { ok: false, reason: 'needs_reauth' };
  }
  return { ok: true, ctx: gate.ctx, connection };
}

// ─────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────

/**
 * Connection status for the workspace, readable by every firm member
 * (read-only billing included). Reads via the AUTHENTICATED client: RLS
 * scopes the row to the caller's firm and the column-level grants make the
 * token columns structurally unreadable — hence the explicit non-token column
 * list. Any gating/read failure returns a disconnected, canManage:false
 * result (fail closed, reveal nothing).
 */
export async function getQboStatus(workspaceId: string): Promise<QboStatusResult> {
  const disconnected: QboStatusResult = {
    connected: false,
    companyName: null,
    realmId: null,
    status: null,
    lastSyncedAt: null,
    lastSyncError: null,
    canManage: false,
    mockMode: qboMockFlag(),
  };

  const ctx = await resolveUserContext();
  if (ctx.state !== 'active') return disconnected;

  const inFirm = await workspaceInFirm(workspaceId, ctx.firm.id);
  if (!inFirm.ok) return disconnected;

  const canManage =
    (ctx.role === 'owner' || ctx.role === 'admin') &&
    ctx.firm.id !== DEMO_FIRM_ID &&
    ctx.access.level === 'full';

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('qbo_connections')
    .select('company_name, realm_id, status, last_synced_at, last_sync_error')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) {
    console.error('getQboStatus read failed', error.message);
    return { ...disconnected, canManage };
  }
  if (!data) return { ...disconnected, canManage };

  const status =
    data.status === 'active' ||
    data.status === 'needs_reauth' ||
    data.status === 'revoked' ||
    data.status === 'error'
      ? data.status
      : null;

  return {
    connected: true,
    companyName: data.company_name,
    realmId: data.realm_id,
    status,
    lastSyncedAt: data.last_synced_at,
    lastSyncError: data.last_sync_error,
    canManage,
    mockMode: qboMockFlag(),
  };
}

/**
 * Verify the connection is alive (CompanyInfo round-trip with a fresh token)
 * and plan the backfill: calendar-year chunks from
 * (currentYear - yearsBack + 1) through currentYear (default 3 years back,
 * clamped 1..10); the current year's chunk ends at the last day of the
 * current month.
 */
export async function planQboSync(
  workspaceId: string,
  opts: { yearsBack?: number } = {}
): Promise<QboPlanResult> {
  const gate = await gateSync(workspaceId);
  if (!gate.ok) return gate;

  try {
    const info = await fetchCompanyInfo(buildApiContext(gate.connection));
    return {
      ok: true,
      companyName: info.CompanyName,
      realmId: gate.connection.realm_id,
      chunks: planSyncChunks(new Date(), opts.yearsBack),
    };
  } catch (err) {
    if (err instanceof QboReauthRequiredError) return { ok: false, reason: 'needs_reauth' };
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'Could not reach QuickBooks.',
    };
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fetch one calendar-year chunk: monthly P&L + Balance Sheet (accrual), plus
 * the full chart of accounts when includeCoa (the client requests it on
 * exactly one chunk per sync). Returns RAW QBO payloads — the client runs the
 * pure transform (transform.ts is client-importable by design) once over ALL
 * accumulated chunks, then commits via the existing diff/merge/review flow.
 * Failures mark the connection (markSyncResult) except reauth, which
 * getFreshAccessToken already recorded on the row.
 */
export async function runQboSyncChunk(
  workspaceId: string,
  chunk: { year: number; startDate: string; endDate: string },
  opts: { includeCoa: boolean }
): Promise<QboSyncChunkResult> {
  if (!ISO_DATE_RE.test(chunk.startDate) || !ISO_DATE_RE.test(chunk.endDate)) {
    return { ok: false, reason: 'error', message: 'Invalid chunk date range.' };
  }
  // Client dates are untrusted: reject inverted ranges and chunks spanning
  // calendar years — the sync contract is ONE calendar year per chunk (plan
  // §1 cell-cap / 504 guidance). Lexicographic compare is safe on YYYY-MM-DD.
  if (
    chunk.startDate > chunk.endDate ||
    chunk.startDate.slice(0, 4) !== chunk.endDate.slice(0, 4)
  ) {
    return { ok: false, reason: 'error', message: 'Invalid sync chunk range.' };
  }

  const gate = await gateSync(workspaceId);
  if (!gate.ok) return gate;

  const apiCtx = buildApiContext(gate.connection);
  const range = { startDate: chunk.startDate, endDate: chunk.endDate };
  try {
    // Serialized on purpose: Intuit throttles per-realm (parallelize across
    // companies, serialize within one — plan §1).
    const pnl = await fetchProfitAndLossMonthly(apiCtx, range);
    const bs = await fetchBalanceSheetMonthly(apiCtx, range);
    const coa = opts.includeCoa ? await fetchChartOfAccounts(apiCtx) : undefined;
    return coa ? { ok: true, pnl, bs, coa } : { ok: true, pnl, bs };
  } catch (err) {
    if (err instanceof QboReauthRequiredError) return { ok: false, reason: 'needs_reauth' };
    const message = err instanceof Error ? err.message : 'QuickBooks sync failed.';
    try {
      await markSyncResult(gate.connection.id, { ok: false, error: message });
    } catch (markErr) {
      console.error('markSyncResult(failure) failed', markErr);
    }
    return { ok: false, reason: 'error', message };
  }
}

/**
 * Stamp the sync as successful (last_synced_at, clear last_sync_error, back
 * to 'active'). Invoked by the client AFTER it commits the merged data — the
 * fetch alone doesn't count as a sync until the data actually lands.
 */
export async function completeQboSync(workspaceId: string): Promise<QboSimpleResult> {
  const gate = await gateSync(workspaceId);
  if (!gate.ok) {
    return {
      ok: false,
      reason: gate.reason === 'needs_reauth' ? 'needs_reauth' : gate.message,
    };
  }
  try {
    await markSyncResult(gate.connection.id, { ok: true });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'Failed to record the sync.',
    };
  }
}

/**
 * Disconnect the workspace's QBO company: best-effort token revocation at
 * Intuit, row deletion, audit trail. Owner/admin only; allowed at any billing
 * level (severing a data feed is never paywalled). Idempotent — already
 * disconnected returns ok.
 */
export async function disconnectQbo(workspaceId: string): Promise<QboSimpleResult> {
  const gate = await gateManage(workspaceId);
  if (!gate.ok) return { ok: false, reason: gate.message };

  try {
    const connection = await getConnectionForWorkspace(workspaceId);
    if (!connection) return { ok: true };
    await deleteConnection(connection.id, { revoke: true, actor: gate.ctx.userId });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'Failed to disconnect QuickBooks.',
    };
  }
}
