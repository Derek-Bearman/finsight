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
  /**
   * The response middleware must return (or copy cookies from, when it
   * redirects). A GETTER, not a snapshot: setAll REPLACES the response object
   * when Supabase rotates the session mid-getUser(), so a reference captured
   * before the auth call silently drops the refreshed cookies — the browser
   * keeps a burned refresh token and every page bounces to /login about an
   * hour after sign-in.
   */
  getResponse(): NextResponse;
}

export function createSupabaseProxyClient(request: NextRequest): SupabaseProxyResult {
  // Start with a passthrough response. Any cookies the Supabase client
  // refreshes get appended to this response below, then we return it from
  // middleware.ts (or copy its cookies onto a redirect).
  let response = NextResponse.next({ request });

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
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options: CookieOptions }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  return { supabase, getResponse: () => response };
}
