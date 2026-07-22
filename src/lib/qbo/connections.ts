/**
 * QBO connection store — SERVER-ONLY, service-role. The single home for
 * qbo_connections reads/writes: token encrypt/decrypt happens at this edge
 * (AES-256-GCM via qbo/crypto.ts, key QBO_TOKEN_KEY), so nothing above this
 * module ever sees a plaintext token except the access token handed to the
 * data-API layer.
 *
 * Token-rotation safety (plan §1 "Tokens" — the #1 place QBO integrations
 * die): any refresh response may carry a NEW refresh_token and the old one
 * silently dies; two concurrent refreshes for one realm can get the whole
 * token family revoked. getFreshAccessToken therefore persists the rotated
 * pair with a guarded UPDATE (`WHERE id = ? AND refresh_token_enc = <the
 * exact ciphertext we read>`); when 0 rows match, another request refreshed
 * concurrently and won — we re-read the row and use ITS tokens instead of
 * refreshing again.
 *
 * Testability: every function takes an optional `deps` bundle
 * (QboConnectionsDeps — a narrow DB interface + env + clock + oauth fns) so
 * the check suite runs the full decision logic against fakes with zero DB or
 * network. The default deps are built lazily from the real service client and
 * getQboEnv(); the factory (createQboConnectionsDb) is deliberately thin.
 */

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { Tables, TablesInsert, TablesUpdate } from '@/lib/supabase/database.types';
import { getQboEnv, qboApiBaseUrl, type QboEnv } from './config';
import { decryptSecret, encryptSecret } from './crypto';
import { QboOAuthError, refreshTokens, revokeToken, type QboTokenSet } from './oauth';
import type { QboApiContext } from './api';

// Dependency-free server-only guard (house pattern; this module handles secrets).
if (typeof window !== 'undefined') {
  throw new Error('qbo/connections.ts is server-only and must never reach the browser.');
}

export type QboConnectionRow = Tables<'qbo_connections'>;
export type QboConnectionInsert = TablesInsert<'qbo_connections'>;
export type QboConnectionUpdate = TablesUpdate<'qbo_connections'>;
type AuditLogInsert = TablesInsert<'audit_log'>;

// ─────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────

/** The stored grant is dead (invalid_grant on refresh, or the row is already
 *  marked needs_reauth/revoked). No programmatic recovery exists — the user
 *  must redo consent via /api/qbo/connect. Callers surface reauth UX. */
export class QboReauthRequiredError extends Error {
  constructor(message = 'QuickBooks authorization expired — the connection must be re-authorized.') {
    super(message);
    this.name = 'QboReauthRequiredError';
  }
}

/** invalid_grant-shaped refresh failure: Intuit answers HTTP 400 with an
 *  `invalid_grant` error body when the refresh token is expired, rotated
 *  away, or revoked. Anything else (401 invalid_client = operator misconfig,
 *  5xx = transient) is NOT a reauth signal. Exported for the check suite. */
export function isInvalidGrantError(err: unknown): boolean {
  return err instanceof QboOAuthError && err.status === 400 && err.body.includes('invalid_grant');
}

// ─────────────────────────────────────────────
// Pure decision helpers (exported for checks)
// ─────────────────────────────────────────────

/** Access tokens within 2 minutes of expiry are treated as stale so a token
 *  can't die mid report pull (a year chunk is several sequential calls). */
export const ACCESS_TOKEN_FRESHNESS_WINDOW_MS = 2 * 60_000;

/** True when the access token expires MORE than 2 minutes from `nowMs`.
 *  A missing/unparseable expiry is stale (fail toward refreshing). */
export function isAccessTokenFresh(expiresAt: string | null, nowMs: number): boolean {
  if (!expiresAt) return false;
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs - nowMs > ACCESS_TOKEN_FRESHNESS_WINDOW_MS;
}

/** Next `status` after a sync attempt: needs_reauth/revoked are sticky (only
 *  a successful reconnect clears them); otherwise ok → 'active', fail →
 *  'error'. */
