/**
 * QBO server-layer checks (connections store + sync planning + mock Intuit),
 * runnable headless:
 *   npx tsx scripts/checks/qbo-server.check.ts
 *
 * Covers the pure/injectable parts — no DB, no Next runtime:
 *  - token-freshness decision logic (2-minute window, boundary, null expiry)
 *  - getFreshAccessToken flows against a fake QboConnectionsDb: fresh
 *    shortcut, the refresh CAS CLAIM (claim won → exactly one Intuit call
 *    with the claim cleared in the persisted patch; claim lost → NO Intuit
 *    call, poll for the winner's fresh token; stale claim → retried exactly
 *    once; poll budget exhausted → retryable QboRefreshInProgressError),
 *    guarded rotated-pair persist (0 rows matched → re-read, use the
 *    winner's tokens, never refresh twice), forceRefresh (loser path refuses
 *    the unchanged ciphertext Intuit just rejected), needs_reauth
 *    classification on invalid_grant INCLUDING the ciphertext-moved case
 *    where the guarded needs_reauth write is skipped
 *  - claimRefresh / clearRefreshClaim adapter: the PostgREST filter chain
 *    (update/eq/eq/or NULL-or-stale/select) built against a recording fake
 *    supabase client
 *  - upsertConnection: same-realm update vs different-realm delete+insert
 *    (realm_id is trigger-pinned immutable; connected_by IS rewritten and
 *    persists — migration v2 un-pinned it), refresh-claim reset on
 *    reconnect, unique-violation → typed QboRealmInUseError, audit rows
 *  - runQboSyncChunk client-date validation matrix (bad ISO, inverted range,
 *    cross-year range rejected; valid same-year ranges pass through)
 *  - markSyncResult / resolveSyncStatus (needs_reauth stickiness)
 *  - deleteConnection best-effort revocation
 *  - chunk planning math (year boundaries, current-month end, leap years,
 *    yearsBack clamp 1..10)
 *  - mock Intuit: stateless token-rotation counter, invalid grants, fixture
 *    picking by year, empty NoReportData envelope, authorize-page exact
 *    state echo, prod-safety gate
 *
 * State/nonce SINGLE-USE expectations (enforced by the routes, documented
 * here because routes need the Next runtime):
 *  - /api/qbo/connect 302s any non-canonical origin (workers.dev alias) to
 *    the canonical env.redirectOrigin FIRST, then sets the nonce in an
 *    httpOnly SameSite=Lax cookie scoped to path /api/qbo (maxAge 600 —
 *    matches the state's 10-min exp) — host-scoped cookie and registered
 *    redirect URI therefore always share one origin;
 *  - /api/qbo/callback consumes the nonce ATOMICALLY (insert-once into
 *    service-only qbo_oauth_nonces) right before the code exchange: a
 *    double-fired callback hits the 23505 unique violation and exits as an
 *    idempotent ?qbo=connected WITHOUT a second exchange (a duplicate
 *    exchange would invalidate the first's tokens);
 *  - the cookie === state.n check + clear-on-every-exit stays as
 *    defense-in-depth, and the firm's unique(firm_id, realm_id) is
 *    pre-checked BEFORE the exchange so a doomed connect can't burn the
 *    single-use code (?qbo_error=realm_in_use).
 */

import {
  ACCESS_TOKEN_FRESHNESS_WINDOW_MS,
  buildApiContext,
  createQboConnectionsDb,
  deleteConnection,
  getConnectionForWorkspace,
  getFreshAccessToken,
  isAccessTokenFresh,
  isInvalidGrantError,
  isUniqueViolationError,
  markSyncResult,
  QboRealmInUseError,
  QboReauthRequiredError,
  QboRefreshInProgressError,
  REFRESH_CLAIM_POLL_ATTEMPTS,
  REFRESH_CLAIM_STALE_MS,
  resolveSyncStatus,
  upsertConnection,
  type QboConnectionRow,
  type QboConnectionUpdate,
  type QboConnectionsDb,
  type QboConnectionsDeps,
} from '../../src/lib/qbo/connections';
import { runQboSyncChunk } from '../../src/lib/data/qbo-actions';
import { decryptSecret, encryptSecret, generateKeyBase64 } from '../../src/lib/qbo/crypto';
import { QboOAuthError, type QboTokenSet } from '../../src/lib/qbo/oauth';
import type { QboEnv } from '../../src/lib/qbo/config';
import {
  clampYearsBack,
  lastDayOfMonth,
  planSyncChunks,
  QBO_SYNC_YEARS_BACK_DEFAULT,
  QBO_SYNC_YEARS_BACK_MAX,
} from '../../src/lib/qbo/sync';
import {
  authorizePageHtml,
  emptyReportEnvelope,
  isMockEnabled,
  mintTokensFromCode,
  MOCK_COMPANIES,
  mockCompanyName,
  pickReportFixture,
  rotateTokens,
} from '../../src/lib/qbo/mock-data';
import { buildState, makeNonce, verifyState } from '../../src/lib/qbo/state';
import type { TablesInsert } from '../../src/lib/supabase/database.types';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

async function checkThrows(
  fn: () => Promise<unknown>,
  label: string,
  inspect?: (err: unknown) => void
): Promise<void> {
  try {
    await fn();
    failures++;
    console.error(`FAIL: ${label} (did not throw)`);
  } catch (err) {
    inspect?.(err);
  }
}

// ─────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────

const TOKEN_KEY = generateKeyBase64();
const NOW = Date.parse('2026-07-22T12:00:00.000Z');

const env: QboEnv = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tokenKey: TOKEN_KEY,
  stateSecret: 'test-state-secret',
  redirectOrigin: 'https://finsight.example.com',
  mockMode: false,
  apiEnvironment: 'production',
};

type AuditInsert = TablesInsert<'audit_log'>;

interface DbLog {
  updates: Array<{ id: string; patch: QboConnectionUpdate }>;
  guarded: Array<{ id: string; expected: string; patch: QboConnectionUpdate }>;
  claims: Array<{ id: string; expected: string; claimedAtIso: string; staleBeforeIso: string }>;
  claimClears: Array<{ id: string; claimedAtIso: string }>;
  inserts: Array<Record<string, unknown>>;
  deletes: string[];
  audits: AuditInsert[];
}

/** Fake QboConnectionsDb: unexpected calls throw; the log records everything.
 *  claimRefresh defaults to WINNING the claim (single-caller scenarios). */
