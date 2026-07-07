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
  if (!next) return '/';
  // Browsers strip ASCII control characters (tab/newline/CR) when parsing
  // URLs, so "/\t//evil.com" (reachable via %09 in the query string) would
  // resolve protocol-relative. Strip them BEFORE validating the shape.
  // eslint-disable-next-line no-control-regex
  const cleaned = next.replace(/[\u0000-\u001F\u007F]/g, '');
  if (!cleaned.startsWith('/')) return '/';
  // "//host" and "/\host" resolve off-origin in browsers (WHATWG normalizes
  // backslash to slash). A single leading slash followed by a normal char is
  // the only shape we accept.
  if (cleaned[1] === '/' || cleaned[1] === '\\') return '/';
  return cleaned;
}
