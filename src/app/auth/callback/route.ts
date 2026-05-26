/**
 * Magic-link callback handler.
 *
 * Flow:
 *   1. User clicks the magic link in their email.
 *   2. Supabase redirects them here with `?code=...&next=...`
 *   3. We exchange the code for a session (sets HTTP-only cookies).
 *   4. Redirect to the `next` path (or /).
 *
 * If the exchange fails (expired link, wrong project, etc.), bounce back
 * to /login with the error in the query string so the user sees it.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';

  if (!code) {
    const failUrl = url.clone();
    failUrl.pathname = '/login';
    failUrl.search = '';
    failUrl.searchParams.set('error_description', 'Missing auth code in callback URL.');
    return NextResponse.redirect(failUrl);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const failUrl = url.clone();
    failUrl.pathname = '/login';
    failUrl.search = '';
    failUrl.searchParams.set('error_description', error.message);
    return NextResponse.redirect(failUrl);
  }

  // Success — bounce to the originally-requested path (or /).
  const successUrl = url.clone();
  successUrl.pathname = next.startsWith('/') ? next : '/';
  successUrl.search = '';
  return NextResponse.redirect(successUrl);
}
