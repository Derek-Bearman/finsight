/**
 * Super-admin allowlist (Derek's limited-access support console). SERVER-ONLY.
 *
 * Source: the `SUPER_ADMIN_EMAILS` env var — a comma / semicolon / whitespace
 * separated list of email addresses. It is read ONLY at runtime on the server
 * and is deliberately NOT a `NEXT_PUBLIC_*` var, so Next never inlines it into
 * the client bundle. Set it as a Cloudflare Worker secret in production and in
 * `.env.local` for local dev:
 *
 *   wrangler secret put SUPER_ADMIN_EMAILS      # e.g. "you@yourdomain.com"
 *   # .env.local:  SUPER_ADMIN_EMAILS=you@yourdomain.com
 *
 * Under @opennextjs/cloudflare, Worker vars + secrets are exposed on
 * `process.env` at runtime; `next dev` reads `.env.local`. If a future runtime
 * ever fails to surface the secret via `process.env`, swap the read below for
 * `getCloudflareContext().env.SUPER_ADMIN_EMAILS`.
 *
 * FAIL CLOSED: if the var is unset or empty, there are NO super-admins.
 *
 * NOTE (metadata-only boundary): being a super-admin grants access to a
 * firm/user/billing METADATA console via the service role. The service role
 * has BYPASSRLS, so it is app-code discipline — not RLS — that keeps the
 * super-admin console from ever selecting `workspaces.data` / financial PII.
 * Never build a super-admin query that reads those columns.
 */

// Dependency-free server-only guard (the `server-only` package isn't installed
// on this project). If this module is ever evaluated in a browser it throws
// loudly, so the allowlist can never leak into client code.
if (typeof window !== 'undefined') {
  throw new Error(
    'super-admin.ts is server-only and must never be imported into client code.'
  );
}

function parseEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/** The configured super-admin emails, normalized to lowercase. Empty if unset. */
export function getSuperAdminEmails(): string[] {
  return parseEmails(process.env.SUPER_ADMIN_EMAILS);
}

/**
 * True iff `email` is on the super-admin allowlist (case-insensitive).
 * Returns false for null / undefined / empty and when the allowlist is unset
 * (fail closed). Compare against the AUTHENTICATED user's verified email from
 * the Supabase session, never against user-supplied input.
 */
export function isSuperAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return getSuperAdminEmails().includes(normalized);
}