export function resolveSyncStatus(current: string, ok: boolean): string {
  if (current === 'needs_reauth' || current === 'revoked') return current;
  return ok ? 'active' : 'error';
}

// ─────────────────────────────────────────────
// Injectable dependencies
// ─────────────────────────────────────────────

/** The narrow slice of the service-role client this module needs. The check
 *  suite implements it with in-memory fakes. */
export interface QboConnectionsDb {
  getByWorkspace(workspaceId: string): Promise<QboConnectionRow | null>;
  getById(id: string): Promise<QboConnectionRow | null>;
  insert(row: QboConnectionInsert): Promise<void>;
  update(id: string, patch: QboConnectionUpdate): Promise<void>;
  /**
   * The rotation-safe persist: UPDATE ... WHERE id = ? AND refresh_token_enc
   * = expected. Returns the number of rows matched (0 = a concurrent refresh
   * already rotated the pair).
   */
  updateTokensGuarded(
    id: string,
    expectedRefreshTokenEnc: string,
    patch: QboConnectionUpdate
  ): Promise<number>;
  delete(id: string): Promise<void>;
  insertAudit(row: AuditLogInsert): Promise<void>;
}

export interface QboConnectionsDeps {
  db: QboConnectionsDb;
  env: QboEnv;
  /** Clock, injectable for freshness-window checks. */
  now: () => number;
  refresh: (env: QboEnv, params: { refreshToken: string }) => Promise<QboTokenSet>;
  revoke: (env: QboEnv, params: { token: string }) => Promise<void>;
}