function fakeDb(handlers: Partial<QboConnectionsDb>): { db: QboConnectionsDb; log: DbLog } {
  const log: DbLog = {
    updates: [],
    guarded: [],
    claims: [],
    claimClears: [],
    inserts: [],
    deletes: [],
    audits: [],
  };
  const unexpected = (name: string) => async (): Promise<never> => {
    throw new Error(`unexpected db.${name} call`);
  };
  const db: QboConnectionsDb = {
    getByWorkspace: handlers.getByWorkspace ?? unexpected('getByWorkspace'),
    getById: handlers.getById ?? unexpected('getById'),
    insert:
      handlers.insert ??
      (async (row) => {
        log.inserts.push(row as unknown as Record<string, unknown>);
      }),
    update:
      handlers.update ??
      (async (id, patch) => {
        log.updates.push({ id, patch });
      }),
    updateTokensGuarded:
      handlers.updateTokensGuarded ??
      (async () => {
        throw new Error('unexpected db.updateTokensGuarded call');
      }),
    claimRefresh:
      handlers.claimRefresh ??
      (async (id, expected, claimedAtIso, staleBeforeIso) => {
        log.claims.push({ id, expected, claimedAtIso, staleBeforeIso });
        return 1;
      }),
    clearRefreshClaim:
      handlers.clearRefreshClaim ??
      (async (id, claimedAtIso) => {
        log.claimClears.push({ id, claimedAtIso });
      }),
    delete:
      handlers.delete ??
      (async (id) => {
        log.deletes.push(id);
      }),
    insertAudit:
      handlers.insertAudit ??
      (async (row) => {
        log.audits.push(row);
      }),
  };
  return { db, log };
}

function makeDeps(
  db: QboConnectionsDb,
  overrides: Partial<Omit<QboConnectionsDeps, 'db'>> = {}
): QboConnectionsDeps {
  return {
    db,
    env,
    now: () => NOW,
    sleep: async () => {}, // instant polls; tests that count sleeps override
    refresh: async () => {
      throw new Error('unexpected refresh call');
    },
    revoke: async () => {
      throw new Error('unexpected revoke call');
    },
    ...overrides,
  };
}

