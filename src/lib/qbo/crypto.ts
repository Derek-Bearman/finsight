/**
 * AES-256-GCM encryption for stored QBO tokens. SERVER-ONLY. WebCrypto only
 * (`globalThis.crypto`) so it runs identically on Cloudflare Workers and
 * Node 20+ — no node:crypto imports.
 *
 * Wire format (plan §2.3): `'v1.' + base64(iv[12] || ciphertext+tag)`. The
 * 'v1.' prefix leaves room to rotate the scheme later without guessing at old
 * rows. The key is QBO_TOKEN_KEY — base64-encoded 32 random bytes, generated
 * once via generateKeyBase64() (see DEREK_QBO_RUNBOOK.md) and stored apart
 * from the database, which satisfies Intuit's "AES, key stored separately"
 * production requirement.
 *
 * All failure modes throw QboCryptoError with a stable `code` so callers can
 * distinguish operator misconfig (bad_key) from data problems
 * (bad_ciphertext / decrypt_failed) without string-matching messages.
 */

// Dependency-free server-only guard (house pattern; this module handles secrets).
if (typeof window !== 'undefined') {
  throw new Error('qbo/crypto.ts is server-only and must never reach the browser.');
}

const CIPHERTEXT_PREFIX = 'v1.';
const IV_BYTES = 12;
const TAG_BYTES = 16; // AES-GCM default 128-bit tag, appended by WebCrypto.
const KEY_BYTES = 32; // AES-256.

export type QboCryptoErrorCode = 'bad_key' | 'bad_ciphertext' | 'decrypt_failed';

export class QboCryptoError extends Error {
  readonly code: QboCryptoErrorCode;
  constructor(code: QboCryptoErrorCode, message: string) {
    super(message);
    this.name = 'QboCryptoError';
    this.code = code;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64); // Throws on invalid input; callers wrap.
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importAesKey(base64Key: string, usages: KeyUsage[]): Promise<CryptoKey> {
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = base64ToBytes(base64Key);
  } catch {
    throw new QboCryptoError('bad_key', 'QBO token key is not valid base64.');
  }
  if (keyBytes.length !== KEY_BYTES) {
    throw new QboCryptoError(
      'bad_key',
      `QBO token key must decode to ${KEY_BYTES} bytes (AES-256); got ${keyBytes.length}.`
    );
  }
  return globalThis.crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, usages);
}

/** Encrypt a secret with AES-256-GCM under a fresh random 12-byte IV.
 *  Returns `'v1.' + base64(iv || ciphertext+tag)`. */
export async function encryptSecret(plaintext: string, base64Key: string): Promise<string> {
  const key = await importAesKey(base64Key, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), iv.length);
  return CIPHERTEXT_PREFIX + bytesToBase64(packed);
}

/** Decrypt a value produced by encryptSecret. Throws QboCryptoError
 *  ('bad_ciphertext' on malformed input, 'decrypt_failed' on wrong key or a
 *  failed GCM auth check — i.e. tampering). */
export async function decryptSecret(ciphertext: string, base64Key: string): Promise<string> {
  if (!ciphertext.startsWith(CIPHERTEXT_PREFIX)) {
    throw new QboCryptoError(
      'bad_ciphertext',
      `Ciphertext does not start with the '${CIPHERTEXT_PREFIX}' prefix.`
    );
  }
  let packed: Uint8Array<ArrayBuffer>;
  try {
    packed = base64ToBytes(ciphertext.slice(CIPHERTEXT_PREFIX.length));
  } catch {
    throw new QboCryptoError('bad_ciphertext', 'Ciphertext payload is not valid base64.');
  }
  if (packed.length < IV_BYTES + TAG_BYTES) {
    throw new QboCryptoError(
      'bad_ciphertext',
      `Ciphertext payload is too short (${packed.length} bytes; need at least ${IV_BYTES + TAG_BYTES}).`
    );
  }
  const key = await importAesKey(base64Key, ['decrypt']);
  const iv = packed.slice(0, IV_BYTES);
  const data = packed.slice(IV_BYTES);
  let plain: ArrayBuffer;
  try {
    plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  } catch {
    throw new QboCryptoError(
      'decrypt_failed',
      'Decryption failed: wrong key or tampered ciphertext (GCM auth check).'
    );
  }
  return new TextDecoder().decode(plain);
}

/** Generate a fresh base64-encoded 32-byte key — dev setup / runbook helper
 *  for minting QBO_TOKEN_KEY. Never called on a request path. */
export function generateKeyBase64(): string {
  return bytesToBase64(globalThis.crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}
