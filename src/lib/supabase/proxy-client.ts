/**
 * Proxy-context Supabase client.
 *
 * Used exclusively from `proxy.ts` (Next 16's middleware replacement). It
 * needs special cookie handling because the Proxy runs before the response
 * is sent — we read cookies from the incoming request and write refreshed
 * cookies onto an outgoing NextResponse that we then return.
 *
 * Why a separate file from `server.ts`:
 *   - Proxy can't import `next/headers` `cookies()` — different runtime.
 *   - `server.ts` is for Server Components / Server Actions / Route
 *     Handlers, where `next/headers` IS available.
 *   - Same Supabase package (@supabase/ssr / createServerClient), different
 *     cookie adapters.
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

interface SupabaseProxyResult {
  supabase: ReturnType<typeof createServerClient>;
  response: NextResponse;
}

export function createSupabaseProxyClient(request: NextRequest): SupabaseProxyResult {
  // Start with a passthrough response. Any cookies the Supabase client
  // refreshes get appended to this response below, then we return it from
  // proxy.ts (or further modify it with a redirect, etc.).
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in env (proxy).'
    );
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Mutate both the request (for downstream reads) and the response
        // (so the browser receives refreshed cookies on this round-trip).
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({
          request: { headers: request.headers },
        });
        cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options: CookieOptions }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  return { supabase, response };
}
