/**
 * Signed OAuth state for the QBO connect flow. SERVER-ONLY. WebCrypto
 * HMAC-SHA256 (`globalThis.crypto`) so it runs identically on Cloudflare
 * Workers and Node 20+ — no node:crypto imports.
 *
 * Format (plan §2.4): `base64url(json payload) + '.' + base64url(hmac)` where
 * the HMAC (keyed by QBO_STATE_SECRET) is computed over the encoded payload
 * exactly as it travels — no canonicalization gap. The payload binds the flow
 * to {user, firm, workspace} plus a nonce (echoed in the httpOnly cookie set
 * by /api/qbo/connect) and a short expiry, so /api/qbo/callback can authorize
 * the redirect even though it sits on middleware PUBLIC_PATHS.
 *
 * verifyState never throws on hostile input: bad shape, bad signature
 * (constant-time via crypto.subtle.verify), and expiry all return null.
 */

// Dependency-free server-only guard (house pattern; this module handles secrets).
if (typeof window !== 'undefined') {
  throw new Error('qbo/state.ts is server-only and must never reach the browser.');
}

const NONCE_BYTES = 16;

export interface QboStatePayload {
  /** Auth user id that initiated the connect. */
  u: string;
  /** Firm id the connection belongs to. */
  f: string;
  /** Workspace id the QBO company will be bound to. */
  w: string;
  /** Nonce; must match the httpOnly cookie set by /api/qbo/connect. */
  n: string;
  /** Expiry as ms since epoch (Date.now() + ~10 min at build time). */
  exp: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  // Strict alphabet check — atob() alone is too forgiving about junk input.
  if (!/^[A-Za-z0-9_-]*$/.test(b64url)) throw new Error('Not base64url.');
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  );
}

function isStatePayload(value: unknown): value is QboStatePayload {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.u === 'string' &&
    typeof o.f === 'string' &&
    typeof o.w === 'string' &&
    typeof o.n === 'string' &&
    typeof o.exp === 'number'
  );
}

/** Encode + sign a state payload. The caller sets `exp` (ms since epoch). */
export async function buildState(payload: QboStatePayload, secret: string): Promise<string> {
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret, ['sign']);
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return `${encoded}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

/** Verify signature + shape + expiry. Returns the payload, or null on ANY
 *  failure — never throws on hostile input. The signature is checked first
 *  (constant-time, via subtle.verify) so nothing unauthenticated is parsed. */
export async function verifyState(state: string, secret: string): Promise<QboStatePayload | null> {
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encoded, sigB64] = parts;

  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = base64UrlToBytes(sigB64);
  } catch {
    return null;
  }
  const key = await importHmacKey(secret, ['verify']);
  const valid = await globalThis.crypto.subtle.verify(
    'HMAC',
    key,
    sig,
    new TextEncoder().encode(encoded)
  );
  if (!valid) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
  } catch {
    return null;
  }
  if (!isStatePayload(payload)) return null;
  if (payload.exp < Date.now()) return null;
  return payload;
}

/** 16 random bytes as base64url (22 chars) — the CSRF nonce carried in both
 *  the signed state and the httpOnly connect cookie. */
export function makeNonce(): string {
  return bytesToBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}
