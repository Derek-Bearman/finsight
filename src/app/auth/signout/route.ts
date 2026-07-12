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
  // scope:'local' signs out THIS browser only. The default ('global')
  // revokes every refresh token for the user — which, for the shared
  // public demo account, would boot every other demo visitor mid-session.
  await supabase.auth.signOut({ scope: 'local' });

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url, { status: 303 });
}
