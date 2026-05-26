/**
 * Custom Cloudflare Worker wrapper around the OpenNext-generated worker.
 *
 * Sole purpose: inject defense-in-depth response headers on every request.
 * The underlying Next.js app behaviour is unchanged — we just pass the
 * request through to `.open-next/worker.js` and decorate the response.
 *
 * Headers added:
 *   - Content-Security-Policy:    limits where scripts/styles/data can come
 *                                  from. `'unsafe-inline'` is required for
 *                                  Next.js hydration; everything else is
 *                                  same-origin only.
 *   - X-Frame-Options: DENY        prevents clickjacking via iframe embedding
 *   - X-Content-Type-Options:      blocks MIME sniffing
 *   - Strict-Transport-Security:   forces HTTPS for one year
 *   - Referrer-Policy:             never leaks our paths to third parties
 *   - Permissions-Policy:          camera/mic/geo/FLoC all denied
 *
 * If a future bug introduces XSS, these headers limit the blast radius:
 * exfiltration is blocked by connect-src, third-party script loads are
 * blocked by script-src, framing is blocked by X-Frame-Options.
 */

//@ts-expect-error: Bundled by wrangler at deploy time
import openNextWorker from './.open-next/worker.js';

// Re-export Durable Object classes from the OpenNext worker so wrangler
// can resolve any DO bindings configured in wrangler.jsonc. Safe to keep
// even when no DOs are in use (these re-exports are tree-shaken away if
// nothing references them).
//@ts-expect-error: Bundled by wrangler at deploy time
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js hydration + dev tools
    "style-src 'self' 'unsafe-inline'", // Tailwind utility classes, inline style attrs
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // 'self' for our API routes + Supabase project domain for auth + DB.
    // `wss://*.supabase.co` for Supabase Realtime websockets (used by
    // future features; harmless to allow now). NEVER widen to `*` — the
    // whole point of connect-src is to block exfiltration via attacker JS.
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'self' blob:",
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()',
};

interface WorkerHandler {
  fetch(
    request: Request,
    env: unknown,
    ctx: ExecutionContext,
  ): Promise<Response> | Response;
}

const inner = openNextWorker as WorkerHandler;

export default {
  async fetch(
    request: Request,
    env: unknown,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const response = await inner.fetch(request, env, ctx);

    // Decorate response with security headers. Clone headers so we don't
    // mutate the original (immutable) Response.
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      // Don't clobber any headers the OpenNext worker already set
      // intentionally (rare, but be defensive).
      if (!newHeaders.has(key)) {
        newHeaders.set(key, value);
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};
