/**
 * QBO foundations checks (config / crypto / state / oauth), runnable headless:
 *   npx tsx scripts/checks/qbo-oauth.check.ts
 *
 * Covers: env resolution + mock-mode endpoint switching; AES-256-GCM
 * roundtrip, tamper and wrong-key rejection; signed-state roundtrip, tamper /
 * expiry rejection, nonce shape; and the OAuth wire format against an
 * injected fake fetch — Basic auth, form bodies, the hard-expiry header,
 * refresh-token ROTATION surfacing, and QboOAuthError with intuit_tid.
 */

import {
  getQboEnv,
  qboApiBaseUrl,
  qboAuthorizeUrl,
  qboRedirectUri,
  qboRevokeUrl,
  qboTokenUrl,
  QBO_SCOPE,
  type QboEnv,
} from '../../src/lib/qbo/config';
import {
  decryptSecret,
  encryptSecret,
  generateKeyBase64,
  QboCryptoError,
} from '../../src/lib/qbo/crypto';
import { buildState, makeNonce, verifyState, type QboStatePayload } from '../../src/lib/qbo/state';
import {
  buildAuthorizeUrl,
  exchangeCode,
  refreshTokens,
  revokeToken,
  QboOAuthError,
} from '../../src/lib/qbo/oauth';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

/** Await fn, expect it to throw; hand the error to inspect for extra checks. */
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

/** Swap one char of a base64 string at index i (stays valid base64). */
function tamperChar(s: string, i: number): string {
  const replacement = s[i] === 'A' ? 'B' : 'A';
  return s.slice(0, i) + replacement + s.slice(i + 1);
}

interface RecordedCall {
  url: string;
  init: RequestInit;
}
function fakeFetch(handler: (url: string, init: RequestInit) => Response): {
  impl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}

const env: QboEnv = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tokenKey: generateKeyBase64(),
  stateSecret: 'test-state-secret',
  redirectOrigin: 'https://finsight.example.com',
  mockMode: false,
};

