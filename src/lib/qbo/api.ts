/**
 * Thin QBO data-fetch layer with a FULLY INJECTED context — no imports from
 * config.ts/oauth.ts (those belong to the OAuth layer being built separately).
 * The caller supplies base URL, realm, token getters, and (optionally) a fetch
 * implementation, which also makes every path unit-testable with a fake fetch.
 *
 * Behavior (plan §1 "Data API"):
 *  - every request carries minorversion=75, Bearer auth, Accept: application/json
 *  - 401 → onUnauthorized() ONCE for a fresh token, then a single retry
 *  - 429/5xx → up to 3 retries, exponential backoff (250 ms base + jitter),
 *    honoring Retry-After (seconds) when present
 *  - anything else non-2xx → QboApiError { status, bodyText, intuitTid }
 */

import type { QboAccount, QboCompanyInfo, QboReport } from './qbo-types';

// ─────────────────────────────────────────────
// Context + error types
// ─────────────────────────────────────────────

export interface QboApiContext {
  /** e.g. "https://sandbox-quickbooks.api.intuit.com/v3" — no trailing slash. */
  baseUrl: string;
  realmId: string;
  /** Returns the current access token (decrypting/loading as needed). */
  getAccessToken: () => Promise<string>;
  /**
   * Called at most once per request when QBO answers 401: refresh and return
   * a FRESH access token. Omit to fail fast on 401 (e.g. in mock mode).
   */
  onUnauthorized?: () => Promise<string>;
  /** Injectable fetch for tests/mocks; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export class QboApiError extends Error {
  readonly status: number;
  readonly bodyText: string;
  /** Intuit's per-request trace id (intuit_tid header) — quote it to support. */
  readonly intuitTid: string | null;

  constructor(status: number, bodyText: string, intuitTid: string | null) {
    super(
      `QBO API error ${status}${intuitTid ? ` (intuit_tid ${intuitTid})` : ''}: ${bodyText.slice(0, 300)}`
    );
    this.name = 'QboApiError';
    this.status = status;
    this.bodyText = bodyText;
    this.intuitTid = intuitTid;
  }
}

// ─────────────────────────────────────────────
// Internal GET with retry/backoff
// ─────────────────────────────────────────────

const MINOR_VERSION = '75';
const MAX_BACKOFF_RETRIES = 3;
const BACKOFF_BASE_MS = 250;
const BACKOFF_JITTER_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function qboGet(
  ctx: QboApiContext,
  path: string,
  params?: Record<string, string>
): Promise<unknown> {
  const doFetch: typeof fetch = ctx.fetchImpl ?? ((...args) => fetch(...args));

  const url = new URL(`${ctx.baseUrl}/company/${ctx.realmId}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('minorversion', MINOR_VERSION);

  let token = await ctx.getAccessToken();
  let refreshed = false;
  let backoffAttempt = 0;

  for (;;) {
    const res = await doFetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (res.ok) {
      return (await res.json()) as unknown;
    }

    // 401: refresh once, retry once. A second 401 falls through and throws.
    if (res.status === 401 && !refreshed && ctx.onUnauthorized) {
      refreshed = true;
      token = await ctx.onUnauthorized();
      continue;
    }

    // 429 (ThrottleExceeded) / 5xx: exponential backoff, honoring Retry-After.
    if ((res.status === 429 || res.status >= 500) && backoffAttempt < MAX_BACKOFF_RETRIES) {
      const retryAfter = res.headers.get('Retry-After');
      const retryAfterSec = retryAfter !== null ? Number(retryAfter) : NaN;
      const delayMs =
        Number.isFinite(retryAfterSec) && retryAfterSec >= 0
          ? retryAfterSec * 1000
          : BACKOFF_BASE_MS * 2 ** backoffAttempt + Math.random() * BACKOFF_JITTER_MS;
      backoffAttempt++;
      await sleep(delayMs);
      continue;
    }

    const bodyText = await res.text().catch(() => '');
    throw new QboApiError(res.status, bodyText, res.headers.get('intuit_tid'));
  }
}

// ─────────────────────────────────────────────
// Public fetchers
// ─────────────────────────────────────────────

export async function fetchCompanyInfo(ctx: QboApiContext): Promise<QboCompanyInfo> {
  const json = (await qboGet(ctx, `/companyinfo/${ctx.realmId}`)) as {
    CompanyInfo?: QboCompanyInfo;
  };
  if (!json.CompanyInfo) {
    throw new QboApiError(200, 'CompanyInfo missing from response', null);
  }
  return json.CompanyInfo;
}

const COA_PAGE_SIZE = 1000;
const COA_MAX_PAGES = 100; // loop guard — 100k accounts is beyond any real company

/**
 * Full chart of accounts, INCLUDING inactive accounts (old report lines map to
 * now-inactive accounts), paginated 1000/page until a short page.
 */
export async function fetchChartOfAccounts(ctx: QboApiContext): Promise<QboAccount[]> {
  const all: QboAccount[] = [];
  let startPosition = 1;
  for (let page = 0; page < COA_MAX_PAGES; page++) {
    const query = `SELECT * FROM Account WHERE Active IN (true, false) STARTPOSITION ${startPosition} MAXRESULTS ${COA_PAGE_SIZE}`;
    const json = (await qboGet(ctx, '/query', { query })) as {
      QueryResponse?: { Account?: QboAccount[] };
    };
    const batch = json.QueryResponse?.Account ?? [];
    all.push(...batch);
    if (batch.length < COA_PAGE_SIZE) return all;
    startPosition += COA_PAGE_SIZE;
  }
  throw new QboApiError(508, `Chart of accounts pagination exceeded ${COA_MAX_PAGES} pages`, null);
}

export interface QboReportPeriodOptions {
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  accountingMethod?: 'Accrual' | 'Cash';
}

function reportParams(opts: QboReportPeriodOptions): Record<string, string> {
  return {
    start_date: opts.startDate,
    end_date: opts.endDate,
    summarize_column_by: 'Month',
    accounting_method: opts.accountingMethod ?? 'Accrual',
  };
}

/** Monthly P&L for one date range (chunk one year per call — plan §1). */
export async function fetchProfitAndLossMonthly(
  ctx: QboApiContext,
  opts: QboReportPeriodOptions
): Promise<QboReport> {
  return (await qboGet(ctx, '/reports/ProfitAndLoss', reportParams(opts))) as QboReport;
}

/** Monthly Balance Sheet (cells are month-END balances) for one date range. */
export async function fetchBalanceSheetMonthly(
  ctx: QboApiContext,
  opts: QboReportPeriodOptions
): Promise<QboReport> {
  return (await qboGet(ctx, '/reports/BalanceSheet', reportParams(opts))) as QboReport;
}
