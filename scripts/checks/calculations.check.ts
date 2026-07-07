/**
 * Calculation-engine checks, runnable headless:
 *   npx tsx scripts/checks/calculations.check.ts
 *
 * Runs every calc module's embedded runTests() (console.assert based) with a
 * strict harness that FAILS the process on any assertion, then adds
 * cross-module regressions for Account.isExcluded (QBO summary rows / manual
 * exclusions must never contribute to any calculation — audit fix A1).
 */

import type { Account, AccountValue } from '../../src/types';
import * as pnl from '../../src/lib/calculations/pnl';
import * as balanceSheet from '../../src/lib/calculations/balance-sheet';
import * as periodAgg from '../../src/lib/calculations/period-aggregation';
import * as breakeven from '../../src/lib/calculations/breakeven';
import * as efficiency from '../../src/lib/calculations/efficiency';
import * as profitability from '../../src/lib/calculations/profitability';
import * as health from '../../src/lib/calculations/health';
import { projectWorkspace } from '../../src/lib/projections/workspace-projections';
import { applyScenario, computeScenarioImpact, isOrphanedAdjustment } from '../../src/lib/scenarios/engine';

let failures = 0;
const realAssert = console.assert.bind(console);
console.assert = ((cond?: boolean, ...args: unknown[]) => {
  if (!cond) {
    failures++;
    realAssert(cond, ...args);
  }
}) as typeof console.assert;

// ── Module-embedded tests ────────────────────────────────────────────────────
pnl.runTests();
balanceSheet.runTests();
periodAgg.runTests();
breakeven.runTests();
efficiency.runTests();
profitability.runTests();
health.runTests();

// ── Cross-module isExcluded regressions ──────────────────────────────────────
const acc = (
  id: string,
  name: string,
  type: Account['type'],
  opts: Partial<Account> = {}
): Account => ({ id, name, type, isManuallyClassified: false, ...opts });

const val = (accountId: string, month: number, amount: number): AccountValue => ({
  accountId,
  period: { year: 2024, month },
  amount,
});

function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

// Balance sheet: an excluded summary row that LOOKS like a current asset
// (cash-range account number) must not inflate liquidity ratios.
{
  const accounts = [
    acc('cash', 'Cash', 'asset', { number: '1010' }),
    acc('ap', 'Accounts Payable', 'liability', { number: '2010' }),
    acc('chk', 'Total Cash', 'asset', { number: '1050', isExcluded: true }),
  ];
  const values = [val('cash', 1, 5000), val('ap', 1, 2000), val('chk', 1, 3000)];
  const r = balanceSheet.computeBalanceSheetRatios(accounts, values, { year: 2024, month: 1 });
  check(r.currentRatio === 2.5, `BS excluded row leaked: currentRatio ${r.currentRatio} != 2.5`);
  check(r.workingCapital === 3000, `BS excluded row leaked: workingCapital ${r.workingCapital} != 3000`);
}

// Projections: excluded accounts get no projection and don't roll up.
{
  const accounts = [
    acc('r1', 'Sales', 'revenue'),
    acc('gp', 'Gross Profit', 'revenue', { isExcluded: true }),
  ];
  const values = [
    val('r1', 1, 100), val('r1', 2, 110), val('r1', 3, 120), val('r1', 4, 130),
    val('gp', 1, 100), val('gp', 2, 110), val('gp', 3, 120), val('gp', 4, 130),
  ];
  const proj = projectWorkspace(accounts, values, { horizonMonths: 3 });
  check(
    !proj.accountProjections.some((p) => p.accountId === 'gp'),
    'projections: excluded account was projected'
  );
  const hist = proj.rolledUp.find((r) => r.period.month === 4 && !r.isProjected);
  check(
    hist !== undefined && hist.revenue === 130,
    `projections rollup: excluded revenue leaked (got ${hist?.revenue}, want 130)`
  );
}

