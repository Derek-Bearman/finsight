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
 * token family revoked (Intuit anti-replay). The concurrency mechanism is a
 * CAS claim on refresh_claimed_at: getFreshAccessToken must WIN the claim
 * (guarded UPDATE matching the exact refresh ciphertext read, where the claim
 * is NULL or stale >30 s) BEFORE it may call Intuit. The winner persists the
 * rotated pair with a second guarded UPDATE (`WHERE id = ? AND
 * refresh_token_enc = <the exact ciphertext we read>`) that clears the claim
 * in the same write, and clears the claim best-effort on every error path.
 * Losers NEVER call Intuit — they poll briefly for the winner's fresh token,
 * retry a gone-stale claim once, and otherwise throw the retryable
 * QboRefreshInProgressError.
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

/** A concurrent invocation holds the refresh claim and didn't finish inside
 *  the poll budget. Transient by construction — safe (and expected) for the
 *  caller to retry the whole operation a few seconds later. */
export class QboRefreshInProgressError extends Error {
  constructor(
    message = 'A QuickBooks token refresh is already in progress — retry in a few seconds.'
  ) {
    super(message);
    this.name = 'QboRefreshInProgressError';
  }
}

/** unique(firm_id, realm_id) violation on connect: the QBO company is already
 *  connected to ANOTHER workspace in this firm (plan §2.1 — one company per
 *  workspace). The callback pre-checks before the code exchange; this typed
 *  error covers the residual race so it maps to ?qbo_error=realm_in_use
 *  instead of crashing as a generic failure. */
export class QboRealmInUseError extends Error {
  constructor(
    message = 'This QuickBooks company is already connected to another workspace in your firm.'
  ) {
    super(message);
    this.name = 'QboRealmInUseError';
  }
}

/** invalid_grant-shaped refresh failure: Intuit answers HTTP 400 with an
 *  `invalid_grant` error body when the refresh token is expired, rotated
 *  away, or revoked. Anything else (401 invalid_client = operator misconfig,
 *  5xx = transient) is NOT a reauth signal. Exported for the check suite. */
export function isInvalidGrantError(err: unknown): boolean {
  return err instanceof QboOAuthError && err.status === 400 && err.body.includes('invalid_grant');
}

/** Postgres unique violation (SQLSTATE 23505) as surfaced by PostgREST /
 *  supabase-js (`error.code`). Exported for the check suite. */
export function isUniqueViolationError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
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

/** A refresh claim older than this is treated as abandoned (winner crashed
 *  mid-refresh) and may be taken over. Comfortably above Intuit's token
 *  endpoint latency, comfortably below anything a user would notice. */
export const REFRESH_CLAIM_STALE_MS = 30_000;

/** Loser-path poll bounds: ~5 × 1 s waiting for the claim winner to land its
 *  rotated pair before giving up with QboRefreshInProgressError. */
export const REFRESH_CLAIM_POLL_ATTEMPTS = 5;
export const REFRESH_CLAIM_POLL_INTERVAL_MS = 1_000;

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
  /**
   * The refresh CAS claim: UPDATE ... SET refresh_claimed_at = claimedAtIso
   * WHERE id = ? AND refresh_token_enc = expected AND (refresh_claimed_at IS
   * NULL OR refresh_claimed_at < staleBeforeIso). Returns rows matched
   * (1 = claim won and Intuit may be called; 0 = a live claim is held
   * elsewhere, or the ciphertext moved).
   */
  claimRefresh(
    id: string,
    expectedRefreshTokenEnc: string,
    claimedAtIso: string,
    staleBeforeIso: string
  ): Promise<number>;
  /** Clear a claim WE set (guarded on the exact claimedAtIso so a takeover's
   *  newer claim is never stomped) — winner error paths use this so a failed
   *  refresh can't wedge the connection for the full staleness window. */
  clearRefreshClaim(id: string, claimedAtIso: string): Promise<void>;
  delete(id: string): Promise<void>;
  insertAudit(row: AuditLogInsert): Promise<void>;
}

