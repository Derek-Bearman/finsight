/**
 * Next.js 16 Proxy (the renamed Middleware). Runs on every matched request
 * before the route handler.
 *
 * Job in FinSight:
 *   - Refresh the Supabase session cookie on every request so tokens stay
 *     fresh and the user doesn't get logged out mid-session.
 *   - Redirect unauthenticated users away from app routes to /login.
 *   - Redirect already-authenticated users away from /login back to /.
 *
 * Routes are filtered via the `config.matcher` at the bottom — static
 * assets, the Next internals, and the auth/* routes are exempt so the
 * proxy never runs on requests that don't need it.
 *
 * Do NOT do slow work here. Per Next 16 docs: Proxy is for optimistic
 * checks, not full session management. Heavy lifting (firm lookups,
 * role checks) belongs in Server Components / Route Handlers.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseProxyClient } from '@/lib/supabase/proxy-client';

// Public routes — anyone can hit these whether logged in or not.
const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/signout'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request: NextRequest) {
  const { supabase, response } = createSupabaseProxyClient(request);

  // Refresh session if expired. getUser() validates the JWT against
  // Supabase and rewrites the cookie on the response when it's been
  // rotated.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublic = isPublicPath(pathname);

  // Not logged in + private route → redirect to /login with a `next` param
  // so we can bounce them back after they sign in.
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Logged in + /login → bounce them to home (or `next` param if present).
  if (user && pathname === '/login') {
    const next = request.nextUrl.searchParams.get('next') || '/';
    const url = request.nextUrl.clone();
    url.pathname = next.startsWith('/') ? next : '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on everything EXCEPT static assets, Next internals, favicon, and
  // the workspace JSON/PDF export routes (those should serve regardless
  // — though after Phase 2 they'll need auth too).
  matcher: [
    /*
     * Match everything except:
     *  - _next/static (build assets)
     *  - _next/image (image optimization)
     *  - favicon.ico
     *  - file extensions (images, fonts, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)',
  ],
};
