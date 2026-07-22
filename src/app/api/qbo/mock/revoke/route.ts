/**
 * Mock Intuit revocation endpoint (dev-only; 404 outside mock mode). The real
 * endpoint returns exactly 200 on success (oauth.ts revokeToken treats
 * anything else as failure) — so: 200, empty body.
 */

import { isMockEnabled } from '@/lib/qbo/mock-data';

export async function POST(): Promise<Response> {
  if (!isMockEnabled()) return new Response('Not found', { status: 404 });
  return new Response(null, { status: 200 });
}
