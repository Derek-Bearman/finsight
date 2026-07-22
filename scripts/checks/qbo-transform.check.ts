/**
 * QBO transform + api-layer checks:
 *   npx tsx scripts/checks/qbo-transform.check.ts
 *
 * Transform: fixture COA + monthly P&L/BS reports → FinSight accounts/values
 * (structural summary-row skipping, parent-account sections, period mapping,
 * COGS mapping, warnings). Integration: idempotent re-transform diffs
 * 'identical' via diffImport; the restated-2024 fixture diffs 'conflicts'
 * with exactly one changed cell. Api: fake-fetch unit checks for pagination,
 * minorversion, 401-refresh-once, 429/5xx backoff, and QboApiError shape.
 */

import type { Account } from '../../src/types';
import { transformQboData, type QboTransformResult } from '../../src/lib/qbo/transform';
import {
  fetchBalanceSheetMonthly,
  fetchChartOfAccounts,
  fetchCompanyInfo,
  fetchProfitAndLossMonthly,
  QboApiError,
  type QboApiContext,
} from '../../src/lib/qbo/api';
import type { QboAccount, QboReport } from '../../src/lib/qbo/qbo-types';
import { diffImport } from '../../src/lib/data/datasets';

import coaJson from '../../src/lib/qbo/fixtures/coa.json';
import pnl2024Json from '../../src/lib/qbo/fixtures/pnl-2024.json';
import pnl2025Json from '../../src/lib/qbo/fixtures/pnl-2025.json';
import bs2024Json from '../../src/lib/qbo/fixtures/bs-2024.json';
import bs2025Json from '../../src/lib/qbo/fixtures/bs-2025.json';
import restatedPnl2024Json from '../../src/lib/qbo/fixtures/restated-pnl-2024.json';

