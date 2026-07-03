/**
 * Service-role Supabase client. SERVER-ONLY. Bypasses RLS — use ONLY for the
 * narrow trusted paths that genuinely need it: Stripe webhooks, firm+owner
 * provisioning, and the super-admin metadata console. Never import this into a
 * client component, and never use it to serve per-firm reads that RLS should
 * scope (use the request-scoped server client from ./server.ts for those).
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY at runtime (a wrangler secret in prod;
 * .env.local for dev). Throws if missing so a misconfig fails loudly.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// Dependency-free server-only guard (the `server-only` package isn't installed).
if (typeof window !== 'undefined') {
  throw new Error('supabase/service.ts is server-only and must never reach the browser.');
}

export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL.');
  if (!serviceKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY. Set it via `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (prod) and in .env.local (dev).'
    );
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