export interface QboConnectionsDeps {
  db: QboConnectionsDb;
  env: QboEnv;
  /** Clock, injectable for freshness-window checks. */
  now: () => number;
  /** Wait between claim-loser polls; injectable so checks run instantly.
   *  Optional — defaults to a real setTimeout wait. */
  sleep?: (ms: number) => Promise<void>;
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
    async claimRefresh(id, expectedRefreshTokenEnc, claimedAtIso, staleBeforeIso) {
      // NULL-or-stale expressed as a PostgREST or-filter. The lt value is
      // double-quoted per PostgREST syntax; toISOString() never emits the
      // reserved characters (comma / parens / quotes), so no further escaping
      // is needed. `.select('id')` exposes the 0-vs-1 matched count.
      const { data, error } = await service
        .from('qbo_connections')
        .update({ refresh_claimed_at: claimedAtIso })
        .eq('id', id)
        .eq('refresh_token_enc', expectedRefreshTokenEnc)
        .or(`refresh_claimed_at.is.null,refresh_claimed_at.lt."${staleBeforeIso}"`)
        .select('id');
      if (error) throw error;
      return (data ?? []).length;
    },
    async clearRefreshClaim(id, claimedAtIso) {
      const { error } = await service
        .from('qbo_connections')
        .update({ refresh_claimed_at: null })
        .eq('id', id)
        .eq('refresh_claimed_at', claimedAtIso);
      if (error) throw error;
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

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultDeps(): QboConnectionsDeps {
  return {
    db: createQboConnectionsDb(),
    env: getQboEnv(),
    now: Date.now,
    sleep: defaultSleep,
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
 * inserts fresh; the same realm just updates tokens/company_name/connected_by
 * (persisted — migration v2 un-pinned connected_by, so the reconnecting admin
 * becomes the recorded connector) and returns the row to 'active', clearing
 * any stale sync error AND any leftover refresh claim. An insert that hits
 * unique(firm_id, realm_id) — the company is already wired to another
 * workspace in the firm; the callback pre-checks, this covers the residual
 * race — throws the typed QboRealmInUseError. Writes a 'qbo.connect' audit
 * row on success.
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
      refresh_claimed_at: null,
    });
  } else {
    try {
      await db.insert({
        firm_id: params.firmId,
        workspace_id: params.workspaceId,
        realm_id: params.realmId,
        company_name: params.companyName,
        status: 'active',
        connected_by: params.connectedBy,
        ...tokenColumns,
      });
    } catch (err) {
      if (isUniqueViolationError(err)) throw new QboRealmInUseError();
      throw err;
    }
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
 * when the stored one expires within 2 minutes.
 *
 * Concurrency (plan §1: two concurrent refreshes for one realm can get the
 * whole token family revoked): an invocation must WIN the refresh_claimed_at
 * CAS claim (guarded on the exact refresh ciphertext read + claim
 * NULL-or-stale) before it may call Intuit. The winner persists the rotated
 * pair via the ciphertext-guarded UPDATE, clearing the claim in the same
 * write, and clears the claim best-effort on every error path. Losers never
 * call Intuit — they poll (bounded ~5 × 1 s) for the winner's fresh token,
 * retry a gone-stale claim once, and otherwise throw the retryable
 * QboRefreshInProgressError.
 *
 * `forceRefresh` (the api layer's onUnauthorized) skips the freshness
 * shortcut for tokens Intuit rejected despite an unexpired clock; its loser
 * path additionally requires the stored ciphertext to have CHANGED so it can
 * never hand back the very token Intuit just rejected. invalid_grant →
 * needs_reauth is written through the SAME ciphertext guard, so a stale
 * loser's invalid_grant can never mark a healthy connection needs_reauth.
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

  // CAS claim: only the winner may call Intuit. Guarded on the EXACT
  // ciphertext we read, taking over a claim only when it's NULL or stale.
  const claimedAtIso = new Date(deps.now()).toISOString();
  const won = await db.claimRefresh(
    row.id,
    row.refresh_token_enc,
    claimedAtIso,
    new Date(deps.now() - REFRESH_CLAIM_STALE_MS).toISOString()
  );
  if (won > 0) {
    return performClaimedRefresh(row, row.refresh_token_enc, claimedAtIso, deps);
  }
  return awaitConcurrentRefresh(row, opts, deps);
}

/**
 * Claim-winner path — the ONLY code that calls Intuit's token refresh.
 * Persists the rotated pair through the ciphertext-guarded UPDATE (clearing
 * the claim in the same write); every error path clears the claim
 * best-effort so a failed winner never wedges refreshes for the full 30-s
 * staleness window.
 */
async function performClaimedRefresh(
  row: QboConnectionRow,
  readRefreshEnc: string,
  claimedAtIso: string,
  deps: QboConnectionsDeps
): Promise<{ accessToken: string; realmId: string }> {
  const { db, env } = deps;
  const clearClaim = async (): Promise<void> => {
    try {
      await db.clearRefreshClaim(row.id, claimedAtIso);
    } catch (err) {
      console.error('qbo refresh claim clear failed', err);
    }
  };

  let refreshToken: string;
  try {
    refreshToken = await decryptSecret(readRefreshEnc, env.tokenKey);
  } catch (err) {
    await clearClaim();
    throw err;
  }

  let rotated: QboTokenSet;
  try {
    rotated = await deps.refresh(env, { refreshToken });
  } catch (err) {
    if (isInvalidGrantError(err)) {
      // needs_reauth is written through the SAME ciphertext guard: if the
      // stored pair moved while we held the claim (our claim went stale and a
      // takeover rotated first), this invalid_grant is stale evidence and
      // must NOT poison the healthy connection.
      let marked: number;
      try {
        marked = await db.updateTokensGuarded(row.id, readRefreshEnc, {
          status: 'needs_reauth',
          last_sync_error: 'QuickBooks authorization expired — reconnect required.',
          refresh_claimed_at: null,
        });
      } catch (dbErr) {
        await clearClaim();
        throw dbErr;
      }
      if (marked > 0) throw new QboReauthRequiredError();
      await clearClaim();
      return readWinnerTokens(row.id, deps);
    }
    await clearClaim();
    throw err;
  }

  let matched: number;
  try {
    const patch = await encryptTokenColumns(rotated, env);
    matched = await db.updateTokensGuarded(row.id, readRefreshEnc, {
      ...patch,
      refresh_claimed_at: null,
    });
  } catch (err) {
    await clearClaim();
    throw err;
  }

  if (matched === 0) {
    // Ciphertext moved while we held the claim (stale-claim takeover): the
    // concurrent winner's pair is the live one; ours must not be persisted.
    await clearClaim();
    return readWinnerTokens(row.id, deps);
  }

  return { accessToken: rotated.accessToken, realmId: row.realm_id };
}

/** After losing a ciphertext-guarded write: re-read and use the concurrent
 *  winner's tokens — NEVER refresh again (plan §1 token-family warning). */
async function readWinnerTokens(
  connectionId: string,
  deps: QboConnectionsDeps
): Promise<{ accessToken: string; realmId: string }> {
  const winner = await deps.db.getById(connectionId);
  if (!winner) throw new Error(`QBO connection ${connectionId} disappeared mid-refresh.`);
  if (winner.status === 'needs_reauth' || winner.status === 'revoked' || !winner.access_token_enc) {
    throw new QboReauthRequiredError();
  }
  return {
    accessToken: await decryptSecret(winner.access_token_enc, deps.env.tokenKey),
    realmId: winner.realm_id,
  };
}

/**
 * Claim-loser path — NEVER calls Intuit. Polls (bounded) for the winner's
 * fresh token; a claim that turns out stale mid-poll is retried ONCE (the
 * winner may have crashed, or cleared its claim on an error path without
 * producing a token); a still-busy row after the poll budget throws the
 * retryable QboRefreshInProgressError.
 */
async function awaitConcurrentRefresh(
  initial: QboConnectionRow,
  opts: { forceRefresh?: boolean },
  deps: QboConnectionsDeps
): Promise<{ accessToken: string; realmId: string }> {
  const { db, env } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  let claimRetried = false;

  for (let attempt = 0; attempt < REFRESH_CLAIM_POLL_ATTEMPTS; attempt++) {
    await sleep(REFRESH_CLAIM_POLL_INTERVAL_MS);

    const current = await db.getById(initial.id);
    if (!current) throw new Error(`QBO connection ${initial.id} disappeared mid-refresh.`);
    if (current.status === 'needs_reauth' || current.status === 'revoked') {
      throw new QboReauthRequiredError();
    }

    // Winner finished: a fresh token is on the row. Under forceRefresh the
    // caller just had THIS row's token rejected by Intuit, so additionally
    // require the stored ciphertext to have changed before handing it back.
    if (
      current.access_token_enc &&
      isAccessTokenFresh(current.access_token_expires_at, deps.now()) &&
      (!opts.forceRefresh || current.access_token_enc !== initial.access_token_enc)
    ) {
      return {
        accessToken: await decryptSecret(current.access_token_enc, env.tokenKey),
        realmId: current.realm_id,
      };
    }

    const claimedMs = current.refresh_claimed_at ? Date.parse(current.refresh_claimed_at) : NaN;
    const claimIsStale =
      Number.isNaN(claimedMs) || deps.now() - claimedMs >= REFRESH_CLAIM_STALE_MS;
    if (claimIsStale && !claimRetried && current.refresh_token_enc) {
      claimRetried = true;
      const retryClaimedAtIso = new Date(deps.now()).toISOString();
      const reWon = await db.claimRefresh(
        current.id,
        current.refresh_token_enc,
        retryClaimedAtIso,
        new Date(deps.now() - REFRESH_CLAIM_STALE_MS).toISOString()
      );
      if (reWon > 0) {
        return performClaimedRefresh(current, current.refresh_token_enc, retryClaimedAtIso, deps);
      }
    }
  }

  throw new QboRefreshInProgressError();
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
