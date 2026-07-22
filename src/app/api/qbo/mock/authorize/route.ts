/**
 * Mock Intuit consent screen (dev-only; 404 outside mock mode). GET renders a
 * minimal "choose a company" page whose links navigate back to
 * `redirect_uri?code=mock-code-<realm>&state=<state>&realmId=<realm>`,
 * echoing the incoming state EXACTLY. Page + link building live in
 * src/lib/qbo/mock-data.ts (authorizePageHtml) so checks can cover them.
 */

import type { NextRequest } from 'next/server';
import { authorizePageHtml, isMockEnabled } from '@/lib/qbo/mock-data';

export async function GET(request: NextRequest): Promise<Response> {
  if (!isMockEnabled()) return new Response('Not found', { status: 404 });

  const params = request.nextUrl.searchParams;
  const redirectUri = params.get('redirect_uri');
  const state = params.get('state') ?? '';
  if (!redirectUri) return new Response('missing redirect_uri', { status: 400 });

  return new Response(authorizePageHtml(redirectUri, state), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