// Scenarios: '_all_revenue_' sentinel must not touch excluded accounts.
{
  const accounts = [
    acc('r1', 'Sales', 'revenue'),
    acc('gp', 'Gross Profit', 'revenue', { isExcluded: true }),
  ];
  const values = [val('r1', 1, 100), val('gp', 1, 100)];
  const out = applyScenario(
    values,
    {
      id: 's1',
      name: 'Up 10%',
      adjustments: [
        { accountId: '_all_revenue_', type: 'percent', value: 10, appliesFrom: { year: 2024, month: 1 } },
      ],
      createdAt: new Date().toISOString(),
    },
    accounts
  );
  const r1 = out.find((v) => v.accountId === 'r1');
  const gp = out.find((v) => v.accountId === 'gp');
  check(r1 !== undefined && Math.abs(r1.amount - 110) < 1e-9, `scenario: active account not adjusted (${r1?.amount})`);
  check(gp !== undefined && gp.amount === 100, `scenario: excluded account was adjusted (${gp?.amount})`);
}

// Scenarios: an adjustment keyed to an account id that is not in the current
// accounts (dataset switch / re-import mints fresh ids) is ORPHANED — it must
// be flagged by the shared helper and excluded from calculation, while live
// ids and sentinels stay active.
{
  const accounts = [acc('imported-new-r1', 'Sales', 'revenue')];
  const values = [val('imported-new-r1', 1, 100)];
  const staleAdj = {
    accountId: 'imported-old-r1',
    type: 'percent' as const,
    value: 50,
    appliesFrom: { year: 2024, month: 1 },
  };
  const out = applyScenario(
    values,
    { id: 's2', name: 'Stale', adjustments: [staleAdj], createdAt: new Date().toISOString() },
    accounts
  );
  const r1 = out.find((v) => v.accountId === 'imported-new-r1');
  check(r1 !== undefined && r1.amount === 100, `scenario: orphaned adjustment changed values (${r1?.amount})`);
  check(isOrphanedAdjustment(staleAdj, accounts), 'scenario: stale account id not flagged orphaned');
  check(
    !isOrphanedAdjustment({ ...staleAdj, accountId: 'imported-new-r1' }, accounts),
    'scenario: live account id flagged orphaned'
  );
  check(
    !isOrphanedAdjustment({ ...staleAdj, accountId: '_all_revenue_' }, accounts),
    'scenario: sentinel flagged orphaned'
  );
}

// Breakeven: excluded rows out of both revenue (via computePnL) and costs.
{
  const accounts = [
    acc('r1', 'Sales', 'revenue'),
    acc('e1', 'Rent', 'expense', { costBehavior: 'fixed' }),
    acc('gp', 'Gross Profit', 'revenue', { isExcluded: true }),
    acc('oi', 'Operating Income', 'expense', { isExcluded: true, costBehavior: 'fixed' }),
  ];
  const values = [val('r1', 1, 10000), val('e1', 1, 2000), val('gp', 1, 10000), val('oi', 1, 8000)];
  const r = breakeven.computeBreakeven(accounts, values, { year: 2024, month: 1 });
  check(r.fixedCosts === 2000, `breakeven: excluded row leaked into fixed costs (${r.fixedCosts})`);
  check(r.actualRevenue === 10000, `breakeven: excluded row leaked into revenue (${r.actualRevenue})`);
}

// ── Stock-vs-flow regressions (balance-sheet balances are snapshots) ─────────

// Balance-sheet series: quarterly/annual buckets must report the bucket's
// ENDING balance, never the sum of its monthly balances — 12 steady months
// used to show working capital 12x overstated on the default annual view.
{
  const accounts = [
    acc('cash', 'Cash', 'asset', { number: '1010' }),
    acc('ap', 'Accounts Payable', 'liability', { number: '2100' }),
    acc('r1', 'Sales', 'revenue'),
  ];
  const values: AccountValue[] = [];
  for (let m = 1; m <= 12; m++) {
    values.push(val('cash', m, 5000), val('ap', m, 2000), val('r1', m, 10000));
  }
  const annual = balanceSheet.computeBalanceSheetSeries(accounts, values, 'annual');
  check(annual.length === 1, `BS annual series should have 1 bucket, got ${annual.length}`);
  check(
    annual[0]?.workingCapital === 3000,
    `BS annual working capital should be 3000 (ending balance, not 12x sum), got ${annual[0]?.workingCapital}`
  );
  check(annual[0]?.period.month === 1, `BS annual bucket period should be month 1, got ${annual[0]?.period.month}`);
  const quarterly = balanceSheet.computeBalanceSheetSeries(accounts, values, 'quarterly');
  check(quarterly.length === 4, `BS quarterly series should have 4 buckets, got ${quarterly.length}`);
  check(
    quarterly.every((q) => q.workingCapital === 3000),
    `BS quarterly working capital should be 3000 every quarter, got ${quarterly.map((q) => q.workingCapital)}`
  );
}

