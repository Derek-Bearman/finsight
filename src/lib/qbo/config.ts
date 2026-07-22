/**
 * QuickBooks Online integration config. SERVER-ONLY. Central home for the
 * OAuth scope, Intuit endpoints, and env access — every other qbo module
 * resolves its configuration through here so the mock switch
 * (FINSIGHT_QBO_MOCK) can repoint the whole flow at local mock routes with
 * zero code changes (QBO_INTEGRATION_PLAN.md §2.10).
 *
 * Required env (wrangler secrets at deploy time, .env.development.local dev):
 *   QBO_CLIENT_ID        Intuit app client id (defaults to 'mock' in mock mode)
 *   QBO_CLIENT_SECRET    Intuit app client secret (defaults to 'mock' in mock mode)
 *   QBO_TOKEN_KEY        base64 32-byte AES-256-GCM key for stored tokens
 *   QBO_STATE_SECRET     HMAC-SHA256 key for the signed OAuth state
 *   QBO_REDIRECT_ORIGIN  exact origin the redirect URI is registered under
 *                        (wrangler.jsonc var in prod; http://localhost:3011 dev)
 *   FINSIGHT_QBO_MOCK    'true' → all endpoints point at /api/qbo/mock/*
 *                        (dev only; .env.development.local, NEVER .env.local)
 */

// Dependency-free server-only guard (house pattern; this module reads secrets).
if (typeof window !== 'undefined') {
  throw new Error('qbo/config.ts is server-only and must never reach the browser.');
}

/** The ONLY scope we request. Adding a scope later (e.g. openid) forces every
 *  connected company to re-authorize — do not touch for v1 (plan §1). */
export const QBO_SCOPE = 'com.intuit.quickbooks.accounting';

export interface QboEnv {
  clientId: string;
  clientSecret: string;
  /** base64-encoded 32-byte AES-256-GCM key (see qbo/crypto.ts). */
  tokenKey: string;
  /** HMAC key for the signed OAuth state (see qbo/state.ts). */
  stateSecret: string;
  /** Origin (no trailing slash) that /api/qbo/callback is registered under. */
  redirectOrigin: string;
  /** true → oauth + api URLs all point at the local /api/qbo/mock routes. */
  mockMode: boolean;
  /**
   * 'sandbox' → data-API calls hit Intuit's sandbox host. Intuit Development
   * keys ONLY work against sandbox companies, so this must be 'sandbox'
   * whenever QBO_CLIENT_ID holds dev keys (QBO_ENVIRONMENT=sandbox in
   * .env.development.local). OAuth endpoints are shared between the two.
   * Ignored in mock mode. Defaults to 'production'.
   */
  apiEnvironment: 'production' | 'sandbox';
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in .env.development.local (dev) or via wrangler secret at deploy time (see DEREK_QBO_RUNBOOK.md).`
    );
  }
  return value;
}

/** Read + validate all QBO env in one place. Throws (naming the variable) on
 *  anything missing, EXCEPT clientId/clientSecret in mock mode, which default
 *  to 'mock' so the whole flow runs with zero Intuit credentials. */
export function getQboEnv(): QboEnv {
  const mockMode = process.env.FINSIGHT_QBO_MOCK === 'true';
  return {
    clientId: mockMode
      ? process.env.QBO_CLIENT_ID || 'mock'
      : requireEnv('QBO_CLIENT_ID', process.env.QBO_CLIENT_ID),
    clientSecret: mockMode
      ? process.env.QBO_CLIENT_SECRET || 'mock'
      : requireEnv('QBO_CLIENT_SECRET', process.env.QBO_CLIENT_SECRET),
    tokenKey: requireEnv('QBO_TOKEN_KEY', process.env.QBO_TOKEN_KEY),
    stateSecret: requireEnv('QBO_STATE_SECRET', process.env.QBO_STATE_SECRET),
    redirectOrigin: requireEnv(
      'QBO_REDIRECT_ORIGIN',
      process.env.QBO_REDIRECT_ORIGIN
    ).replace(/\/+$/, ''),
    mockMode,
    apiEnvironment:
      process.env.QBO_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production',
  };
}

/** User-consent screen (Intuit's company picker). `state` is REQUIRED by the
 *  real endpoint; PKCE is not supported (plan §1). */
export function qboAuthorizeUrl(env: QboEnv): string {
  return env.mockMode
    ? `${env.redirectOrigin}/api/qbo/mock/authorize`
    : 'https://appcenter.intuit.com/connect/oauth2';
}

/** Token endpoint (code exchange AND refresh — same URL, different grant). */
export function qboTokenUrl(env: QboEnv): string {
  return env.mockMode
    ? `${env.redirectOrigin}/api/qbo/mock/token`
    : 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
}

/** Revocation endpoint (disconnect). */
export function qboRevokeUrl(env: QboEnv): string {
  return env.mockMode
    ? `${env.redirectOrigin}/api/qbo/mock/revoke`
    : 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
}

/** Data-API base INCLUDING the /v3 segment — callers append
 *  `/company/<realmId>/...` so mock, sandbox, and real URLs compose
 *  identically. Sandbox host is selected by QBO_ENVIRONMENT=sandbox (required
 *  whenever Intuit Development keys are in use — they only work against
 *  sandbox companies). */
export function qboApiBaseUrl(env: QboEnv): string {
  if (env.mockMode) return `${env.redirectOrigin}/api/qbo/mock/v3`;
  return env.apiEnvironment === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com/v3'
    : 'https://quickbooks.api.intuit.com/v3';
}

/** The exact-match redirect URI registered with Intuit (HTTPS in prod). */
export function qboRedirectUri(env: QboEnv): string {
  return `${env.redirectOrigin}/api/qbo/callback`;
}
