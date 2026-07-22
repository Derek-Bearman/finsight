/**
 * Mock QBO /query endpoint (dev-only; 404 outside mock mode). The api layer
 * only ever queries the Account entity (chart of accounts, paginated), so
 * this serves the coa.json fixture envelope regardless of the query text.
 * The fixture is one short page (< MAXRESULTS), which ends api.ts's
 * pagination loop after a single call.
 */

import { coaEnvelope, isMockEnabled } from '@/lib/qbo/mock-data';

export async function GET(): Promise<Response> {
  if (!isMockEnabled()) return new Response('Not found', { status: 404 });
  return Response.json(coaEnvelope());
}