async function main(): Promise<void> {
  // ---------------------------------------------------------------- config
  {
    process.env.FINSIGHT_QBO_MOCK = 'false';
    process.env.QBO_CLIENT_ID = 'cid';
    process.env.QBO_CLIENT_SECRET = 'csec';
    process.env.QBO_TOKEN_KEY = 'tkey';
    process.env.QBO_STATE_SECRET = 'ssec';
    process.env.QBO_REDIRECT_ORIGIN = 'http://localhost:3011/';
    const e = getQboEnv();
    check(e.clientId === 'cid' && e.clientSecret === 'csec', 'getQboEnv reads client id/secret');
    check(e.tokenKey === 'tkey' && e.stateSecret === 'ssec', 'getQboEnv reads keys');
    check(e.redirectOrigin === 'http://localhost:3011', 'getQboEnv strips trailing slash on origin');
    check(e.mockMode === false, 'FINSIGHT_QBO_MOCK !== "true" means real mode');

    delete process.env.QBO_CLIENT_ID;
    try {
      getQboEnv();
      check(false, 'getQboEnv should throw when QBO_CLIENT_ID is missing');
    } catch (err) {
      check(
        err instanceof Error && err.message.includes('QBO_CLIENT_ID'),
        'missing-var error names QBO_CLIENT_ID'
      );
    }

    process.env.FINSIGHT_QBO_MOCK = 'true';
    delete process.env.QBO_CLIENT_SECRET;
    const m = getQboEnv();
    check(m.mockMode === true, 'FINSIGHT_QBO_MOCK=true enables mock mode');
    check(m.clientId === 'mock' && m.clientSecret === 'mock', 'mock mode defaults client id/secret to "mock"');

    delete process.env.QBO_TOKEN_KEY;
    try {
      getQboEnv();
      check(false, 'mock mode should still require QBO_TOKEN_KEY');
    } catch (err) {
      check(
        err instanceof Error && err.message.includes('QBO_TOKEN_KEY'),
        'mock-mode missing-var error names QBO_TOKEN_KEY'
      );
    }
    delete process.env.FINSIGHT_QBO_MOCK;
  }

  {
    check(
      qboAuthorizeUrl(env) === 'https://appcenter.intuit.com/connect/oauth2',
      'real authorize endpoint'
    );
    check(
      qboTokenUrl(env) === 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      'real token endpoint'
    );
    check(
      qboRevokeUrl(env) === 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
      'real revoke endpoint'
    );
    check(qboApiBaseUrl(env) === 'https://quickbooks.api.intuit.com/v3', 'real api base incl /v3');
    check(
      qboRedirectUri(env) === 'https://finsight.example.com/api/qbo/callback',
      'redirect URI = origin + /api/qbo/callback'
    );

    const mockEnv: QboEnv = { ...env, mockMode: true };
    check(
      qboAuthorizeUrl(mockEnv) === `${env.redirectOrigin}/api/qbo/mock/authorize` &&
        qboTokenUrl(mockEnv) === `${env.redirectOrigin}/api/qbo/mock/token` &&
        qboRevokeUrl(mockEnv) === `${env.redirectOrigin}/api/qbo/mock/revoke` &&
        qboApiBaseUrl(mockEnv) === `${env.redirectOrigin}/api/qbo/mock/v3`,
      'mock mode points all endpoints at /api/qbo/mock/*'
    );
  }

  // ---------------------------------------------------------------- crypto
  const key = generateKeyBase64();
  {
    const secret = 'refresh-token-АБВ-💰-plus-ascii'; // Exercise multi-byte UTF-8.
    const enc = await encryptSecret(secret, key);
    check(enc.startsWith('v1.'), 'ciphertext carries the v1. prefix');
    check((await decryptSecret(enc, key)) === secret, 'crypto roundtrip preserves plaintext');
    const enc2 = await encryptSecret(secret, key);
    check(enc !== enc2, 'fresh IV per encryption (same plaintext, different ciphertext)');
    check((await decryptSecret(await encryptSecret('', key), key)) === '', 'empty-string roundtrip');
  }
  {
    const enc = await encryptSecret('tamper-me', key);
    const ivTampered = tamperChar(enc, 5); // Inside the IV region.
    const ctTampered = tamperChar(enc, enc.length - 10); // Inside ciphertext+tag.
    await checkThrows(
      () => decryptSecret(ivTampered, key),
      'tampered IV fails GCM auth',
      (err) =>
        check(
          err instanceof QboCryptoError && err.code === 'decrypt_failed',
          'tampered IV throws QboCryptoError(decrypt_failed)'
        )
    );
    await checkThrows(
      () => decryptSecret(ctTampered, key),
      'tampered ciphertext fails GCM auth',
      (err) =>
        check(
          err instanceof QboCryptoError && err.code === 'decrypt_failed',
          'tampered ciphertext throws QboCryptoError(decrypt_failed)'
        )
    );
    await checkThrows(
      () => decryptSecret(enc, generateKeyBase64()),
      'wrong key fails to decrypt',
      (err) =>
        check(
          err instanceof QboCryptoError && err.code === 'decrypt_failed',
          'wrong key throws QboCryptoError(decrypt_failed)'
        )
    );
    const shortKey = btoa('0123456789abcdef'); // 16 bytes, not 32.
    await checkThrows(
      () => encryptSecret('x', shortKey),
      'short key rejected on encrypt',
      (err) =>
        check(
          err instanceof QboCryptoError && err.code === 'bad_key' && err.message.includes('32'),
          'short key throws QboCryptoError(bad_key) naming the required length'
        )
    );
    await checkThrows(
      () => decryptSecret(enc, 'not-base64!!!'),
      'garbage key rejected on decrypt',
      (err) => check(err instanceof QboCryptoError && err.code === 'bad_key', 'garbage key → bad_key')
    );
    await checkThrows(
      () => decryptSecret('v2.' + enc.slice(3), key),
      'wrong prefix rejected',
      (err) =>
        check(
          err instanceof QboCryptoError && err.code === 'bad_ciphertext',
          'wrong prefix throws QboCryptoError(bad_ciphertext)'
        )
    );
    await checkThrows(
      () => decryptSecret('v1.!!!not-base64!!!', key),
      'non-base64 payload rejected',
      (err) =>
        check(err instanceof QboCryptoError && err.code === 'bad_ciphertext', 'non-base64 → bad_ciphertext')
    );
    await checkThrows(
      () => decryptSecret('v1.' + btoa('short'), key),
      'too-short payload rejected',
      (err) =>
        check(err instanceof QboCryptoError && err.code === 'bad_ciphertext', 'too-short → bad_ciphertext')
    );
  }

  // ----------------------------------------------------------------- state
  const SECRET = 'state-secret-1';
  {
    const payload: QboStatePayload = {
      u: 'user-1',
      f: 'firm-1',
      w: 'ws-1',
      n: makeNonce(),
      exp: Date.now() + 10 * 60 * 1000,
    };
    const state = await buildState(payload, SECRET);
    check(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(state), 'state is base64url.base64url');
    const verified = await verifyState(state, SECRET);
    check(verified !== null, 'valid state verifies');
    check(
      verified !== null &&
        verified.u === payload.u &&
        verified.f === payload.f &&
        verified.w === payload.w &&
        verified.n === payload.n &&
        verified.exp === payload.exp,
      'verified payload matches what was built'
    );

    check((await verifyState(tamperChar(state, 2), SECRET)) === null, 'tampered payload rejected');
    check(
      (await verifyState(tamperChar(state, state.length - 3), SECRET)) === null,
      'tampered signature rejected'
    );
    check((await verifyState(state, 'other-secret')) === null, 'wrong secret rejected');
    check((await verifyState('garbage-no-dot', SECRET)) === null, 'dotless garbage rejected');
    check((await verifyState('a.b.c', SECRET)) === null, 'three-part garbage rejected');
    check((await verifyState('.', SECRET)) === null, 'empty parts rejected');
    check((await verifyState('', SECRET)) === null, 'empty string rejected');

    const expired = await buildState({ ...payload, exp: Date.now() - 1000 }, SECRET);
    check((await verifyState(expired, SECRET)) === null, 'expired state rejected');

    // Signed-but-wrong-shape payload must be rejected by the shape check.
    const badShape = await buildState(
      { u: 'user-1', f: 'firm-1', w: 'ws-1', n: 'nonce' } as unknown as QboStatePayload,
      SECRET
    );
    check((await verifyState(badShape, SECRET)) === null, 'signed payload missing exp rejected');
  }
  {
    const nonces = new Set<string>();
    for (let i = 0; i < 500; i++) nonces.add(makeNonce());
    check(nonces.size === 500, 'nonces are unique across 500 draws');
    check(/^[A-Za-z0-9_-]{22}$/.test(makeNonce()), 'nonce is 22-char base64url (16 bytes)');
  }

  // ----------------------------------------------------------------- oauth
  {
    const url = new URL(buildAuthorizeUrl(env, { state: 'the-state' }));
    check(url.origin === 'https://appcenter.intuit.com', 'authorize URL hits appcenter');
    check(url.pathname === '/connect/oauth2', 'authorize URL path');
    check(url.searchParams.get('client_id') === env.clientId, 'authorize URL carries client_id');
    check(url.searchParams.get('response_type') === 'code', 'authorize URL response_type=code');
    check(url.searchParams.get('scope') === QBO_SCOPE, 'authorize URL scope=accounting');
    check(
      url.searchParams.get('redirect_uri') === 'https://finsight.example.com/api/qbo/callback',
      'authorize URL redirect_uri'
    );
    check(url.searchParams.get('state') === 'the-state', 'authorize URL carries state');

    const mockUrl = buildAuthorizeUrl({ ...env, mockMode: true }, { state: 's' });
    check(
      mockUrl.startsWith(`${env.redirectOrigin}/api/qbo/mock/authorize?`),
      'mock-mode authorize URL targets the mock route'
    );
  }

  {
    const tokenJson = {
      access_token: 'AT-1',
      refresh_token: 'RT-1',
      expires_in: 3600,
      x_refresh_token_expires_in: 8726400,
      x_refresh_token_hard_expires_in: 157680000,
      token_type: 'bearer',
    };
    const { impl, calls } = fakeFetch(
      () => new Response(JSON.stringify(tokenJson), { status: 200 })
    );
    const before = Date.now();
    const tokens = await exchangeCode(env, { code: 'auth-code-1' }, impl);
    const after = Date.now();

    check(calls.length === 1, 'exchangeCode makes exactly one request');
    const call = calls[0];
    check(call.url === qboTokenUrl(env), 'exchangeCode POSTs the token URL');
    check(call.init.method === 'POST', 'exchangeCode uses POST');
    const headers = new Headers(call.init.headers);
    check(
      headers.get('authorization') === `Basic ${btoa('test-client-id:test-client-secret')}`,
      'exchangeCode sends Basic base64(clientId:clientSecret)'
    );
    check(
      headers.get('content-type') === 'application/x-www-form-urlencoded',
      'exchangeCode body is form-encoded'
    );
    check(
      headers.get('x-include-refresh-token-hard-expires-in') === 'true',
      'exchangeCode requests the hard refresh expiry'
    );
    const form = new URLSearchParams(String(call.init.body));
    check(form.get('grant_type') === 'authorization_code', 'exchangeCode grant_type');
    check(form.get('code') === 'auth-code-1', 'exchangeCode sends the code');
    check(
      form.get('redirect_uri') === 'https://finsight.example.com/api/qbo/callback',
      'exchangeCode sends the redirect_uri'
    );

    check(tokens.accessToken === 'AT-1' && tokens.refreshToken === 'RT-1', 'token set carries tokens');
    const accessAt = Date.parse(tokens.accessTokenExpiresAt);
    check(
      accessAt >= before + 3600_000 && accessAt <= after + 3600_000,
      'accessTokenExpiresAt = now + expires_in'
    );
    const refreshAt = Date.parse(tokens.refreshTokenExpiresAt);
    check(
      refreshAt >= before + 8726400_000 && refreshAt <= after + 8726400_000,
      'refreshTokenExpiresAt = now + x_refresh_token_expires_in'
    );
    const hardAt = tokens.refreshTokenHardExpiresAt ? Date.parse(tokens.refreshTokenHardExpiresAt) : NaN;
    check(
      hardAt >= before + 157680000_000 && hardAt <= after + 157680000_000,
      'refreshTokenHardExpiresAt = now + x_refresh_token_hard_expires_in'
    );
  }

  {
    // Rotation: the refresh response returns a NEW refresh_token; the set must
    // surface it (persisting the old one would strand the connection).
    const { impl, calls } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            access_token: 'AT-2',
            refresh_token: 'RT-2-ROTATED',
            expires_in: 3600,
            x_refresh_token_expires_in: 8726400,
            // No hard-expiry field this time.
          }),
          { status: 200 }
        )
    );
    const tokens = await refreshTokens(env, { refreshToken: 'RT-1' }, impl);
    const form = new URLSearchParams(String(calls[0].init.body));
    check(form.get('grant_type') === 'refresh_token', 'refreshTokens grant_type');
    check(form.get('refresh_token') === 'RT-1', 'refreshTokens sends the OLD refresh token');
    const headers = new Headers(calls[0].init.headers);
    check(
      headers.get('authorization') === `Basic ${btoa('test-client-id:test-client-secret')}` &&
        headers.get('x-include-refresh-token-hard-expires-in') === 'true',
      'refreshTokens sends Basic auth + hard-expiry header'
    );
    check(tokens.refreshToken === 'RT-2-ROTATED', 'rotated refresh token is surfaced');
    check(tokens.accessToken === 'AT-2', 'refreshed access token is surfaced');
    check(
      tokens.refreshTokenHardExpiresAt === null,
      'missing hard-expiry field maps to null'
    );
  }

  {
    const { impl } = fakeFetch(
      () =>
        new Response('{"error":"invalid_grant"}', {
          status: 400,
          headers: { intuit_tid: 'tid-abc-123' },
        })
    );
    await checkThrows(
      () => refreshTokens(env, { refreshToken: 'RT-DEAD' }, impl),
      'non-200 refresh throws',
      (err) => {
        check(err instanceof QboOAuthError, 'non-200 throws QboOAuthError');
        if (err instanceof QboOAuthError) {
          check(err.status === 400, `QboOAuthError.status is 400 (got ${err.status})`);
          check(err.body.includes('invalid_grant'), 'QboOAuthError carries the Intuit body text');
          check(err.intuitTid === 'tid-abc-123', 'QboOAuthError carries intuit_tid');
        }
      }
    );

    const malformed = fakeFetch(() => new Response('{"ok":true}', { status: 200 }));
    await checkThrows(
      () => exchangeCode(env, { code: 'c' }, malformed.impl),
      'malformed 200 token payload throws',
      (err) => check(err instanceof QboOAuthError, 'malformed payload throws QboOAuthError')
    );
  }

  {
    const ok = fakeFetch(() => new Response('', { status: 200 }));
    await revokeToken(env, { token: 'RT-2-ROTATED' }, ok.impl);
    check(ok.calls[0].url === qboRevokeUrl(env), 'revokeToken POSTs the revoke URL');
    check(ok.calls[0].init.method === 'POST', 'revokeToken uses POST');
    const headers = new Headers(ok.calls[0].init.headers);
    check(
      headers.get('authorization') === `Basic ${btoa('test-client-id:test-client-secret')}`,
      'revokeToken sends Basic auth'
    );
    check(
      String(ok.calls[0].init.body) === '{"token":"RT-2-ROTATED"}',
      'revokeToken sends {token} as JSON'
    );

    const bad = fakeFetch(
      () => new Response('nope', { status: 400, headers: { intuit_tid: 'tid-revoke' } })
    );
    await checkThrows(
      () => revokeToken(env, { token: 'x' }, bad.impl),
      'non-200 revoke throws',
      (err) =>
        check(
          err instanceof QboOAuthError && err.status === 400 && err.intuitTid === 'tid-revoke',
          'revoke QboOAuthError carries status + intuit_tid'
        )
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} qbo-oauth check(s) FAILED`);
    process.exit(1);
  }
  console.log('All qbo-oauth checks passed.');
}

main().catch((err) => {
  console.error('UNEXPECTED ERROR:', err);
  process.exit(1);
});