// Balance-sheet series: a moving balance snapshots the bucket's LAST month.
{
  const accounts = [
    acc('cash', 'Cash', 'asset', { number: '1010' }),
    acc('ap', 'Accounts Payable', 'liability', { number: '2100' }),
  ];
  const values = [
    val('cash', 1, 1000), val('ap', 1, 500),
    val('cash', 2, 2000), val('ap', 2, 500),
    val('cash', 3, 6000), val('ap', 3, 500),
  ];
  const q = balanceSheet.computeBalanceSheetSeries(accounts, values, 'quarterly');
  check(
    q.length === 1 && q[0]?.workingCapital === 5500,
    `BS quarterly bucket should snapshot March (WC 5500), got ${q[0]?.workingCapital}`
  );
}

// Efficiency series: flows (revenue/COGS) sum per bucket, AR/AP/assets use the
// bucket's ending balance, and days-in-period comes from the series
// granularity — the FIRST bucket used to get 30 days for a full year, making
// year-over-year DSO/DPO/DIO comparisons meaningless.
{
  const accounts = [
    acc('r1', 'Sales', 'revenue'),
    acc('c1', 'COGS', 'cogs'),
    acc('ar', 'Accounts Receivable', 'asset', { number: '1100' }),
    acc('ap', 'Accounts Payable', 'liability', { number: '2010' }),
    acc('fa', 'Equipment', 'asset', { number: '1500' }),
  ];
  const values: AccountValue[] = [];
  for (const year of [2024, 2025]) {
    for (let m = 1; m <= 12; m++) {
      values.push(
        { accountId: 'r1', period: { year, month: m }, amount: 10000 },
        { accountId: 'c1', period: { year, month: m }, amount: 5000 },
        { accountId: 'ar', period: { year, month: m }, amount: 2000 },
        { accountId: 'ap', period: { year, month: m }, amount: 1000 },
        { accountId: 'fa', period: { year, month: m }, amount: 10000 }
      );
    }
  }
  const annual = efficiency.computeEfficiencySeries(accounts, values, 'annual');
  check(annual.length === 2, `efficiency annual series should have 2 buckets, got ${annual.length}`);
  const expectedDSO = (2000 / 120000) * 365; // steady business ≈ 6.08 days
  check(
    annual[0]?.dso !== null && annual[0] !== undefined && Math.abs(annual[0].dso! - expectedDSO) < 1e-9,
    `first annual DSO should be ${expectedDSO} (365-day bucket, ending AR), got ${annual[0]?.dso}`
  );
  check(
    annual[1]?.dso !== null && annual[1] !== undefined && Math.abs(annual[1].dso! - expectedDSO) < 1e-9,
    `second annual DSO should equal the first on identical years, got ${annual[1]?.dso}`
  );
  const expectedDPO = (1000 / 60000) * 365;
  check(
    annual[1]?.dpo !== null && annual[1] !== undefined && Math.abs(annual[1].dpo! - expectedDPO) < 1e-9,
    `annual DPO should be ${expectedDPO} (ending AP over annual COGS), got ${annual[1]?.dpo}`
  );
  check(
    annual[1]?.assetTurnover !== null && annual[1] !== undefined && Math.abs(annual[1].assetTurnover! - 10) < 1e-9,
    `annual asset turnover should be 10 (120k revenue / 12k ending assets), got ${annual[1]?.assetTurnover}`
  );
  const quarterly = efficiency.computeEfficiencySeries(accounts, values, 'quarterly');
  const expectedQDSO = (2000 / 30000) * 91;
  check(quarterly.length === 8, `efficiency quarterly series should have 8 buckets, got ${quarterly.length}`);
  check(
    quarterly[0]?.dso !== null && quarterly[0] !== undefined && Math.abs(quarterly[0].dso! - expectedQDSO) < 1e-9,
    `first quarterly DSO should be ${expectedQDSO} (91-day bucket), got ${quarterly[0]?.dso}`
  );
  check(
    quarterly[1]?.dso !== null && quarterly[1] !== undefined && Math.abs(quarterly[1].dso! - expectedQDSO) < 1e-9,
    `second quarterly DSO should equal the first on steady data, got ${quarterly[1]?.dso}`
  );
}