let failures = 0;
let total = 0;
function check(cond: boolean, label: string): void {
  total++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

const coa = coaJson.QueryResponse.Account as unknown as QboAccount[];
const pnl2024 = pnl2024Json as unknown as QboReport;
const pnl2025 = pnl2025Json as unknown as QboReport;
const bs2024 = bs2024Json as unknown as QboReport;
const bs2025 = bs2025Json as unknown as QboReport;
const restatedPnl2024 = restatedPnl2024Json as unknown as QboReport;

const byName = (res: QboTransformResult, name: string): Account | undefined =>
  res.accounts.find((a) => a.name === name);
const val = (res: QboTransformResult, name: string, year: number, month: number): number | undefined => {
  const a = byName(res, name);
  if (!a) return undefined;
  return res.values.find(
    (v) => v.accountId === a.id && v.period.year === year && v.period.month === month
  )?.amount;
};

// ═════════════════════════════════════════════════════════════════════════════
// Transform checks
// ═════════════════════════════════════════════════════════════════════════════

const res = transformQboData({
  coa,
  pnlReports: [pnl2024, pnl2025],
  bsReports: [bs2024, bs2025],
});

// ── Account inventory ─────────────────────────────────────────────────────────
// 30 COA accounts, minus 1 with no report rows (Owner Draws), plus 1 non-COA
// report row (Merchant Fees) = 30.
check(res.accounts.length === 30, `expected 30 accounts, got ${res.accounts.length}`);
check(res.values.length === 516, `expected 516 values, got ${res.values.length}`);
check(
  res.accounts.every((a) => typeof a.externalId === 'string' && a.externalId.length > 0),
  'every account carries externalId'
);
check(
  res.accounts.every((a) => a.id === `qbo-${a.externalId}`),
  'internal ids are stable qbo-<Id>'
);
check(
  res.accounts.every(
    (a) => a.isManuallyClassified === true && a.classificationSource === 'manual' && a.detectedSection === a.type
  ),
  'every account: isManuallyClassified, classificationSource manual, detectedSection === type'
);
check(byName(res, 'Owner Draws') === undefined, 'COA account with no report rows is NOT emitted');

// ── Classification mapping (incl. cogs via AccountType) ───────────────────────
check(byName(res, 'Green Coffee Purchases')?.type === 'cogs', 'AccountType "Cost of Goods Sold" → cogs');
check(byName(res, 'Freight In')?.type === 'cogs', 'numberless COGS account → cogs');
check(byName(res, 'Retail Sales')?.type === 'revenue', 'Classification Revenue → revenue');
check(byName(res, 'Rent')?.type === 'expense', 'Classification Expense → expense');
check(byName(res, 'Checking')?.type === 'asset', 'Classification Asset → asset');
check(byName(res, 'Accounts Payable')?.type === 'liability', 'Classification Liability → liability');
check(byName(res, "Owner's Equity")?.type === 'equity', 'Classification Equity → equity');
check(byName(res, 'Shipping Income')?.number === undefined, 'account without AcctNum has no number');
check(byName(res, 'Wages')?.number === '6010', 'AcctNum carries through as number');
check(byName(res, 'Retail Sales')?.name === 'Retail Sales', 'name is Name, not FullyQualifiedName');
check(byName(res, 'Rent')?.costBehavior === 'fixed', 'cost behavior via baseline classifier (Rent → fixed)');
check(byName(res, 'Utilities')?.costBehavior === 'mixed', 'cost behavior via baseline classifier (Utilities → mixed)');

// ── Structural summary skipping: trap account survives, summaries do not ──────
const trapAccounts = res.accounts.filter((a) => a.name === 'Total Income');
check(trapAccounts.length === 1, `genuine "Total Income" account survives exactly once, got ${trapAccounts.length}`);
check(trapAccounts[0]?.number === '4900' && trapAccounts[0]?.type === 'revenue', 'trap account keeps its COA identity');
check(val(res, 'Total Income', 2024, 4) === 250, 'trap account carries its OWN 250, not the section-summary sum');
check(
  res.values.filter((v) => v.accountId === trapAccounts[0]?.id).length === 18,
  'trap account has 18 monthly values (12 + 6)'
);
for (const summaryName of ['Gross Profit', 'Net Income', 'Net Operating Income', 'Total Expenses', 'Total Cost of Goods Sold', 'Total Payroll', 'TOTAL ASSETS', 'Total Equity']) {
  check(byName(res, summaryName) === undefined, `summary row "${summaryName}" produced NO account`);
}

// ── Sub-account parent wiring ─────────────────────────────────────────────────
const payroll = byName(res, 'Payroll');
check(payroll !== undefined, 'parent account Payroll exists');
check(byName(res, 'Wages')?.parentId === payroll?.id, 'Wages.parentId → Payroll');
check(byName(res, 'Payroll Taxes')?.parentId === payroll?.id, 'Payroll Taxes.parentId → Payroll');
check(byName(res, 'Rent')?.parentId === undefined, 'non-sub-account has no parentId');

// ── Parent-account own amounts: header-row variant (2024) + data-row variant (2025)
check(val(res, 'Payroll', 2024, 5) === 500, `Payroll direct (header-row variant) May 2024 = 500, got ${val(res, 'Payroll', 2024, 5)}`);
check(val(res, 'Payroll', 2025, 2) === 650, `Payroll direct (data-row variant) Feb 2025 = 650, got ${val(res, 'Payroll', 2025, 2)}`);
check(val(res, 'Wages', 2024, 1) === 9600, `Wages Jan 2024 = 9600, got ${val(res, 'Wages', 2024, 1)}`);

// ── Inactive account history ──────────────────────────────────────────────────
const service = byName(res, 'Service Revenue');
check(service !== undefined, 'inactive COA account with history is emitted');
const serviceVals = res.values.filter((v) => v.accountId === service?.id);
check(serviceVals.length === 6, `inactive account has 6 values (Jan–Jun 2024), got ${serviceVals.length}`);
check(
  serviceVals.every((v) => v.period.year === 2024 && v.period.month <= 6 && v.amount === 2000),
  'inactive account values are the Jan–Jun 2024 history'
);

// ── Monthly period mapping spot checks (P&L) ──────────────────────────────────
check(val(res, 'Retail Sales', 2024, 3) === 31500, `Retail Sales Mar 2024 = 31500, got ${val(res, 'Retail Sales', 2024, 3)}`);
check(val(res, 'Retail Sales', 2025, 6) === 39000, `Retail Sales Jun 2025 = 39000, got ${val(res, 'Retail Sales', 2025, 6)}`);
check(val(res, 'Marketing', 2024, 3) === 1800, `Marketing Mar 2024 = 1800, got ${val(res, 'Marketing', 2024, 3)}`);
check(val(res, 'Merchant Fees', 2025, 2) === 374, `Merchant Fees Feb 2025 = 374, got ${val(res, 'Merchant Fees', 2025, 2)}`);
check(val(res, 'Retail Sales', 2024, 13) === undefined, 'no phantom 13th month from the Total column');

// ── BS cells are month-END balances, imported as-is ───────────────────────────
check(val(res, 'Checking', 2024, 1) === 41500, `Checking Jan 2024 = 41500, got ${val(res, 'Checking', 2024, 1)}`);
check(val(res, 'Checking', 2024, 2) === 43000, 'Checking Feb 2024 = 43000 (as-of balance, not a delta)');
check(val(res, 'Checking', 2025, 3) === 62500, `Checking Mar 2025 = 62500, got ${val(res, 'Checking', 2025, 3)}`);
check(val(res, 'Accumulated Depreciation', 2024, 6) === -16200, `Accum. Depreciation Jun 2024 = -16200, got ${val(res, 'Accumulated Depreciation', 2024, 6)}`);
check(byName(res, 'Net Income') === undefined, "BS computed 'Net Income' data row (no id) produced NO account");

// ── Explicit zero cells kept ──────────────────────────────────────────────────
check(val(res, 'Office Supplies', 2024, 2) === 0, 'explicit "0.00" cell imports as a real 0 value');

// ── Non-COA report row: built from name + section path, with warning ──────────
const merchant = byName(res, 'Merchant Fees');
check(merchant?.type === 'expense' && merchant.externalId === '99', 'non-COA row classified from its report section');
check(
  res.warnings.some((w) => w.includes('Merchant Fees') && w.includes('not in the chart of accounts')),
  'warning emitted for the non-COA report row'
);
check(
  res.warnings.some((w) => w.includes('1 chart-of-accounts account(s)')),
  'warning notes the count of COA accounts with no report data'
);
check(res.warnings.length === 2, `exactly 2 warnings expected on the clean fixture set, got ${res.warnings.length}: ${JSON.stringify(res.warnings)}`);

// ── Parent amounts on BOTH header and data row in one report → data wins + warn
{
  const mini = {
    Header: { ReportName: 'ProfitAndLoss', StartPeriod: '2024-01-01', EndPeriod: '2024-02-29' },
    Columns: {
      Column: [
        { ColTitle: '', ColType: 'Account' },
        { ColTitle: 'Jan 2024', ColType: 'Money' }, // no MetaData → ColTitle fallback path
        { ColTitle: 'Feb 2024', ColType: 'Money' },
        { ColTitle: 'Total', ColType: 'Money' },
      ],
    },
    Rows: {
      Row: [
        {
          type: 'Section',
          group: 'Expenses',
          Header: { ColData: [{ value: 'Expenses' }, { value: '' }, { value: '' }, { value: '' }] },
          Rows: {
            Row: [
              {
                type: 'Section',
                Header: { ColData: [{ value: 'Payroll', id: '30' }, { value: '111.00' }, { value: '112.00' }, { value: '223.00' }] },
                Rows: {
                  Row: [
                    { type: 'Data', ColData: [{ value: 'Payroll', id: '30' }, { value: '555.00' }, { value: '556.00' }, { value: '1111.00' }] },
                    { type: 'Data', ColData: [{ value: 'Wages', id: '31' }, { value: '900.00' }, { value: '901.00' }, { value: '1801.00' }] },
                  ],
                },
                Summary: { ColData: [{ value: 'Total Payroll' }, { value: '1566.00' }, { value: '1569.00' }, { value: '3135.00' }] },
              },
            ],
          },
          Summary: { ColData: [{ value: 'Total Expenses' }, { value: '1566.00' }, { value: '1569.00' }, { value: '3135.00' }] },
        },
      ],
    },
  } as unknown as QboReport;
  const miniRes = transformQboData({ coa, pnlReports: [mini], bsReports: [] });
  check(val(miniRes, 'Payroll', 2024, 1) === 555 && val(miniRes, 'Payroll', 2024, 2) === 556, 'header+data conflict: Data row wins, no double count');
  check(
    miniRes.warnings.some((w) => w.includes('both its section header and a detail row')),
    'header+data conflict emits a warning'
  );
  check(val(miniRes, 'Wages', 2024, 1) === 900, 'ColTitle-only column mapping (no MetaData) works');
}

// ═════════════════════════════════════════════════════════════════════════════
// Integration with diffImport
// ═════════════════════════════════════════════════════════════════════════════

// Transform twice → byte-for-byte-equivalent data → 'identical'.
{
  const again = transformQboData({ coa, pnlReports: [pnl2024, pnl2025], bsReports: [bs2024, bs2025] });
  const diff = diffImport(res.accounts, res.values, again.accounts, again.values);
  check(diff.status === 'identical', `re-transform should diff 'identical', got ${diff.status}`);
  check(diff.changedCells.length === 0 && diff.newAccounts.length === 0, 're-transform: nothing changed or new');
}

// Restated 2024 swapped in → 'conflicts' with exactly the one restated cell.
{
  const restated = transformQboData({ coa, pnlReports: [restatedPnl2024, pnl2025], bsReports: [bs2024, bs2025] });
  const diff = diffImport(res.accounts, res.values, restated.accounts, restated.values);
  check(diff.status === 'conflicts', `restated import should diff 'conflicts', got ${diff.status}`);
  check(diff.changedCells.length === 1, `exactly 1 changed cell, got ${diff.changedCells.length}`);
  const cell = diff.changedCells[0];
  check(
    cell?.accountName === 'Marketing' && cell.period.year === 2024 && cell.period.month === 3,
    `changed cell is Marketing Mar 2024, got ${cell?.accountName} ${cell?.period.year}-${cell?.period.month}`
  );
  check(cell?.oldValue === 1800 && cell.newValue === 2400 && cell.delta === 600, 'restated cell 1800 → 2400 (Δ600)');
}

// Same account-period fed by two disagreeing reports → last report wins + warn.
{
  const merged = transformQboData({ coa, pnlReports: [pnl2024, restatedPnl2024], bsReports: [] });
  check(val(merged, 'Marketing', 2024, 3) === 2400, 'cross-report cell conflict: later report wins');
  const conflictWarnings = merged.warnings.filter((w) => w.includes("keeping the later report's value"));
  check(conflictWarnings.length === 1, `exactly 1 cross-report conflict warning, got ${conflictWarnings.length}`);
  check(conflictWarnings[0]?.includes('2024-03') === true, 'conflict warning names the period');
}

// ═════════════════════════════════════════════════════════════════════════════
// api.ts unit checks (injected fake fetch)
// ═════════════════════════════════════════════════════════════════════════════

interface FakeResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}
function makeFetch(responses: FakeResponse[]): { impl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({ url, headers });
    const next = responses.shift();
    if (!next) throw new Error('fake fetch: no responses left');
    return new Response(next.body === undefined ? '{}' : JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers,
    });
  }) as typeof fetch;
  return { impl, calls };
}
const makeCtx = (impl: typeof fetch, extra?: Partial<QboApiContext>): QboApiContext => ({
  baseUrl: 'https://sandbox-quickbooks.api.intuit.com/v3',
  realmId: '9130001',
  getAccessToken: async () => 'token-A',
  fetchImpl: impl,
  ...extra,
});
const fakeCoaAccount = (i: number): QboAccount => ({
  Id: String(i),
  Name: `Account ${i}`,
  AccountType: 'Expense',
  Classification: 'Expense',
  Active: true,
  SubAccount: false,
  FullyQualifiedName: `Account ${i}`,
});