function makeRow(overrides: Partial<QboConnectionRow>): QboConnectionRow {
  return {
    id: 'conn-1',
    firm_id: 'firm-1',
    workspace_id: 'ws-1',
    realm_id: '9130001',
    company_name: 'Bella Roma Pizza #42 (mock)',
    access_token_enc: null,
    access_token_expires_at: null,
    refresh_claimed_at: null,
    refresh_token_enc: null,
    refresh_token_expires_at: null,
    refresh_token_hard_expires_at: null,
    status: 'active',
    last_synced_at: null,
    last_sync_error: null,
    connected_by: 'user-1',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function rotatedTokenSet(): QboTokenSet {
  return {
    accessToken: 'new-at',
    refreshToken: 'new-rt',
    accessTokenExpiresAt: new Date(NOW + 3600_000).toISOString(),
    refreshTokenExpiresAt: new Date(NOW + 8640000_000).toISOString(),
    refreshTokenHardExpiresAt: null,
  };
}

async function main(): Promise<void> {
  // ------------------------------------------------- token freshness (pure)
  {
    const in10min = new Date(NOW + 10 * 60_000).toISOString();
    const in90s = new Date(NOW + 90_000).toISOString();
    const exactly2min = new Date(NOW + ACCESS_TOKEN_FRESHNESS_WINDOW_MS).toISOString();
    const past = new Date(NOW - 1000).toISOString();
    check(isAccessTokenFresh(in10min, NOW), 'expiry 10 min out is fresh');
    check(!isAccessTokenFresh(in90s, NOW), 'expiry 90 s out is stale (inside 2-min window)');
    check(!isAccessTokenFresh(exactly2min, NOW), 'exactly-2-min boundary is stale (strict >)');
    check(!isAccessTokenFresh(past, NOW), 'past expiry is stale');
    check(!isAccessTokenFresh(null, NOW), 'null expiry is stale');
    check(!isAccessTokenFresh('not-a-date', NOW), 'unparseable expiry is stale');
  }

  // ------------------------------------- getFreshAccessToken: fresh shortcut
  {
    const accessEnc = await encryptSecret('stored-at', TOKEN_KEY);
    const row = makeRow({
      access_token_enc: accessEnc,
      access_token_expires_at: new Date(NOW + 30 * 60_000).toISOString(),
    });
    let refreshCalls = 0;
    const { db } = fakeDb({ getById: async () => row });
    const deps = makeDeps(db, {
      refresh: async () => {
        refreshCalls++;
        return rotatedTokenSet();
      },
    });
    const result = await getFreshAccessToken('conn-1', {}, deps);
    check(result.accessToken === 'stored-at', 'fresh token returned decrypted without refresh');
    check(result.realmId === '9130001', 'fresh path returns the realm');
    check(refreshCalls === 0, 'no refresh when the access token is fresh');

    // forceRefresh (the api layer's onUnauthorized) skips the shortcut.
    const rowWithRefresh = makeRow({
      access_token_enc: accessEnc,
      access_token_expires_at: new Date(NOW + 30 * 60_000).toISOString(),
      refresh_token_enc: await encryptSecret('stored-rt', TOKEN_KEY),
    });
    const guardedLog: DbLog['guarded'] = [];
    const { db: db2 } = fakeDb({
      getById: async () => rowWithRefresh,
      updateTokensGuarded: async (id, expected, patch) => {
        guardedLog.push({ id, expected, patch });
        return 1;
      },
    });
    const forced = await getFreshAccessToken(
      'conn-1',
      { forceRefresh: true },
      makeDeps(db2, {
        refresh: async (_e, params) => {
          check(params.refreshToken === 'stored-rt', 'forceRefresh decrypts the stored refresh token');
          return rotatedTokenSet();
        },
      })
    );
    check(forced.accessToken === 'new-at', 'forceRefresh returns the rotated access token');
    check(guardedLog.length === 1, 'forceRefresh persists via the guarded update');
  }

  // ----------------------- getFreshAccessToken: refresh + guarded persistence
  {
    const staleAccessEnc = await encryptSecret('old-at', TOKEN_KEY);
    const refreshEnc = await encryptSecret('old-rt', TOKEN_KEY);
    const row = makeRow({
      access_token_enc: staleAccessEnc,
      access_token_expires_at: new Date(NOW + 60_000).toISOString(), // inside window
      refresh_token_enc: refreshEnc,
    });
    const guarded: DbLog['guarded'] = [];
    let refreshCalls = 0;
    const { db, log } = fakeDb({
      getById: async () => row,
      updateTokensGuarded: async (id, expected, patch) => {
        guarded.push({ id, expected, patch });
        return 1;
      },
    });
    const deps = makeDeps(db, {
      refresh: async (_e, params) => {
        refreshCalls++;
        check(params.refreshToken === 'old-rt', 'refresh gets the decrypted stored refresh token');
        return rotatedTokenSet();
      },
    });
    const result = await getFreshAccessToken('conn-1', {}, deps);
    check(result.accessToken === 'new-at', 'stale token path returns the rotated access token');
    check(refreshCalls === 1, 'exactly one refresh call');
    check(
      log.claims.length === 1 &&
        log.claims[0].expected === refreshEnc &&
        log.claims[0].claimedAtIso === new Date(NOW).toISOString() &&
        log.claims[0].staleBeforeIso === new Date(NOW - REFRESH_CLAIM_STALE_MS).toISOString(),
      'refresh first wins the CAS claim, guarded on the exact ciphertext read'
    );
    check(guarded.length === 1, 'exactly one guarded update');
    check(
      guarded[0].expected === refreshEnc,
      'guard matches on the EXACT refresh ciphertext that was read'
    );
    const patch = guarded[0].patch;
    check(
      patch.refresh_claimed_at === null,
      'winner clears the claim in the SAME persisted patch'
    );
    check(
      log.claimClears.length === 0,
      'happy path needs no separate claim clear (the patch does it)'
    );
    check(
      typeof patch.access_token_enc === 'string' &&
        (await decryptSecret(patch.access_token_enc, TOKEN_KEY)) === 'new-at',
      'persisted access token decrypts to the rotated value'
    );
    check(
      typeof patch.refresh_token_enc === 'string' &&
        (await decryptSecret(patch.refresh_token_enc, TOKEN_KEY)) === 'new-rt',
      'persisted refresh token decrypts to the ROTATED value (never the old one)'
    );
    check(
      patch.access_token_expires_at === rotatedTokenSet().accessTokenExpiresAt,
      'persisted access expiry matches the token set'
    );
  }

  // ------- getFreshAccessToken: guarded persist lost (ciphertext moved while
  // holding the claim — a stale-claim takeover rotated first)
  {
    const refreshEnc = await encryptSecret('old-rt', TOKEN_KEY);
    const winnerAccessEnc = await encryptSecret('winner-at', TOKEN_KEY);
    const winnerRefreshEnc = await encryptSecret('winner-rt', TOKEN_KEY);
    const staleRow = makeRow({
      access_token_enc: await encryptSecret('old-at', TOKEN_KEY),
      access_token_expires_at: new Date(NOW - 1000).toISOString(),
      refresh_token_enc: refreshEnc,
    });
    const winnerRow = makeRow({
      access_token_enc: winnerAccessEnc,
      access_token_expires_at: new Date(NOW + 3500_000).toISOString(),
      refresh_token_enc: winnerRefreshEnc,
    });
    let reads = 0;
    let refreshCalls = 0;
    const { db, log } = fakeDb({
      getById: async () => {
        reads++;
        return reads === 1 ? staleRow : winnerRow; // re-read sees the winner
      },
      updateTokensGuarded: async () => 0, // the persist race was lost
    });
    const deps = makeDeps(db, {
      refresh: async () => {
        refreshCalls++;
        return rotatedTokenSet();
      },
    });
    const result = await getFreshAccessToken('conn-1', {}, deps);
    check(result.accessToken === 'winner-at', 'lost persist uses the concurrent winner\'s tokens');
    check(refreshCalls === 1, 'lost persist does NOT refresh a second time (token-family safety)');
    check(reads === 2, 'lost persist re-reads the row exactly once');
    check(
      log.claimClears.length === 1 &&
        log.claimClears[0].claimedAtIso === new Date(NOW).toISOString(),
      'lost persist clears OUR claim best-effort (guarded on our claimedAt)'
    );
  }

  // ----------------- getFreshAccessToken: claim lost → poll for the winner
  {
    const initialEnc = await encryptSecret('old-at', TOKEN_KEY);
    const refreshEnc = await encryptSecret('old-rt', TOKEN_KEY);
    const staleRow = makeRow({
      access_token_enc: initialEnc,
      access_token_expires_at: new Date(NOW - 1000).toISOString(),
      refresh_token_enc: refreshEnc,
      refresh_claimed_at: new Date(NOW - 2000).toISOString(), // live claim
    });
    const winnerRow = makeRow({
      access_token_enc: await encryptSecret('winner-at', TOKEN_KEY),
      access_token_expires_at: new Date(NOW + 3500_000).toISOString(),
      refresh_token_enc: await encryptSecret('winner-rt', TOKEN_KEY),
      refresh_claimed_at: null,
    });
    let reads = 0;
    let sleeps = 0;
    let claimAttempts = 0;
    const { db } = fakeDb({
      getById: async () => {
        reads++;
        // Initial read + first poll still see the in-flight state; the
        // second poll sees the winner's landed pair.
        return reads <= 2 ? staleRow : winnerRow;
      },
      claimRefresh: async () => {
        claimAttempts++;
        return 0; // the claim is held elsewhere
      },
    });
    const deps = makeDeps(db, {
      sleep: async () => {
        sleeps++;
      },
      // makeDeps default refresh throws 'unexpected refresh call' — reaching
      // Intuit from the loser path would fail the run.
    });
    const result = await getFreshAccessToken('conn-1', {}, deps);
    check(result.accessToken === 'winner-at', 'claim loser returns the winner\'s fresh token');
    check(result.realmId === '9130001', 'claim loser returns the realm');
    check(claimAttempts === 1, 'a LIVE claim is never re-claimed (no stale-retry)');
    check(sleeps === 2, 'claim loser slept between polls');
  }

  // ------------- claim lost + forceRefresh: unchanged ciphertext is refused
  {
    const initialEnc = await encryptSecret('rejected-at', TOKEN_KEY);
    const refreshEnc = await encryptSecret('old-rt', TOKEN_KEY);
    const sameEncRow = makeRow({
      access_token_enc: initialEnc,
      access_token_expires_at: new Date(NOW + 3500_000).toISOString(), // fresh by clock
      refresh_token_enc: refreshEnc,
      refresh_claimed_at: new Date(NOW - 2000).toISOString(),
    });
    const rotatedRow = makeRow({
      access_token_enc: await encryptSecret('rotated-at', TOKEN_KEY),
      access_token_expires_at: new Date(NOW + 3500_000).toISOString(),
      refresh_token_enc: await encryptSecret('rotated-rt', TOKEN_KEY),
      refresh_claimed_at: null,
    });
    let reads = 0;
    const { db } = fakeDb({
      getById: async () => {
        reads++;
        // Initial read + first poll: the very token Intuit just rejected is
        // still on the row (fresh by clock!); second poll: rotated.
        return reads <= 2 ? sameEncRow : rotatedRow;
      },
      claimRefresh: async () => 0,
    });
    const result = await getFreshAccessToken('conn-1', { forceRefresh: true }, makeDeps(db));
    check(
      result.accessToken === 'rotated-at',
      'forceRefresh loser waits for a CHANGED ciphertext (never re-serves the rejected token)'
    );
    check(reads === 3, 'forceRefresh loser skipped the unchanged-ciphertext poll');
  }

  // -------------------- claim gone stale mid-poll → retried EXACTLY once
  {
    const refreshEnc = await encryptSecret('old-rt', TOKEN_KEY);
    const staleClaimRow = makeRow({
      access_token_enc: await encryptSecret('old-at', TOKEN_KEY),
      access_token_expires_at: new Date(NOW - 1000).toISOString(),
      refresh_token_enc: refreshEnc,
      // Claim is OLDER than the staleness window → abandoned winner.
      refresh_claimed_at: new Date(NOW - REFRESH_CLAIM_STALE_MS - 1000).toISOString(),
    });
    let claimAttempts = 0;
    let refreshCalls = 0;
    const guarded: DbLog['guarded'] = [];
    const { db } = fakeDb({
      getById: async () => staleClaimRow,
      claimRefresh: async (_id, expected) => {
        claimAttempts++;
        check(expected === refreshEnc, `claim attempt ${claimAttempts} guards on the ciphertext`);
        return claimAttempts === 1 ? 0 : 1; // initial loses; the stale retry WINS
      },
      updateTokensGuarded: async (id, expected, patch) => {
        guarded.push({ id, expected, patch });
        return 1;
      },
    });
    const deps = makeDeps(db, {
      refresh: async () => {
        refreshCalls++;
        return rotatedTokenSet();
      },
    });
    const result = await getFreshAccessToken('conn-1', {}, deps);
    check(result.accessToken === 'new-at', 'stale-claim takeover refreshes and returns the pair');
    check(claimAttempts === 2, 'stale claim is retried exactly once');
    check(refreshCalls === 1, 'takeover calls Intuit exactly once');
    check(
      guarded.length === 1 && guarded[0].patch.refresh_claimed_at === null,
      'takeover persists via the guard and clears the claim'
    );

    // Same stale-claim row, but the retry ALSO loses and the winner never
    // lands: bounded polling ends in the retryable error, never at Intuit.
    let claims2 = 0;
    let sleeps2 = 0;
    const { db: db2 } = fakeDb({
      getById: async () => staleClaimRow,
      claimRefresh: async () => {
        claims2++;
        return 0;
      },
    });
    await checkThrows(
      () =>
        getFreshAccessToken(
          'conn-1',
          {},
          makeDeps(db2, {
            sleep: async () => {
              sleeps2++;
            },
          })
        ),
      'exhausted poll budget throws',
      (err) =>
        check(
          err instanceof QboRefreshInProgressError,
          'exhausted poll budget throws the retryable QboRefreshInProgressError'
        )
    );
    check(claims2 === 2, 'even a stuck row claims at most twice (initial + one retry)');
    check(sleeps2 === REFRESH_CLAIM_POLL_ATTEMPTS, 'poll budget is bounded');
  }

  // ------------------- needs_reauth classification + status short-circuits
  {
    check(
      isInvalidGrantError(
        new QboOAuthError('x', { status: 400, body: '{"error":"invalid_grant"}', intuitTid: null })
      ),
      '400 + invalid_grant body classifies as invalid grant'
    );
    check(
      !isInvalidGrantError(
        new QboOAuthError('x', { status: 401, body: '{"error":"invalid_client"}', intuitTid: null })
      ),
      '401 invalid_client (operator misconfig) is NOT an invalid grant'
    );
    check(
      !isInvalidGrantError(
        new QboOAuthError('x', { status: 500, body: 'oops', intuitTid: null })
      ),
      '5xx is NOT an invalid grant'
    );
    check(!isInvalidGrantError(new Error('random')), 'plain Error is NOT an invalid grant');

    // invalid_grant on refresh → needs_reauth via the CIPHERTEXT-GUARDED
    // write (+ claim cleared in the same patch) + QboReauthRequiredError.
    const deadRefreshEnc = await encryptSecret('dead-rt', TOKEN_KEY);
    const row = makeRow({
      access_token_enc: await encryptSecret('old-at', TOKEN_KEY),
      access_token_expires_at: new Date(NOW - 1000).toISOString(),
      refresh_token_enc: deadRefreshEnc,
    });
    const invalidGrant = () =>
      new QboOAuthError('QBO token refresh failed with HTTP 400.', {
        status: 400,
        body: '{"error":"invalid_grant"}',
        intuitTid: 'tid-1',
      });
    const guarded: DbLog['guarded'] = [];
    const { db, log } = fakeDb({
      getById: async () => row,
      updateTokensGuarded: async (id, expected, patch) => {
        guarded.push({ id, expected, patch });
        return 1; // ciphertext still ours → the mark lands
      },
    });
    const deps = makeDeps(db, {
      refresh: async () => {
        throw invalidGrant();
      },
    });
    await checkThrows(
      () => getFreshAccessToken('conn-1', {}, deps),
      'invalid_grant refresh throws',
      (err) =>
        check(err instanceof QboReauthRequiredError, 'invalid_grant throws QboReauthRequiredError')
    );
    check(
      guarded.length === 1 &&
        guarded[0].expected === deadRefreshEnc &&
        guarded[0].patch.status === 'needs_reauth',
      'invalid_grant marks needs_reauth GUARDED on the exact ciphertext read'
    );
    check(
      typeof guarded[0]?.patch.last_sync_error === 'string',
      'invalid_grant records a last_sync_error'
    );
    check(
      guarded[0]?.patch.refresh_claimed_at === null,
      'invalid_grant clears the claim in the same guarded write'
    );
    check(log.updates.length === 0, 'invalid_grant never writes status UNguarded');

    // invalid_grant with the ciphertext MOVED (guarded write matches 0): a
    // race-loser's stale invalid_grant must NOT mark the healthy connection
    // needs_reauth — the winner's tokens are re-read and used instead.
    const winnerRow = makeRow({
      access_token_enc: await encryptSecret('winner-at', TOKEN_KEY),
      access_token_expires_at: new Date(NOW + 3500_000).toISOString(),
      refresh_token_enc: await encryptSecret('winner-rt', TOKEN_KEY),
    });
    let movedReads = 0;
    const movedGuarded: DbLog['guarded'] = [];
    const { db: dbMoved, log: logMoved } = fakeDb({
      getById: async () => {
        movedReads++;
        return movedReads === 1 ? row : winnerRow;
      },
      updateTokensGuarded: async (id, expected, patch) => {
        movedGuarded.push({ id, expected, patch });
        return 0; // ciphertext moved under us
      },
    });
    const movedResult = await getFreshAccessToken(
      'conn-1',
      {},
      makeDeps(dbMoved, {
        refresh: async () => {
          throw invalidGrant();
        },
      })
    );
    check(
      movedResult.accessToken === 'winner-at',
      'stale invalid_grant (ciphertext moved) resolves to the winner\'s token'
    );
    check(
      movedGuarded.length === 1 && logMoved.updates.length === 0,
      'stale invalid_grant SKIPS the needs_reauth mark (guarded write only, 0 rows)'
    );
    check(
      logMoved.claimClears.length === 1,
      'stale invalid_grant clears the claim best-effort'
    );

    // Non-invalid_grant refresh failures propagate untouched, no status
    // write — but the claim IS cleared so the connection isn't wedged.
    const { db: db2, log: log2 } = fakeDb({
      getById: async () => row,
    });
    await checkThrows(
      () =>
        getFreshAccessToken(
          'conn-1',
          {},
          makeDeps(db2, {
            refresh: async () => {
              throw new QboOAuthError('QBO token refresh failed with HTTP 500.', {
                status: 500,
                body: 'transient',
                intuitTid: null,
              });
            },
          })
        ),
      'transient refresh failure throws',
      (err) =>
        check(
          err instanceof QboOAuthError && err.status === 500,
          'transient failure propagates the original error (not reauth)'
        )
    );
    check(log2.updates.length === 0 && log2.guarded.length === 0, 'transient failure does NOT touch status');
    check(
      log2.claimClears.length === 1 &&
        log2.claimClears[0].claimedAtIso === new Date(NOW).toISOString(),
      'transient failure clears the claim best-effort'
    );

    // Rows already needs_reauth / revoked short-circuit before any refresh.
    for (const status of ['needs_reauth', 'revoked'] as const) {
      const { db: db3 } = fakeDb({ getById: async () => makeRow({ status }) });
      await checkThrows(
        () => getFreshAccessToken('conn-1', {}, makeDeps(db3)),
        `${status} row throws before refreshing`,
        (err) =>
          check(
            err instanceof QboReauthRequiredError,
            `${status} row throws QboReauthRequiredError`
          )
      );
    }
  }

  // ---------------------------------------------------- upsertConnection
  {
    const tokens = rotatedTokenSet();
    const params = {
      firmId: 'firm-1',
      workspaceId: 'ws-1',
      realmId: '9130001',
      companyName: 'Bella Roma Pizza #42 (mock)',
      tokens,
      connectedBy: 'user-1',
    };

    // No existing row → insert.
    {
      const { db, log } = fakeDb({ getByWorkspace: async () => null });
      await upsertConnection(params, makeDeps(db));
      check(log.inserts.length === 1 && log.deletes.length === 0, 'first connect inserts');
      check(
        log.inserts[0].firm_id === 'firm-1' &&
          log.inserts[0].workspace_id === 'ws-1' &&
          log.inserts[0].realm_id === '9130001' &&
          log.inserts[0].status === 'active',
        'insert carries firm/workspace/realm/status'
      );
      check(
        typeof log.inserts[0].access_token_enc === 'string' &&
          (await decryptSecret(log.inserts[0].access_token_enc as string, TOKEN_KEY)) === 'new-at',
        'inserted access token is encrypted'
      );
      check(
        log.audits.length === 1 &&
          log.audits[0].action === 'qbo.connect' &&
          log.audits[0].firm_id === 'firm-1' &&
          log.audits[0].actor_user_id === 'user-1' &&
          log.audits[0].target === 'ws-1',
        'connect writes a qbo.connect audit row'
      );
    }

    // Same realm → update in place (no delete; status back to active).
    {
      const existing = makeRow({
        id: 'conn-9',
        status: 'needs_reauth',
        last_sync_error: 'old',
        connected_by: 'someone-else',
        refresh_claimed_at: new Date(NOW - 5000).toISOString(),
      });
      const { db, log } = fakeDb({ getByWorkspace: async () => existing });
      await upsertConnection(params, makeDeps(db));
      check(
        log.deletes.length === 0 && log.inserts.length === 0 && log.updates.length === 1,
        'same-realm reconnect updates in place'
      );
      check(log.updates[0].id === 'conn-9', 'same-realm update targets the existing row');
      check(
        log.updates[0].patch.status === 'active' && log.updates[0].patch.last_sync_error === null,
        'same-realm reconnect resets status to active and clears the sync error'
      );
      check(
        log.updates[0].patch.connected_by === 'user-1',
        'same-realm reconnect rewrites connected_by (persists — migration v2 un-pinned it)'
      );
      check(
        log.updates[0].patch.refresh_claimed_at === null,
        'same-realm reconnect resets any leftover refresh claim'
      );
    }

    // Different realm → delete + fresh insert (realm_id is trigger-pinned).
    {
      const existing = makeRow({ id: 'conn-9', realm_id: '9130002' });
      const { db, log } = fakeDb({ getByWorkspace: async () => existing });
      await upsertConnection(params, makeDeps(db));
      check(
        log.deletes.length === 1 && log.deletes[0] === 'conn-9',
        'different-realm reconnect deletes the old row first'
      );
      check(
        log.inserts.length === 1 && log.inserts[0].realm_id === '9130001',
        'different-realm reconnect inserts fresh with the new realm'
      );
      check(log.updates.length === 0, 'different-realm reconnect never updates the pinned row');
    }

    // unique(firm_id, realm_id) violation on insert (residual connect race)
    // → typed QboRealmInUseError, no audit row for the failed connect.
    {
      const { db, log } = fakeDb({
        getByWorkspace: async () => null,
        insert: async () => {
          throw Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
          });
        },
      });
      await checkThrows(
        () => upsertConnection(params, makeDeps(db)),
        'unique-violation insert throws',
        (err) =>
          check(
            err instanceof QboRealmInUseError,
            'unique-violation insert maps to QboRealmInUseError'
          )
      );
      check(log.audits.length === 0, 'failed connect writes no qbo.connect audit row');

      // Non-unique insert failures propagate untouched.
      const boom = new Error('connection reset');
      const { db: db2 } = fakeDb({
        getByWorkspace: async () => null,
        insert: async () => {
          throw boom;
        },
      });
      await checkThrows(
        () => upsertConnection(params, makeDeps(db2)),
        'non-unique insert failure throws',
        (err) => check(err === boom, 'non-unique insert failure propagates untouched')
      );
    }

    // isUniqueViolationError classification matrix.
    {
      check(
        isUniqueViolationError(Object.assign(new Error('dup'), { code: '23505' })),
        'error with code 23505 classifies as unique violation'
      );
      check(
        isUniqueViolationError({ code: '23505', message: 'dup' }),
        'plain PostgrestError-shaped object with 23505 classifies too'
      );
      check(!isUniqueViolationError(Object.assign(new Error('x'), { code: '23503' })), 'other SQLSTATEs do not');
      check(!isUniqueViolationError(new Error('23505')), 'code in the MESSAGE does not count');
      check(!isUniqueViolationError(null), 'null is not a unique violation');
      check(!isUniqueViolationError('23505'), 'a bare string is not a unique violation');
    }
  }

  // -------------- claimRefresh / clearRefreshClaim adapter (filter building)
  {
    // Recording fake supabase client: every builder method logs and returns
    // the chainable; awaiting resolves to a canned PostgREST result. Proves
    // the adapter emits the exact eq/eq/or(NULL-or-stale)/select chain.
    interface BuilderCall {
      method: string;
      args: unknown[];
    }
    const makeFakeService = (result: { data: unknown; error: unknown }) => {
      const calls: BuilderCall[] = [];
      const builder: Record<string, unknown> = {};
      for (const method of ['update', 'eq', 'or', 'select', 'insert', 'delete', 'lt']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown
      ): Promise<unknown> => Promise.resolve(result).then(resolve, reject);
      const service = {
        from: (table: string) => {
          calls.push({ method: 'from', args: [table] });
          return builder;
        },
      };
      return { service: service as unknown as Parameters<typeof createQboConnectionsDb>[0], calls };
    };

    const claimedAtIso = new Date(NOW).toISOString();
    const staleBeforeIso = new Date(NOW - REFRESH_CLAIM_STALE_MS).toISOString();

    const { service, calls } = makeFakeService({ data: [{ id: 'conn-1' }], error: null });
    const adapter = createQboConnectionsDb(service);
    const won = await adapter.claimRefresh('conn-1', 'enc-x', claimedAtIso, staleBeforeIso);
    check(won === 1, 'claimRefresh counts the matched rows');
    check(
      JSON.stringify(calls) ===
        JSON.stringify([
          { method: 'from', args: ['qbo_connections'] },
          { method: 'update', args: [{ refresh_claimed_at: claimedAtIso }] },
          { method: 'eq', args: ['id', 'conn-1'] },
          { method: 'eq', args: ['refresh_token_enc', 'enc-x'] },
          {
            method: 'or',
            args: [`refresh_claimed_at.is.null,refresh_claimed_at.lt."${staleBeforeIso}"`],
          },
          { method: 'select', args: ['id'] },
        ]),
      'claimRefresh builds the exact guarded NULL-or-stale filter chain'
    );

    const lost = makeFakeService({ data: [], error: null });
    check(
      (await createQboConnectionsDb(lost.service).claimRefresh(
        'conn-1',
        'enc-x',
        claimedAtIso,
        staleBeforeIso
      )) === 0,
      'claimRefresh returns 0 when no row matches (claim held elsewhere)'
    );

    const clear = makeFakeService({ data: null, error: null });
    await createQboConnectionsDb(clear.service).clearRefreshClaim('conn-1', claimedAtIso);
    check(
      JSON.stringify(clear.calls) ===
        JSON.stringify([
          { method: 'from', args: ['qbo_connections'] },
          { method: 'update', args: [{ refresh_claimed_at: null }] },
          { method: 'eq', args: ['id', 'conn-1'] },
          { method: 'eq', args: ['refresh_claimed_at', claimedAtIso] },
        ]),
      'clearRefreshClaim clears ONLY the claim we set (guarded on claimedAt)'
    );
  }

  // ------------------------------------- markSyncResult / resolveSyncStatus
  {
    check(resolveSyncStatus('active', true) === 'active', 'active + ok stays active');
    check(resolveSyncStatus('error', true) === 'active', 'error + ok recovers to active');
    check(resolveSyncStatus('active', false) === 'error', 'active + fail goes to error');
    check(
      resolveSyncStatus('needs_reauth', true) === 'needs_reauth',
      'needs_reauth is sticky through success'
    );
    check(
      resolveSyncStatus('needs_reauth', false) === 'needs_reauth',
      'needs_reauth is sticky through failure'
    );
    check(resolveSyncStatus('revoked', false) === 'revoked', 'revoked is sticky');

    const row = makeRow({ status: 'error', last_sync_error: 'previous failure' });
    const { db, log } = fakeDb({ getById: async () => row });
    await markSyncResult('conn-1', { ok: true }, makeDeps(db));
    check(
      log.updates.length === 1 &&
        log.updates[0].patch.status === 'active' &&
        log.updates[0].patch.last_sync_error === null &&
        log.updates[0].patch.last_synced_at === new Date(NOW).toISOString(),
      'success stamps last_synced_at, clears the error, restores active'
    );

    const { db: db2, log: log2 } = fakeDb({ getById: async () => makeRow({}) });
    await markSyncResult('conn-1', { ok: false, error: 'boom' }, makeDeps(db2));
    check(
      log2.updates.length === 1 &&
        log2.updates[0].patch.status === 'error' &&
        log2.updates[0].patch.last_sync_error === 'boom' &&
        log2.updates[0].patch.last_synced_at === undefined,
      'failure stores the error without touching last_synced_at'
    );

    const { db: db3, log: log3 } = fakeDb({ getById: async () => null });
    await markSyncResult('gone', { ok: true }, makeDeps(db3));
    check(log3.updates.length === 0, 'missing row is a no-op (disconnect can race a sync)');
  }

  // ------------------------------------------------------ deleteConnection
  {
    const refreshEnc = await encryptSecret('rt-to-revoke', TOKEN_KEY);
    const row = makeRow({ refresh_token_enc: refreshEnc });

    // Happy path: revoke succeeds, row deleted, audit says revoked.
    {
      let revokedToken: string | null = null;
      const { db, log } = fakeDb({ getById: async () => row });
      await deleteConnection(
        'conn-1',
        { revoke: true, actor: 'user-2' },
        makeDeps(db, {
          revoke: async (_e, params) => {
            revokedToken = params.token;
          },
        })
      );
      check(revokedToken === 'rt-to-revoke', 'revoke gets the decrypted refresh token');
      check(log.deletes.length === 1 && log.deletes[0] === 'conn-1', 'row deleted');
      check(
        log.audits.length === 1 &&
          log.audits[0].action === 'qbo.disconnect' &&
          log.audits[0].actor_user_id === 'user-2' &&
          (log.audits[0].metadata as { revoked?: boolean }).revoked === true,
        'disconnect audit row records the revocation'
      );
    }

    // Revocation failure NEVER blocks deletion; it lands in audit metadata.
    {
      const { db, log } = fakeDb({ getById: async () => row });
      await deleteConnection(
        'conn-1',
        { revoke: true, actor: 'user-2' },
        makeDeps(db, {
          revoke: async () => {
            throw new Error('intuit is down');
          },
        })
      );
      check(log.deletes.length === 1, 'row deleted despite revocation failure');
      const meta = log.audits[0]?.metadata as { revoked?: boolean; revokeError?: string };
      check(
        meta?.revoked === false && meta?.revokeError === 'intuit is down',
        'revocation failure recorded in audit metadata'
      );
    }

    // revoke:false skips Intuit entirely.
    {
      const { db, log } = fakeDb({ getById: async () => row });
      await deleteConnection('conn-1', { revoke: false, actor: 'user-2' }, makeDeps(db));
      check(log.deletes.length === 1, 'revoke:false still deletes');
      check(
        (log.audits[0]?.metadata as { revoked?: boolean })?.revoked === false,
        'revoke:false audits revoked:false'
      );
    }

    // Missing row → silent no-op.
    {
      const { db, log } = fakeDb({ getById: async () => null });
      await deleteConnection('gone', { revoke: true, actor: 'user-2' }, makeDeps(db));
      check(log.deletes.length === 0 && log.audits.length === 0, 'missing row deletes nothing');
    }
  }

  // ------------------------------------ getConnectionForWorkspace + context
  {
    const row = makeRow({});
    const { db } = fakeDb({ getByWorkspace: async (id) => (id === 'ws-1' ? row : null) });
    const deps = makeDeps(db);
    check(
      (await getConnectionForWorkspace('ws-1', deps))?.id === 'conn-1',
      'getConnectionForWorkspace returns the row'
    );
    check(
      (await getConnectionForWorkspace('ws-other', deps)) === null,
      'getConnectionForWorkspace returns null for unknown workspaces'
    );

    const ctx = buildApiContext(row, deps);
    check(
      ctx.baseUrl === 'https://quickbooks.api.intuit.com/v3' && ctx.realmId === '9130001',
      'buildApiContext wires baseUrl (from env) + realm'
    );
    check(
      typeof ctx.getAccessToken === 'function' && typeof ctx.onUnauthorized === 'function',
      'buildApiContext wires token getters'
    );
  }

  // ------------------------------------------------------- chunk planning
  {
    check(clampYearsBack(undefined) === QBO_SYNC_YEARS_BACK_DEFAULT, 'yearsBack defaults to 3');
    check(clampYearsBack(0) === 1, 'yearsBack clamps up to 1');
    check(clampYearsBack(-5) === 1, 'negative yearsBack clamps to 1');
    check(clampYearsBack(15) === QBO_SYNC_YEARS_BACK_MAX, 'yearsBack clamps down to 10');
    check(clampYearsBack(2.9) === 2, 'fractional yearsBack truncates');
    check(clampYearsBack(NaN) === QBO_SYNC_YEARS_BACK_DEFAULT, 'NaN yearsBack falls to default');

    const jul2026 = new Date('2026-07-22T12:00:00.000Z');
    const chunks = planSyncChunks(jul2026, 3);
    check(chunks.length === 3, 'yearsBack 3 yields 3 chunks');
    check(
      chunks[0].year === 2024 && chunks[1].year === 2025 && chunks[2].year === 2026,
      'chunks run oldest → current year'
    );
    check(
      chunks[0].startDate === '2024-01-01' && chunks[0].endDate === '2024-12-31',
      'past-year chunks span the full calendar year'
    );
    check(chunks[1].endDate === '2025-12-31', 'prior year ends Dec 31');
    check(
      chunks[2].startDate === '2026-01-01' && chunks[2].endDate === '2026-07-31',
      'current-year chunk ends at the last day of the CURRENT month'
    );

    const feb2024 = new Date('2024-02-10T00:00:00.000Z');
    const leap = planSyncChunks(feb2024, 1);
    check(
      leap.length === 1 && leap[0].endDate === '2024-02-29',
      'leap-year February ends on the 29th'
    );
    const feb2026 = planSyncChunks(new Date('2026-02-01T00:00:00.000Z'), 1);
    check(feb2026[0].endDate === '2026-02-28', 'non-leap February ends on the 28th');
    check(lastDayOfMonth(2026, 12) === 31 && lastDayOfMonth(2026, 4) === 30, 'lastDayOfMonth');

    const ten = planSyncChunks(jul2026, 25);
    check(
      ten.length === 10 && ten[0].year === 2017 && ten[9].year === 2026,
      'oversized yearsBack clamps to a 10-year span'
    );

    const janBoundary = planSyncChunks(new Date('2026-01-05T00:00:00.000Z'), 2);
    check(
      janBoundary[1].endDate === '2026-01-31' && janBoundary[0].year === 2025,
      'January plan ends the current chunk at Jan 31'
    );
  }

  // ------------------------------------------------- mock Intuit: tokens
  {
    const minted = mintTokensFromCode('mock-code-9130001');
    check(
      minted !== null &&
        minted.access_token === 'mock-at-1' &&
        minted.refresh_token === 'mock-rt-1',
      'code exchange starts the token family at counter 1'
    );
    check(
      minted !== null &&
        minted.expires_in === 3600 &&
        minted.x_refresh_token_expires_in === 8640000 &&
        minted.x_refresh_token_hard_expires_in === 157680000 &&
        minted.token_type === 'bearer',
      'minted payload carries the Intuit expiry fields'
    );
    check(mintTokensFromCode('not-a-mock-code') === null, 'unknown code shape rejects');
    check(mintTokensFromCode('') === null, 'empty code rejects');

    const rotated = rotateTokens('mock-rt-1');
    check(
      rotated !== null &&
        rotated.access_token === 'mock-at-2' &&
        rotated.refresh_token === 'mock-rt-2',
      'refresh rotates the counter 1 → 2'
    );
    const rotated7 = rotateTokens('mock-rt-7');
    check(
      rotated7 !== null && rotated7.refresh_token === 'mock-rt-8',
      'rotation is stateless — counter parsed from the incoming token'
    );
    check(rotateTokens('mock-at-3') === null, 'an ACCESS token cannot refresh');
    check(rotateTokens('garbage') === null, 'garbage refresh token rejects');
  }

  // ---------------------------------------------- mock Intuit: companies
  {
    check(MOCK_COMPANIES.length === 2, 'two mock companies');
    check(
      mockCompanyName('9130001') === 'Bella Roma Pizza #42 (mock)' &&
        mockCompanyName('9130002') === 'Second Mock Co',
      'realms map to company names'
    );
    check(mockCompanyName('999') === null, 'unknown realm has no company');
  }

  // ----------------------------------------------- mock Intuit: fixtures
  {
    const pnl2024 = pickReportFixture('pnl', '2024-01-01', '2024-12-31');
    check(
      pnl2024.Header.ReportName === 'ProfitAndLoss' && pnl2024.Rows.Row.length > 0,
      '2024 P&L serves the fixture'
    );
    const bs2025 = pickReportFixture('bs', '2025-01-01', '2025-12-31');
    check(
      bs2025.Header.ReportName === 'BalanceSheet' && bs2025.Rows.Row.length > 0,
      '2025 BS serves the fixture'
    );
    const empty = pickReportFixture('pnl', '2019-01-01', '2019-12-31');
    check(empty.Rows.Row.length === 0, 'unknown year serves an empty report');
    check(
      empty.Header.Option?.some((o) => o.Name === 'NoReportData' && o.Value === 'true') === true,
      'empty report carries the NoReportData option'
    );
    check(
      empty.Header.StartPeriod === '2019-01-01' && empty.Header.EndPeriod === '2019-12-31',
      'empty report echoes the requested range'
    );
    const emptyBs = emptyReportEnvelope('bs', '2019-01-01', '2019-12-31');
    check(emptyBs.Header.ReportName === 'BalanceSheet', 'empty envelope names the report kind');
  }

  // ------------------------------------- mock Intuit: authorize state echo
  {
    const state = 'eyJhIjoxfQ.abc_-XYZ'; // signed-state-shaped
    const html = authorizePageHtml('http://localhost:3011/api/qbo/callback', state);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) =>
      m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    );
    check(hrefs.length === 2, 'authorize page renders one link per company');
    for (const [i, company] of MOCK_COMPANIES.entries()) {
      const href = new URL(hrefs[i]);
      check(
        href.searchParams.get('state') === state,
        `link ${i} echoes the state EXACTLY`
      );
      check(
        href.searchParams.get('code') === `mock-code-${company.realmId}` &&
          href.searchParams.get('realmId') === company.realmId,
        `link ${i} carries code + realmId for ${company.name}`
      );
      check(
        href.origin + href.pathname === 'http://localhost:3011/api/qbo/callback',
        `link ${i} targets the redirect_uri`
      );
    }
    // State with URL-hostile characters still round-trips exactly.
    const hostile = 'a b&c=?#';
    const html2 = authorizePageHtml('http://localhost:3011/api/qbo/callback', hostile);
    const href2 = [...html2.matchAll(/href="([^"]+)"/g)][0][1].replace(/&amp;/g, '&');
    check(
      new URL(href2).searchParams.get('state') === hostile,
      'URL-hostile state round-trips through encoding exactly'
    );
  }

  // ------------------------------------------ mock Intuit: prod-safety gate
  {
    const saved = {
      mock: process.env.FINSIGHT_QBO_MOCK,
      key: process.env.QBO_TOKEN_KEY,
      secret: process.env.QBO_STATE_SECRET,
      origin: process.env.QBO_REDIRECT_ORIGIN,
    };
    delete process.env.FINSIGHT_QBO_MOCK;
    delete process.env.QBO_TOKEN_KEY;
    check(!isMockEnabled(), 'mock disabled when QBO env is entirely absent (prod default)');

    process.env.FINSIGHT_QBO_MOCK = 'true';
    process.env.QBO_TOKEN_KEY = TOKEN_KEY;
    process.env.QBO_STATE_SECRET = 'dev-secret';
    process.env.QBO_REDIRECT_ORIGIN = 'http://localhost:3011';
    check(isMockEnabled(), 'mock enabled with FINSIGHT_QBO_MOCK=true + dev env');

    process.env.FINSIGHT_QBO_MOCK = 'false';
    check(!isMockEnabled(), 'mock disabled when the flag is explicitly false');

    // Restore whatever the ambient shell had.
    for (const [envKey, value] of [
      ['FINSIGHT_QBO_MOCK', saved.mock],
      ['QBO_TOKEN_KEY', saved.key],
      ['QBO_STATE_SECRET', saved.secret],
      ['QBO_REDIRECT_ORIGIN', saved.origin],
    ] as const) {
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  }

  // -------------------- runQboSyncChunk: client-date validation matrix
  {
    // The range validation runs BEFORE any auth/context resolution, so the
    // rejection paths are exercisable headlessly through the real action.
    const expectInvalid = async (
      label: string,
      startDate: string,
      endDate: string,
      expected: string
    ): Promise<void> => {
      const res = await runQboSyncChunk('ws-1', { year: 2026, startDate, endDate }, { includeCoa: false });
      check(res.ok === false && res.reason === 'error' && res.message === expected, label);
    };
    await expectInvalid(
      'inverted range rejects',
      '2026-05-01',
      '2026-04-30',
      'Invalid sync chunk range.'
    );
    await expectInvalid(
      'cross-year range rejects (one calendar year per chunk)',
      '2025-12-01',
      '2026-01-31',
      'Invalid sync chunk range.'
    );
    await expectInvalid(
      'decade-spanning range rejects',
      '2017-01-01',
      '2026-12-31',
      'Invalid sync chunk range.'
    );
    await expectInvalid('bad ISO start rejects', '2026-5-01', '2026-05-31', 'Invalid chunk date range.');
    await expectInvalid('bad ISO end rejects', '2026-05-01', 'nope', 'Invalid chunk date range.');

    // Valid same-year ranges must PASS validation. Outside a Next request
    // scope the action then dies (or fails closed) in gateSync — anything
    // except the two validation messages proves good chunks flow through.
    for (const [startDate, endDate] of [
      ['2026-01-01', '2026-12-31'],
      ['2026-07-01', '2026-07-01'], // single day, same year
    ] as const) {
      try {
        const res = await runQboSyncChunk(
          'ws-1',
          { year: 2026, startDate, endDate },
          { includeCoa: false }
        );
        check(
          !(
            res.ok === false &&
            res.reason === 'error' &&
            (res.message === 'Invalid sync chunk range.' ||
              res.message === 'Invalid chunk date range.')
          ),
          `valid range ${startDate}..${endDate} passes validation`
        );
      } catch {
        // Threw in gateSync (no Next runtime here) — validation passed. OK.
      }
    }
  }

  // -------------------------- state/nonce plumbing sanity (routes' contract)
  {
    // The full single-use behavior lives in the routes (see the header
    // comment); here we prove the pure pieces the routes rely on: the nonce
    // survives the signed-state round trip, so cookie === state.n is a
    // meaningful equality, and a tampered state never verifies.
    const nonce = makeNonce();
    const state = await buildState(
      { u: 'user-1', f: 'firm-1', w: 'ws-1', n: nonce, exp: Date.now() + 600_000 },
      'test-state-secret'
    );
    const verified = await verifyState(state, 'test-state-secret');
    check(verified?.n === nonce, 'nonce round-trips through the signed state');
    check(
      (await verifyState(state, 'other-secret')) === null,
      'state signed with another secret never verifies'
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} qbo-server check(s) FAILED`);
    process.exit(1);
  }
  console.log('All qbo-server checks passed.');
}

main().catch((err) => {
  console.error('UNEXPECTED ERROR:', err);
  process.exit(1);
});
