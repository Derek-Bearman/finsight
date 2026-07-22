/**
 * QBO OAuth token lifecycle: authorize URL, code exchange, refresh, revoke.
 * SERVER-ONLY. Plain fetch — no Intuit SDK — so it runs identically on
 * Cloudflare Workers and Node 20+.
 *
 * Intuit specifics baked in (plan §1):
 * - Confidential client: token + revoke calls carry HTTP Basic auth
 *   (base64(clientId:clientSecret)). PKCE is not supported.
 * - Refresh tokens ROTATE (~every 24h): any refresh response may carry a NEW
 *   refresh_token and the old one silently dies. QboTokenSet always surfaces
 *   the response's refresh_token — callers MUST persist the new pair
 *   atomically and must never run two refreshes concurrently for one realm
 *   (Intuit anti-replay can revoke the whole token family).
 * - `x-include-refresh-token-hard-expires-in: true` requests the Nov-2025
 *   hard 5-year refresh expiry so reauth UX can be a first-class state.
 *
 * Every network function takes an optional fetchImpl (defaults to the global
 * fetch) so check suites can assert the exact wire format without Intuit.
 */

import {
  QBO_SCOPE,
  qboAuthorizeUrl,
  qboRedirectUri,
  qboRevokeUrl,
  qboTokenUrl,
  type QboEnv,
} from './config';

// Dependency-free server-only guard (house pattern; this module handles secrets).
if (typeof window !== 'undefined') {
  throw new Error('qbo/oauth.ts is server-only and must never reach the browser.');
}

type FetchImpl = typeof globalThis.fetch;

export interface QboTokenSet {
  accessToken: string;
  /** The CURRENT refresh token — after refreshTokens() this may differ from
   *  the one sent (rotation). Always persist this one. */
  refreshToken: string;
  /** ISO timestamp when the access token expires (~1h from issue). */
  accessTokenExpiresAt: string;
  /** ISO timestamp of the ROLLING 100-day refresh expiry (extends per use). */
  refreshTokenExpiresAt: string;
  /** ISO timestamp of the hard 5-year refresh cap, when Intuit reports it. */
  refreshTokenHardExpiresAt: string | null;
}

/** Non-2xx (or malformed) response from Intuit's OAuth endpoints. Carries the
 *  HTTP status, raw body text, and the `intuit_tid` header — the id Intuit
 *  support asks for — so callers can log a useful trail. */
export class QboOAuthError extends Error {
  readonly status: number;
  readonly body: string;
  readonly intuitTid: string | null;
  constructor(message: string, opts: { status: number; body: string; intuitTid: string | null }) {
    super(message);
    this.name = 'QboOAuthError';
    this.status = opts.status;
    this.body = opts.body;
    this.intuitTid = opts.intuitTid;
  }
}

function basicAuthHeader(env: QboEnv): string {
  return `Basic ${btoa(`${env.clientId}:${env.clientSecret}`)}`;
}

function responseError(label: string, res: Response, body: string): QboOAuthError {
  return new QboOAuthError(`QBO ${label} failed with HTTP ${res.status}.`, {
    status: res.status,
    body,
    intuitTid: res.headers.get('intuit_tid'),
  });
}

/** The Intuit consent-screen URL for a signed state. `state` is required by
 *  the real endpoint; `realmId` comes back as a redirect query param. */
export function buildAuthorizeUrl(env: QboEnv, params: { state: string }): string {
  const url = new URL(qboAuthorizeUrl(env));
  url.searchParams.set('client_id', env.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', QBO_SCOPE);
  url.searchParams.set('redirect_uri', qboRedirectUri(env));
  url.searchParams.set('state', params.state);
  return url.toString();
}

/** Shared POST-to-token-endpoint for both grants. Computes expiry ISO
 *  timestamps from the pre-request clock (conservative: Intuit issued the
 *  tokens before we saw the response). */
async function tokenRequest(
  env: QboEnv,
  form: Record<string, string>,
  label: string,
  fetchImpl: FetchImpl
): Promise<QboTokenSet> {
  const issuedAt = Date.now();
  const res = await fetchImpl(qboTokenUrl(env), {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(env),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'x-include-refresh-token-hard-expires-in': 'true',
    },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw responseError(label, res, text);

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw responseError(`${label} (non-JSON 2xx body)`, res, text);
  }
  const accessToken = raw.access_token;
  const refreshToken = raw.refresh_token;
  const expiresIn = raw.expires_in;
  const refreshExpiresIn = raw.x_refresh_token_expires_in;
  const hardExpiresIn = raw.x_refresh_token_hard_expires_in;
  if (
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    typeof expiresIn !== 'number' ||
    typeof refreshExpiresIn !== 'number'
  ) {
    throw responseError(`${label} (malformed token payload)`, res, text);
  }
  const toIso = (seconds: number): string => new Date(issuedAt + seconds * 1000).toISOString();
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: toIso(expiresIn),
    refreshTokenExpiresAt: toIso(refreshExpiresIn),
    refreshTokenHardExpiresAt: typeof hardExpiresIn === 'number' ? toIso(hardExpiresIn) : null,
  };
}

/** Exchange the callback's auth code for tokens. Codes are SINGLE-USE — a
 *  duplicate exchange invalidates the first exchange's tokens, so callers
 *  guard against double-firing (nonce cookie cleared on first use). */
export function exchangeCode(
  env: QboEnv,
  params: { code: string },
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<QboTokenSet> {
  return tokenRequest(
    env,
    {
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: qboRedirectUri(env),
    },
    'code exchange',
    fetchImpl
  );
}

/** Refresh the token pair. The response's refresh_token REPLACES the one
 *  passed in (rotation) — persist the returned set atomically, and never
 *  refresh the same realm concurrently. */
export function refreshTokens(
  env: QboEnv,
  params: { refreshToken: string },
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<QboTokenSet> {
  return tokenRequest(
    env,
    {
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
    },
    'token refresh',
    fetchImpl
  );
}

/** Revoke a token (access or refresh — either kills the whole grant).
 *  Intuit returns exactly 200 on success; anything else throws. */
export async function revokeToken(
  env: QboEnv,
  params: { token: string },
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<void> {
  const res = await fetchImpl(qboRevokeUrl(env), {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(env),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ token: params.token }),
  });
  if (res.status !== 200) {
    const text = await res.text().catch(() => '');
    throw responseError('token revoke', res, text);
  }
}