async function apiChecks(): Promise<void> {
  // ── Pagination loop + minorversion + auth headers ───────────────────────────
  {
    const page1 = Array.from({ length: 1000 }, (_, i) => fakeCoaAccount(i + 1));
    const page2 = Array.from({ length: 5 }, (_, i) => fakeCoaAccount(1001 + i));
    const { impl, calls } = makeFetch([
      { status: 200, body: { QueryResponse: { Account: page1, startPosition: 1, maxResults: 1000 } } },
      { status: 200, body: { QueryResponse: { Account: page2, startPosition: 1001, maxResults: 5 } } },
    ]);
    const accounts = await fetchChartOfAccounts(makeCtx(impl));
    check(accounts.length === 1005, `pagination should return 1005 accounts, got ${accounts.length}`);
    check(calls.length === 2, `pagination should stop after a short page (2 calls), got ${calls.length}`);
    const q0 = new URL(calls[0]!.url).searchParams.get('query') ?? '';
    const q1 = new URL(calls[1]!.url).searchParams.get('query') ?? '';
    check(q0.includes('STARTPOSITION 1 MAXRESULTS 1000'), `first page starts at 1, got: ${q0}`);
    check(q1.includes('STARTPOSITION 1001 MAXRESULTS 1000'), `second page starts at 1001, got: ${q1}`);
    check(q0.includes('Active IN (true, false)'), 'query includes inactive accounts');
    check(
      calls.every((c) => new URL(c.url).searchParams.get('minorversion') === '75'),
      'minorversion=75 on every pagination call'
    );
    check(
      calls.every((c) => c.headers['authorization'] === 'Bearer token-A' && c.headers['accept'] === 'application/json'),
      'Bearer token + Accept header on every call'
    );
  }

  // ── companyinfo path + payload unwrap ───────────────────────────────────────
  {
    const { impl, calls } = makeFetch([
      { status: 200, body: { CompanyInfo: { CompanyName: 'Harbor Light Coffee Roasters', Country: 'US' } } },
    ]);
    const info = await fetchCompanyInfo(makeCtx(impl));
    check(info.CompanyName === 'Harbor Light Coffee Roasters', 'fetchCompanyInfo unwraps CompanyInfo');
    const u = new URL(calls[0]!.url);
    check(u.pathname === '/v3/company/9130001/companyinfo/9130001', `companyinfo path, got ${u.pathname}`);
    check(u.searchParams.get('minorversion') === '75', 'minorversion=75 on companyinfo');
  }

  // ── 401 → onUnauthorized ONCE, retry with the fresh token ───────────────────
  {
    let refreshes = 0;
    const { impl, calls } = makeFetch([
      { status: 401, body: { Fault: { Error: [{ Message: 'AuthenticationFailed' }] } } },
      { status: 200, body: { CompanyInfo: { CompanyName: 'After Refresh' } } },
    ]);
    const ctx = makeCtx(impl, {
      onUnauthorized: async () => {
        refreshes++;
        return 'token-B';
      },
    });
    const info = await fetchCompanyInfo(ctx);
    check(info.CompanyName === 'After Refresh', '401 then success returns the payload');
    check(refreshes === 1, `onUnauthorized called exactly once, got ${refreshes}`);
    check(calls[1]!.headers['authorization'] === 'Bearer token-B', 'retry uses the FRESH token');
  }
  {
    let refreshes = 0;
    const { impl, calls } = makeFetch([
      { status: 401, body: {} },
      { status: 401, body: {} },
    ]);
    const ctx = makeCtx(impl, {
      onUnauthorized: async () => {
        refreshes++;
        return 'token-B';
      },
    });
    let err: unknown;
    try {
      await fetchCompanyInfo(ctx);
    } catch (e) {
      err = e;
    }
    check(err instanceof QboApiError && err.status === 401, 'second 401 throws QboApiError(401)');
    check(refreshes === 1 && calls.length === 2, '401 refresh happens ONCE, not in a loop');
  }

  // ── 429 backoff (exponential, 250ms base) ───────────────────────────────────
  {
    const { impl, calls } = makeFetch([
      { status: 429, body: { Fault: { Error: [{ Message: 'ThrottleExceeded' }] } } },
      { status: 429, body: { Fault: { Error: [{ Message: 'ThrottleExceeded' }] } } },
      { status: 200, body: { CompanyInfo: { CompanyName: 'Throttled Then Fine' } } },
    ]);
    const t0 = Date.now();
    const info = await fetchCompanyInfo(makeCtx(impl));
    const elapsed = Date.now() - t0;
    check(info.CompanyName === 'Throttled Then Fine', '429s eventually succeed');
    check(calls.length === 3, `429 retried until success (3 calls), got ${calls.length}`);
    check(elapsed >= 700, `exponential backoff honored (>=750ms nominal for 250+500), elapsed ${elapsed}ms`);
  }

  // ── Retry-After honored ─────────────────────────────────────────────────────
  {
    const { impl, calls } = makeFetch([
      { status: 429, body: {}, headers: { 'Retry-After': '1' } },
      { status: 200, body: { CompanyInfo: { CompanyName: 'Waited' } } },
    ]);
    const t0 = Date.now();
    await fetchCompanyInfo(makeCtx(impl));
    const elapsed = Date.now() - t0;
    check(elapsed >= 900, `Retry-After: 1 waits ~1000ms, elapsed ${elapsed}ms`);
    check(calls.length === 2, '429 with Retry-After retried once then succeeded');
  }

  // ── 5xx: retried, then throws after 3 retries ───────────────────────────────
  {
    const { impl, calls } = makeFetch([
      { status: 502, body: {} },
      { status: 200, body: { CompanyInfo: { CompanyName: 'Recovered' } } },
    ]);
    const info = await fetchCompanyInfo(makeCtx(impl));
    check(info.CompanyName === 'Recovered' && calls.length === 2, '5xx retries and recovers');
  }
  {
    const { impl, calls } = makeFetch([
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
    ]);
    let err: unknown;
    try {
      await fetchCompanyInfo(makeCtx(impl));
    } catch (e) {
      err = e;
    }
    check(err instanceof QboApiError && err.status === 500, 'persistent 5xx throws QboApiError(500)');
    check(calls.length === 4, `initial call + 3 retries = 4 calls, got ${calls.length}`);
  }

  // ── QboApiError shape (status, bodyText, intuit_tid) ────────────────────────
  {
    const { impl } = makeFetch([
      {
        status: 400,
        body: { Fault: { Error: [{ Message: 'Invalid query' }] } },
        headers: { intuit_tid: 'tid-12345-abcde' },
      },
    ]);
    let err: unknown;
    try {
      await fetchChartOfAccounts(makeCtx(impl));
    } catch (e) {
      err = e;
    }
    check(err instanceof QboApiError, '400 throws QboApiError');
    if (err instanceof QboApiError) {
      check(err.status === 400, `error.status = 400, got ${err.status}`);
      check(err.bodyText.includes('Invalid query'), 'error.bodyText carries the response body');
      check(err.intuitTid === 'tid-12345-abcde', `error.intuitTid from the intuit_tid header, got ${err.intuitTid}`);
      check(err.message.includes('tid-12345-abcde'), 'error message quotes the intuit_tid for support');
    }
  }

  // ── Report fetchers: params + paths ─────────────────────────────────────────
  {
    const emptyReport = {
      Header: { ReportName: 'ProfitAndLoss', StartPeriod: '2024-01-01', EndPeriod: '2024-12-31' },
      Columns: { Column: [] },
      Rows: { Row: [] },
    };
    const { impl, calls } = makeFetch([
      { status: 200, body: emptyReport },
      { status: 200, body: { ...emptyReport, Header: { ...emptyReport.Header, ReportName: 'BalanceSheet' } } },
    ]);
    const ctx = makeCtx(impl);
    const pnl = await fetchProfitAndLossMonthly(ctx, { startDate: '2024-01-01', endDate: '2024-12-31' });
    const bs = await fetchBalanceSheetMonthly(ctx, { startDate: '2024-01-01', endDate: '2024-12-31', accountingMethod: 'Cash' });
    check(pnl.Header.ReportName === 'ProfitAndLoss' && bs.Header.ReportName === 'BalanceSheet', 'report fetchers return the report JSON');
    const u0 = new URL(calls[0]!.url);
    const u1 = new URL(calls[1]!.url);
    check(u0.pathname === '/v3/company/9130001/reports/ProfitAndLoss', `P&L path, got ${u0.pathname}`);
    check(u1.pathname === '/v3/company/9130001/reports/BalanceSheet', `BS path, got ${u1.pathname}`);
    check(
      u0.searchParams.get('start_date') === '2024-01-01' &&
        u0.searchParams.get('end_date') === '2024-12-31' &&
        u0.searchParams.get('summarize_column_by') === 'Month' &&
        u0.searchParams.get('accounting_method') === 'Accrual',
      'P&L params: dates + Month summary + default Accrual'
    );
    check(u1.searchParams.get('accounting_method') === 'Cash', 'accountingMethod option passes through');
    check(
      u0.searchParams.get('minorversion') === '75' && u1.searchParams.get('minorversion') === '75',
      'minorversion=75 on every report call'
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  await apiChecks();
  if (failures > 0) {
    console.error(`\n${failures} of ${total} QBO check(s) FAILED`);
    process.exit(1);
  }
  console.log(`All ${total} QBO transform/api checks passed.`);
}

main().catch((e) => {
  console.error('Check suite crashed:', e);
  process.exit(1);
});
