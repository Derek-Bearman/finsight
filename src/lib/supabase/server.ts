/**
 * Server-side Supabase client for Next.js 16 App Router (Server Components,
 * Server Actions, Route Handlers).
 *
 * Next 16's `cookies()` is async, so this factory is async too. Use it
 * inside server-side code paths that need to read the authenticated user
 * or query data under that user's RLS policies.
 *
 * Example:
 *   const supabase = await createSupabaseServerClient();
 *   const { data: { user } } = await supabase.auth.getUser();
 *
 * The `setAll` callback can throw in pure Server Components — that's
 * expected and harmless because Server Components don't refresh cookies
 * (the proxy.ts middleware does). We swallow the error to avoid noise.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './database.types';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in env.'
    );
  }
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a pure Server Component — Next.js doesn't allow
          // cookie mutation there. proxy.ts handles the actual refresh.
        }
      },
    },
  });
}