/** Thin service-client adapter — no logic beyond error propagation. */
export function createQboConnectionsDb(
  service: ReturnType<typeof createSupabaseServiceClient> = createSupabaseServiceClient()
): QboConnectionsDb {
  return {
    async getByWorkspace(workspaceId) {
      const { data, error } = await service
        .from('qbo_connections')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async getById(id) {
      const { data, error } = await service
        .from('qbo_connections')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async insert(row) {
      const { error } = await service.from('qbo_connections').insert(row);
      if (error) throw error;
    },
    async update(id, patch) {
      const { error } = await service.from('qbo_connections').update(patch).eq('id', id);
      if (error) throw error;
    },
    async updateTokensGuarded(id, expectedRefreshTokenEnc, patch) {
      // `.select('id')` makes PostgREST return the matched rows so 0-vs-1 is
      // observable — that count IS the concurrency guard.
      const { data, error } = await service
        .from('qbo_connections')
        .update(patch)
        .eq('id', id)
        .eq('refresh_token_enc', expectedRefreshTokenEnc)
        .select('id');
      if (error) throw error;
      return (data ?? []).length;
    },
    async delete(id) {
      const { error } = await service.from('qbo_connections').delete().eq('id', id);
      if (error) throw error;
    },
    async insertAudit(row) {
      const { error } = await service.from('audit_log').insert(row);
      if (error) throw error;
    },
  };
}

function defaultDeps(): QboConnectionsDeps {
  return {
    db: createQboConnectionsDb(),
    env: getQboEnv(),
    now: Date.now,
    refresh: refreshTokens,
    revoke: revokeToken,
  };
}

/** Audit writes are best-effort: an audit hiccup must never fail (or roll
 *  back the caller's view of) a connect/disconnect that already happened. */
async function auditBestEffort(db: QboConnectionsDb, row: AuditLogInsert): Promise<void> {
  try {
    await db.insertAudit(row);
  } catch (err) {
    console.error('qbo audit_log write failed', row.action, err);
  }
}

async function encryptTokenColumns(
  tokens: QboTokenSet,
  env: QboEnv
): Promise<
  Pick<
    QboConnectionUpdate,
    | 'access_token_enc'
    | 'access_token_expires_at'
    | 'refresh_token_enc'
    | 'refresh_token_expires_at'
    | 'refresh_token_hard_expires_at'
  >
> {
  return {
    access_token_enc: await encryptSecret(tokens.accessToken, env.tokenKey),
    access_token_expires_at: tokens.accessTokenExpiresAt,
    refresh_token_enc: await encryptSecret(tokens.refreshToken, env.tokenKey),
    refresh_token_expires_at: tokens.refreshTokenExpiresAt,
    refresh_token_hard_expires_at: tokens.refreshTokenHardExpiresAt,
  };
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export async function getConnectionForWorkspace(
  workspaceId: string,
  deps: QboConnectionsDeps = defaultDeps()
): Promise<QboConnectionRow | null> {
  return deps.db.getByWorkspace(workspaceId);
}

export interface UpsertConnectionParams {
  firmId: string;
  workspaceId: string;
  realmId: string;
  companyName: string;
  tokens: QboTokenSet;
  /** Auth user id that completed the OAuth flow (audit actor). */
  connectedBy: string;
}

/**
 * Store a freshly-authorized connection. realm_id is trigger-pinned immutable,
 * so a workspace re-connecting to a DIFFERENT company deletes the old row and
 * inserts fresh; the same realm just updates tokens/company_name and returns
 * the row to 'active' (clearing any stale sync error). Writes a 'qbo.connect'
 * audit row either way.
 */
export async function upsertConnection(
  params: UpsertConnectionParams,
  deps: QboConnectionsDeps = defaultDeps()
): Promise<void> {
  const { db, env } = deps;
  const tokenColumns = await encryptTokenColumns(params.tokens, env);

  const existing = await db.getByWorkspace(params.workspaceId);
  if (existing && existing.realm_id !== params.realmId) {
    await db.delete(existing.id);
  }

  if (existing && existing.realm_id === params.realmId) {
    await db.update(existing.id, {
      ...tokenColumns,
      company_name: params.companyName,
      status: 'active',
      last_sync_error: null,
      connected_by: params.connectedBy,
    });
  } else {
    await db.insert({
      firm_id: params.firmId,
      workspace_id: params.workspaceId,
      realm_id: params.realmId,
      company_name: params.companyName,
      status: 'active',
      connected_by: params.connectedBy,
      ...tokenColumns,
    });
  }

  await auditBestEffort(db, {
    firm_id: params.firmId,
    action: 'qbo.connect',
    actor_user_id: params.connectedBy,
    target: params.workspaceId,
    metadata: { realmId: params.realmId, companyName: params.companyName },
  });
}

/**
 * Return a usable access token (and the realm) for a connection, refreshing
 * when the stored one expires within 2 minutes. Refresh persists the ROTATED
 * pair via the guarded UPDATE; on a lost race the concurrent winner's tokens
 * are re-read and used (never a second refresh — plan §1 token-family
 * warning). `forceRefresh` (used by the api layer's onUnauthorized) skips the
 * freshness shortcut for tokens Intuit rejected despite an unexpired clock.
 * invalid_grant → row marked needs_reauth + QboReauthRequiredError.
 */
export async function getFreshAccessToken(
  connectionId: string,
  opts: { forceRefresh?: boolean } = {},
  deps: QboConnectionsDeps = defaultDeps()
): Promise<{ accessToken: string; realmId: string }> {
  const { db, env } = deps;
  const row = await db.getById(connectionId);
  if (!row) throw new Error(`QBO connection ${connectionId} not found.`);
  if (row.status === 'needs_reauth' || row.status === 'revoked') {
    throw new QboReauthRequiredError();
  }

  if (
    !opts.forceRefresh &&
    row.access_token_enc &&
    isAccessTokenFresh(row.access_token_expires_at, deps.now())
  ) {
    return {
      accessToken: await decryptSecret(row.access_token_enc, env.tokenKey),
      realmId: row.realm_id,
    };
  }

  if (!row.refresh_token_enc) {
    await db.update(row.id, {
      status: 'needs_reauth',
      last_sync_error: 'No stored refresh token — reconnect QuickBooks.',
    });
    throw new QboReauthRequiredError();
  }

  // The EXACT ciphertext we read — the guarded UPDATE below matches on it.
  const readRefreshEnc = row.refresh_token_enc;
  const refreshToken = await decryptSecret(readRefreshEnc, env.tokenKey);

  let rotated: QboTokenSet;
  try {
    rotated = await deps.refresh(env, { refreshToken });
  } catch (err) {
    if (isInvalidGrantError(err)) {
      await db.update(row.id, {
        status: 'needs_reauth',
        last_sync_error: 'QuickBooks authorization expired — reconnect required.',
      });
      throw new QboReauthRequiredError();
    }
    throw err;
  }

  const patch = await encryptTokenColumns(rotated, env);
  const matched = await db.updateTokensGuarded(row.id, readRefreshEnc, patch);

  if (matched === 0) {
    // A concurrent request refreshed first and its pair is the live one; ours
    // must not be persisted OR refreshed again. Re-read and use the winner's.
    const winner = await db.getById(row.id);
    if (!winner) throw new Error(`QBO connection ${connectionId} disappeared mid-refresh.`);
    if (winner.status === 'needs_reauth' || winner.status === 'revoked' || !winner.access_token_enc) {
      throw new QboReauthRequiredError();
    }
    return {
      accessToken: await decryptSecret(winner.access_token_enc, env.tokenKey),
      realmId: winner.realm_id,
    };
  }

  return { accessToken: rotated.accessToken, realmId: row.realm_id };
}

/**
 * Record a sync outcome. Success stamps last_synced_at and clears
 * last_sync_error; failure stores the error. Status follows
 * resolveSyncStatus: 'error' on failure / 'active' on success, but
 * needs_reauth (and revoked) are sticky. Missing row → no-op (a disconnect
 * can race the end of a sync).
 */
export async function markSyncResult(
  connectionId: string,
  result: { ok: boolean; error?: string },
  deps: QboConnectionsDeps = defaultDeps()
): Promise<void> {
  const { db } = deps;
  const row = await db.getById(connectionId);
  if (!row) return;

  const status = resolveSyncStatus(row.status, result.ok);
  if (result.ok) {
    await db.update(row.id, {
      status,
      last_synced_at: new Date(deps.now()).toISOString(),
      last_sync_error: null,
    });
  } else {
    await db.update(row.id, {
      status,
      last_sync_error: result.error ?? 'Sync failed.',
    });
  }
}

/**
 * Delete a connection, optionally revoking the grant at Intuit first
 * (best-effort: revocation failure is recorded in the audit metadata but
 * never blocks the delete — the user asked to disconnect, so disconnect).
 * Writes a 'qbo.disconnect' audit row. Missing row → no-op.
 */
export async function deleteConnection(
  connectionId: string,
  opts: { revoke: boolean; actor: string },
  deps: QboConnectionsDeps = defaultDeps()
): Promise<void> {
  const { db, env } = deps;
  const row = await db.getById(connectionId);
  if (!row) return;

  let revoked = false;
  let revokeError: string | undefined;
  if (opts.revoke && row.refresh_token_enc) {
    try {
      const refreshToken = await decryptSecret(row.refresh_token_enc, env.tokenKey);
      await deps.revoke(env, { token: refreshToken });
      revoked = true;
    } catch (err) {
      revokeError = err instanceof Error ? err.message : String(err);
    }
  }

  await db.delete(row.id);

  await auditBestEffort(db, {
    firm_id: row.firm_id,
    action: 'qbo.disconnect',
    actor_user_id: opts.actor,
    target: row.workspace_id,
    metadata: {
      realmId: row.realm_id,
      revoked,
      ...(revokeError !== undefined ? { revokeError } : {}),
    },
  });
}

/**
 * Wire a stored connection into the data-API layer: token acquisition (and
 * the 401 retry path) route through getFreshAccessToken, so rotation safety
 * and needs_reauth classification apply to every report pull.
 */
export function buildApiContext(
  connection: QboConnectionRow,
  deps: QboConnectionsDeps = defaultDeps()
): QboApiContext {
  return {
    baseUrl: qboApiBaseUrl(deps.env),
    realmId: connection.realm_id,
    getAccessToken: async () => (await getFreshAccessToken(connection.id, {}, deps)).accessToken,
    onUnauthorized: async () =>
      (await getFreshAccessToken(connection.id, { forceRefresh: true }, deps)).accessToken,
  };
}