// Breakeven: a scenario that can never break even (CM% ≤ 0) must not read as
// above breakeven — the -50% revenue stress test used to light the green
// 'Profitable' light with breakeven $0 and a 100% margin of safety.
{
  const accounts = [
    acc('r1', 'Sales', 'revenue'),
    acc('c1', 'COGS', 'cogs'),
    acc('e1', 'Rent', 'expense', { costBehavior: 'fixed' }),
  ];
  // Baseline: revenue 100k, COGS 60k, rent 20k → at -50% revenue, CM% = -20%.
  const values = [val('r1', 1, 100000), val('c1', 1, 60000), val('e1', 1, 20000)];
  const scenario = {
    id: 's-stress',
    name: 'Revenue -50%',
    adjustments: [
      { accountId: '_all_revenue_', type: 'percent' as const, value: -50, appliesFrom: { year: 2024, month: 1 } },
    ],
    createdAt: new Date().toISOString(),
  };
  const impact = computeScenarioImpact(accounts, values, scenario);
  check(impact.scenarioNetIncome < 0, `stress scenario should lose money, got ${impact.scenarioNetIncome}`);
  check(!impact.isAboveBreakeven, 'breakeven: CM≤0 scenario must not read as above breakeven');
  check(
    impact.scenarioBreakeven === Infinity,
    `breakeven: CM≤0 scenario breakeven should be unreachable (Infinity), got ${impact.scenarioBreakeven}`
  );

  const direct = breakeven.computeBreakeven(
    accounts,
    applyScenario(values, scenario, accounts),
    { year: 2024, month: 1 }
  );
  check(direct.breakevenRevenue === Infinity, `breakeven: CM≤0 should be Infinity, got ${direct.breakevenRevenue}`);
  check(direct.marginOfSafety < 0, `breakeven: CM≤0 margin of safety must be negative, got ${direct.marginOfSafety}`);
  check(direct.marginOfSafetyPct < 0, `breakeven: CM≤0 margin of safety % must be negative, got ${direct.marginOfSafetyPct}`);

  // A trailing balance-sheet-only month stays chart-safe: no revenue and no
  // fixed costs means nothing to cover, so breakeven is 0 — not Infinity.
  const bsAccounts = [...accounts, acc('cash', 'Cash', 'asset', { number: '1010' })];
  const series = breakeven.computeBreakevenSeries(bsAccounts, [...values, val('cash', 2, 5000)], 'monthly');
  check(
    series.length === 2 && series[1]?.breakevenRevenue === 0,
    `breakeven: empty trailing month should report breakeven 0, got ${series[1]?.breakevenRevenue}`
  );
}

