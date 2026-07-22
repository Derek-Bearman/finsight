/**
 * Shared logic for the dev-only mock Intuit (/api/qbo/mock/*) — pure helpers
 * plus static fixture wiring, kept OUT of the route files so the routes stay
 * thin and the check suite can exercise the behavior headlessly.
 *
 * Determinism rules (plan §2.10):
 *  - Zero state: the token "counter" is parsed out of the incoming token
 *    string and incremented, so rotation is observable across calls without
 *    any storage (mock-rt-3 → mock-rt-4).
 *  - Fixtures are STATIC imports (bundler-safe on Workers — no fs at
 *    runtime); report fixtures are picked by the requested start_date year,
 *    with unknown years served as a valid empty NoReportData envelope.
 *  - isMockEnabled() gates every mock route: anything but an explicit
 *    mockMode=true (including missing QBO env entirely) reads as DISABLED, so
 *    production serves 404s even when QBO secrets were never set.
 */

import { getQboEnv } from './config';
import type { QboReport } from './qbo-types';
import coaFixture from './fixtures/coa.json';
import pnl2024 from './fixtures/pnl-2024.json';
import pnl2025 from './fixtures/pnl-2025.json';
import bs2024 from './fixtures/bs-2024.json';
import bs2025 from './fixtures/bs-2025.json';

/** Prod-safety gate for every mock route. getQboEnv() throwing (QBO env not
 *  configured at all — e.g. live prod before Derek's runbook steps) counts as
 *  disabled, never as an error. */
export function isMockEnabled(): boolean {
  try {
    return getQboEnv().mockMode;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// Companies
// ─────────────────────────────────────────────

export interface MockCompany {
  realmId: string;
  name: string;
}

export const MOCK_COMPANIES: MockCompany[] = [
  { realmId: '9130001', name: 'Bella Roma Pizza #42 (mock)' },
  { realmId: '9130002', name: 'Second Mock Co' },
];

export function mockCompanyName(realmId: string): string | null {
  return MOCK_COMPANIES.find((c) => c.realmId === realmId)?.name ?? null;
}

export function mockAuthCode(realmId: string): string {
  return `mock-code-${realmId}`;
}

// ─────────────────────────────────────────────
// Tokens (stateless rotation counter)
// ─────────────────────────────────────────────

/** Mirrors Intuit's token payload shape (oauth.ts parses these fields). */
export interface MockTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  x_refresh_token_hard_expires_in: number;
  token_type: 'bearer';
}

function tokenResponse(counter: number): MockTokenResponse {
  return {
    access_token: `mock-at-${counter}`,
    refresh_token: `mock-rt-${counter}`,
    expires_in: 3600, // 1h, like the real thing
    x_refresh_token_expires_in: 8640000, // 100 days rolling
    x_refresh_token_hard_expires_in: 157680000, // 5-year hard cap
    token_type: 'bearer',
  };
}

/** authorization_code grant: any code minted by the authorize page
 *  ("mock-code-<realm>") starts the token family at counter 1. Unknown codes
 *  → null (the route answers 400 invalid_grant, like Intuit). */
export function mintTokensFromCode(code: string): MockTokenResponse | null {
  if (!/^mock-code-\d+$/.test(code)) return null;
  return tokenResponse(1);
}

/** refresh_token grant: parse the counter from the incoming token and hand
 *  back a ROTATED pair (n+1) — both tokens change, exactly like Intuit's
 *  ~24h rotation. Unknown token shapes → null (400 invalid_grant). */
export function rotateTokens(refreshToken: string): MockTokenResponse | null {
  const m = refreshToken.match(/^mock-rt-(\d+)$/);
  if (!m) return null;
  return tokenResponse(parseInt(m[1]!, 10) + 1);
}

// ─────────────────────────────────────────────
// Data API fixtures
// ─────────────────────────────────────────────

/** The /query chart-of-accounts envelope, exactly as the fixture ships. */
export function coaEnvelope(): unknown {
  return coaFixture;
}

/** A valid, well-formed "nothing in this range" report — what Intuit returns
 *  for date ranges with no data (Header Option NoReportData=true). */
export function emptyReportEnvelope(
  kind: 'pnl' | 'bs',
  startDate: string,
  endDate: string
): QboReport {
  return {
    Header: {
      ReportName: kind === 'pnl' ? 'ProfitAndLoss' : 'BalanceSheet',
      StartPeriod: startDate,
      EndPeriod: endDate,
      SummarizeColumnsBy: 'Month',
      Currency: 'USD',
      Option: [
        { Name: 'AccountingMethod', Value: 'Accrual' },
        { Name: 'NoReportData', Value: 'true' },
      ],
    },
    Columns: { Column: [{ ColTitle: '', ColType: 'Account' }] },
    Rows: { Row: [] },
  };
}

const REPORT_FIXTURES: Record<'pnl' | 'bs', Record<number, unknown>> = {
  pnl: { 2024: pnl2024, 2025: pnl2025 },
  bs: { 2024: bs2024, 2025: bs2025 },
};

/** Pick the report fixture by the requested start_date's year: 2024/2025 have
 *  full fixture data; any other year gets the empty NoReportData envelope. */
export function pickReportFixture(
  kind: 'pnl' | 'bs',
  startDate: string,
  endDate: string
): QboReport {
  const year = parseInt(startDate.slice(0, 4), 10);
  const fixture = REPORT_FIXTURES[kind][year];
  if (fixture) return fixture as QboReport;
  return emptyReportEnvelope(kind, startDate, endDate);
}

// ─────────────────────────────────────────────
// Authorize page (mock consent screen)
// ─────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The mock "Mock Intuit — choose a company" consent page. Each company link
 * 302s (via plain navigation) back to
 * `redirect_uri?code=mock-code-<realm>&state=<state>&realmId=<realm>`.
 * The incoming state is echoed EXACTLY (URL-encoded in the href, decoded back
 * to the identical string by the callback's searchParams.get).
 */
export function authorizePageHtml(redirectUri: string, state: string): string {
  const links = MOCK_COMPANIES.map((company) => {
    const target = new URL(redirectUri);
    target.searchParams.set('code', mockAuthCode(company.realmId));
    target.searchParams.set('state', state);
    target.searchParams.set('realmId', company.realmId);
    return `<a class="company" href="${escapeHtml(target.toString())}">${escapeHtml(company.name)}<span class="realm">realm ${escapeHtml(company.realmId)}</span></a>`;
  }).join('\n      ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mock Intuit — choose a company</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #f6f7f9; color: #1a1c20; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      main { background: #fff; border: 1px solid #e2e5ea; border-radius: 12px; padding: 32px; max-width: 420px; width: 100%; box-shadow: 0 4px 16px rgba(20, 24, 32, 0.06); }
      h1 { font-size: 18px; margin: 0 0 4px; }
      p { margin: 0 0 20px; color: #5a6070; font-size: 14px; }
      .company { display: block; padding: 14px 16px; margin-bottom: 10px; border: 1px solid #d5d9e0; border-radius: 8px; text-decoration: none; color: #1a1c20; font-weight: 600; font-size: 15px; }
      .company:hover { border-color: #6b7280; background: #f9fafb; }
      .realm { display: block; font-weight: 400; font-size: 12px; color: #8a90a0; margin-top: 2px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Mock Intuit — choose a company</h1>
      <p>Dev-only stand-in for the QuickBooks consent screen. Pick a company to authorize.</p>
      ${links}
    </main>
  </body>
</html>`;
}
