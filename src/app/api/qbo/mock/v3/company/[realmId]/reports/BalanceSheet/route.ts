/**
 * Mock QBO monthly Balance Sheet report (dev-only; 404 outside mock mode).
 * Fixture picked by the requested start_date's year — 2024/2025 have real
 * fixture data; other years serve a valid empty NoReportData envelope.
 */

import type { NextRequest } from 'next/server';
import { isMockEnabled, pickReportFixture } from '@/lib/qbo/mock-data';

export async function GET(request: NextRequest): Promise<Response> {
  if (!isMockEnabled()) return new Response('Not found', { status: 404 });

  const params = request.nextUrl.searchParams;
  const startDate = params.get('start_date') ?? '';
  const endDate = params.get('end_date') ?? '';
  return Response.json(pickReportFixture('bs', startDate, endDate));
}