// Profitability + health series must treat balance-sheet balances as stocks
// (bucket ENDING snapshot), not flows — annual ROA/ROE/Altman-Z used to run
// through balances summed 12x. Validated by equivalence: the annual series
// row must equal the ratio function fed correctly-snapshotted inputs.
{
  const accounts = [
    acc('r1', 'Sales', 'revenue'),
    acc('c1', 'COGS', 'cogs'),
    acc('a1', 'Cash', 'asset', { number: '1010' }),
    acc('l1', 'Loan', 'liability', { number: '2600' }),
    acc('q1', 'Owner Capital', 'equity', { number: '3000' }),
  ];
  const monthly: AccountValue[] = [];
  for (let m = 1; m <= 12; m++) {
    monthly.push(val('r1', m, 10000), val('c1', m, 4000));
    monthly.push(val('a1', m, 100000), val('l1', m, 40000), val('q1', m, 60000));
  }
  const bucketPeriod = { year: 2024, month: 1 };
  // Correct inputs for the FY bucket: flows summed, stocks at ending balance.
  const correctJoint: AccountValue[] = [
    { accountId: 'r1', period: bucketPeriod, amount: 120000 },
    { accountId: 'c1', period: bucketPeriod, amount: 48000 },
    { accountId: 'a1', period: bucketPeriod, amount: 100000 },
    { accountId: 'l1', period: bucketPeriod, amount: 40000 },
    { accountId: 'q1', period: bucketPeriod, amount: 60000 },
  ];

  const profSeries = profitability.computeProfitabilitySeries(accounts, monthly, 'annual');
  const profExpected = profitability.computeProfitabilityRatios(accounts, correctJoint, bucketPeriod);
  check(profSeries.length === 1, `profitability annual series should have 1 bucket, got ${profSeries.length}`);
  check(
    profSeries[0]?.roa !== null && profExpected.roa !== null &&
      Math.abs((profSeries[0]?.roa ?? NaN) - profExpected.roa) < 1e-9,
    `profitability: annual ROA must use ending balances (${profExpected.roa}), got ${profSeries[0]?.roa}`
  );
  check(
    profSeries[0]?.roe !== null && profExpected.roe !== null &&
      Math.abs((profSeries[0]?.roe ?? NaN) - profExpected.roe) < 1e-9,
    `profitability: annual ROE must use ending balances (${profExpected.roe}), got ${profSeries[0]?.roe}`
  );
  check(
    profSeries[0]?.dupont.assetTurnover !== null && profExpected.dupont.assetTurnover !== null &&
      Math.abs((profSeries[0]?.dupont.assetTurnover ?? NaN) - profExpected.dupont.assetTurnover) < 1e-9,
    `profitability: annual asset turnover must use ending balances (${profExpected.dupont.assetTurnover}), got ${profSeries[0]?.dupont.assetTurnover}`
  );

  const healthSeries = health.computeHealthSeries(accounts, monthly, 'annual');
  const healthExpected = health.computeHealthScores(accounts, correctJoint, bucketPeriod);
  check(healthSeries.length === 1, `health annual series should have 1 bucket, got ${healthSeries.length}`);
  check(
    healthSeries[0]?.altmanZScore !== null && healthExpected.altmanZScore !== null &&
      Math.abs((healthSeries[0]?.altmanZScore ?? NaN) - healthExpected.altmanZScore) < 1e-9,
    `health: annual Altman Z must use ending balances (${healthExpected.altmanZScore}), got ${healthSeries[0]?.altmanZScore}`
  );

  // Quarterly: same equivalence on the first quarter.
  const q1Joint: AccountValue[] = [
    { accountId: 'r1', period: bucketPeriod, amount: 30000 },
    { accountId: 'c1', period: bucketPeriod, amount: 12000 },
    { accountId: 'a1', period: bucketPeriod, amount: 100000 },
    { accountId: 'l1', period: bucketPeriod, amount: 40000 },
    { accountId: 'q1', period: bucketPeriod, amount: 60000 },
  ];
  const profQ = profitability.computeProfitabilitySeries(accounts, monthly, 'quarterly');
  const profQExpected = profitability.computeProfitabilityRatios(accounts, q1Joint, bucketPeriod);
  check(profQ.length === 4, `profitability quarterly series should have 4 buckets, got ${profQ.length}`);
  check(
    profQ[0]?.roa !== null && profQExpected.roa !== null &&
      Math.abs((profQ[0]?.roa ?? NaN) - profQExpected.roa) < 1e-9,
    `profitability: Q1 ROA must use ending balances (${profQExpected.roa}), got ${profQ[0]?.roa}`
  );
}

if (failures > 0) {
  console.error(`\n${failures} calculation check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll calculation checks passed.');
