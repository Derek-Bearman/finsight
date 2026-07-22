/**
 * Mock QBO CompanyInfo endpoint (dev-only; 404 outside mock mode). Mirrors
 * `GET /v3/company/<realmId>/companyinfo/<id>` — api.ts calls it with
 * id === realmId. Company name resolves by realm (mock-data.ts).
 */

import type { NextRequest } from 'next/server';
import { isMockEnabled, mockCompanyName } from '@/lib/qbo/mock-data';

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ realmId: string; id: string }> }
): Promise<Response> {
  if (!isMockEnabled()) return new Response('Not found', { status: 404 });

  const { realmId } = await ctx.params;
  const name = mockCompanyName(realmId);
  if (!name) {
    return Response.json(
      { Fault: { Error: [{ Message: `Unknown mock realm ${realmId}` }], type: 'ValidationFault' } },
      { status: 400 }
    );
  }
  return Response.json({ CompanyInfo: { CompanyName: name } });
}
