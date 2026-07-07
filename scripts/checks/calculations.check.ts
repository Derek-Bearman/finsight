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
import { applyScenario } from '../../src/lib/scenarios/engine';

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

if (failures > 0) {
  console.error(`\n${failures} calculation check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll calculation checks passed.');
