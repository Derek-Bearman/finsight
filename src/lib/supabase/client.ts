'use client';

/**
 * Browser-side Supabase client.
 *
 * Use from `'use client'` components only. Uses the public anon key — RLS
 * policies on the database enforce per-firm scoping, so this is safe to
 * expose in the browser bundle.
 *
 * For server-side reads/writes, use `createSupabaseServerClient` from
 * `./server.ts` instead — that variant binds to the request's auth cookie
 * via Next.js's async `cookies()` API.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Set them in wrangler.jsonc vars (and .env.local for dev).'
    );
  }
  return createBrowserClient<Database>(url, anonKey);
}
