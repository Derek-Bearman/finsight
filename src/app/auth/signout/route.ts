/**
 * Sign-out handler.
 *
 * POST /auth/signout
 *   - Clears the Supabase session cookie.
 *   - Redirects to /login.
 *
 * Implemented as POST (not GET) so it can't be triggered by a malicious
 * <img src> tag or pre-fetch — only an explicit form submission.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url, { status: 303 });
}
