/**
 * Sanitizer for the `next` redirect query param (open-redirect defense).
 *
 * `window.location.assign(next)` resolves protocol-relative ("//evil.com"),
 * backslash ("/\evil.com"), and absolute ("https://evil.com") strings
 * OFF-ORIGIN — a post-login open redirect an attacker can seed via
 * /login?next=//evil.com. Only a plain same-origin absolute path survives.
 *
 * Safe for client and server (pure string logic, no URL constructor).
 */
export function sanitizeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/')) return '/';
  // "//host" and "/\host" resolve off-origin in browsers (WHATWG normalizes
  // backslash to slash). A single leading slash followed by a normal char is
  // the only shape we accept.
  if (next[1] === '/' || next[1] === '\\') return '/';
  return next;
}
