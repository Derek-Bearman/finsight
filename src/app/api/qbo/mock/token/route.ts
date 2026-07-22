/**
 * Mock Intuit token endpoint (dev-only; 404 outside mock mode). POST,
 * form-encoded, both grants — mirrors the real endpoint's contract closely
 * enough that oauth.ts needs zero special-casing:
 *   authorization_code → counter-1 token pair
 *   refresh_token      → ROTATED pair (counter parsed from the incoming
 *                        token + 1 — stateless, observable rotation)
 *   anything else      → 400, Intuit-shaped error JSON
 */

import type { NextRequest } from 'next/server';
import { isMockEnabled, mintTokensFromCode, rotateTokens } from '@/lib/qbo/mock-data';

export async function POST(request: NextRequest): Promise<Response> {
  if (!isMockEnabled()) return new Response('Not found', { status: 404 });

  const form = new URLSearchParams(await request.text());
  const grantType = form.get('grant_type');

  if (grantType === 'authorization_code') {
    const tokens = mintTokensFromCode(form.get('code') ?? '');
    if (!tokens) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json(tokens);
  }

  if (grantType === 'refresh_token') {
    const tokens = rotateTokens(form.get('refresh_token') ?? '');
    if (!tokens) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json(tokens);
  }

  return Response.json({ error: 'unsupported_grant_type' }, { status: 400 });
}
