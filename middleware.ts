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
import { sanitizeNext } from '@/lib/safe-next';

// Public routes — anyone can hit these whether logged in or not.
// The Stripe webhook MUST be public: Stripe posts to it with no session, so it
// can't be redirected to /login (signature verification is its auth).
const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/signout', '/api/stripe/webhook', '/legal'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request: NextRequest) {
  const { supabase, getResponse } = createSupabaseProxyClient(request);

  // Refresh session if expired. getUser() validates the JWT against
  // Supabase and rewrites the cookie on the response when it's been
  // rotated.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublic = isPublicPath(pathname);

  // getUser() may have rotated the session mid-flight; any response we return
  // — including redirects — must carry those cookie writes, or the browser
  // keeps a burned refresh token and gets bounced to /login on every page.
  const withAuthCookies = (res: NextResponse): NextResponse => {
    getResponse()
      .cookies.getAll()
      .forEach((cookie) => res.cookies.set(cookie));
    return res;
  };

  // Not logged in + private route → redirect to /login with a `next` param
  // so we can bounce them back after they sign in.
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return withAuthCookies(NextResponse.redirect(url));
  }

  // Logged in + /login → bounce them to home (or `next` param if present).
  // sanitizeNext: assigning to url.pathname is origin-preserving already,
  // but route every `next` through the one shared rule (defense in depth).
  if (user && pathname === '/login') {
    const next = sanitizeNext(request.nextUrl.searchParams.get('next'));
    const url = request.nextUrl.clone();
    url.pathname = next;
    url.search = '';
    return withAuthCookies(NextResponse.redirect(url));
  }

  // IMPORTANT: read via getResponse() AFTER getUser() — a snapshot taken
  // before the auth call is the exact bug this fixes.
  return getResponse();
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
