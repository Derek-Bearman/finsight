/**
 * Executive-summary + targets checks, runnable headless:
 *   npx tsx scripts/checks/insights.check.ts
 *
 * The summary must be deterministic, data-driven, and skip gracefully when
 * data is missing. Targets must convert/score correctly with provenance.
 */

import type { Account, AccountValue, ClientWorkspace } from '../../src/types';
import { buildExecutiveSummary } from '../../src/lib/insights/executive-summary';
import {
  targetToBenchmark,
  meetsTarget,
  resolveRatioBenchmark,
  formatTargetThreshold,
} from '../../src/lib/targets';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

const acc = (id: string, name: string, type: Account['type'], opts: Partial<Account> = {}): Account => ({
  id,
  name,
  type,
  isManuallyClassified: false,
  ...opts,
});
const val = (accountId: string, month: number, amount: number): AccountValue => ({
  accountId,
  period: { year: 2026, month },
  amount,
});

function mkWorkspace(over: Partial<ClientWorkspace>): ClientWorkspace {
  return {
    id: 'ws-test',
    name: 'Test Client',
    industryProfileId: 'restaurant',
    accounts: [],
    values: [],
    fiscalYearStart: 1,
    scenarios: [],
    operationalData: [],
    operationalInputs: [],
    customMetrics: [],
    auditLog: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

// ── Targets primitives ───────────────────────────────────────────────────────
{
  const atLeast = targetToBenchmark({ value: 1.5, direction: 'at_least', source: 'corporate' });
  check(atLeast.direction === 'higher' && atLeast.good === 1.5, 'at_least converts to higher/good=value');
  const atMost = targetToBenchmark({ value: 0.3, direction: 'at_most', source: 'corporate' });
  check(atMost.direction === 'lower' && atMost.good === 0.3, 'at_most converts to lower/good=value');

  check(meetsTarget(1.6, { value: 1.5, direction: 'at_least', source: 'corporate' }), '1.6 meets ≥1.5');
  check(!meetsTarget(1.4, { value: 1.5, direction: 'at_least', source: 'corporate' }), '1.4 misses ≥1.5');
  check(meetsTarget(0.28, { value: 0.3, direction: 'at_most', source: 'corporate' }), '28% meets ≤30%');
  check(!meetsTarget(0.32, { value: 0.3, direction: 'at_most', source: 'corporate' }), '32% misses ≤30%');

  check(
    formatTargetThreshold({ value: 0.3, direction: 'at_most', source: 'corporate' }, 'percent') === '≤ 30.0%',
    `threshold format: got ${formatTargetThreshold({ value: 0.3, direction: 'at_most', source: 'corporate' }, 'percent')}`
  );

  const withTarget = resolveRatioBenchmark('current_ratio', {
    ratios: { current_ratio: { value: 1.5, direction: 'at_least', source: 'corporate' } },
    metrics: {},
  });
  check(withTarget.provenance === 'corporate' && withTarget.benchmark.good === 1.5, 'ratio target resolves');
  const noTarget = resolveRatioBenchmark('current_ratio', undefined);
  check(noTarget.provenance === 'default' && noTarget.targetText === null, 'no target → default provenance');
}

// ── Summary: empty workspace → no lines ─────────────────────────────────────
{
  const lines = buildExecutiveSummary(mkWorkspace({}));
  check(lines.length === 0, 'empty workspace should produce no summary');
}

// ── Summary: growth + margins + targets + funnel ─────────────────────────────
{
  const accounts = [
    acc('r1', 'Food Sales', 'revenue'),
    acc('r2', 'Catering', 'revenue'),
    acc('c1', 'Food Cost', 'cogs', { costBehavior: 'variable' }),
    acc('e1', 'Rent', 'expense', { costBehavior: 'fixed' }),
    acc('cash', 'Business Checking', 'asset', { number: '1010' }),
    acc('x1', 'Gross Profit', 'revenue', { isExcluded: true }),
  ];
  const values: AccountValue[] = [];
  // 6 months of growth: revenue 10k → 15k, food cost 30%, rent 3k
  for (let m = 1; m <= 6; m++) {
    const rev = 10000 + (m - 1) * 1000;
    values.push(val('r1', m, rev * 0.8));
    values.push(val('r2', m, rev * 0.2));
    values.push(val('c1', m, rev * 0.3));
    values.push(val('e1', m, 3000));
    values.push(val('cash', m, 25000));
    values.push(val('x1', m, rev * 0.7)); // excluded — must not distort anything
  }

  const ws = mkWorkspace({
    accounts,
    values,
    targets: {
      ratios: {
        gross_margin: { value: 0.72, direction: 'at_least', source: 'corporate' },
        net_margin: { value: 0.5, direction: 'at_least', source: 'corporate' }, // will miss
      },
      metrics: {},
    },
    operationalInputs: [
      { period: { year: 2026, month: 5 }, sharedInputs: { marketing_spend: 1000, total_leads: 100 } },
      {
        period: { year: 2026, month: 6 },
        sharedInputs: { marketing_spend: 1200, total_leads: 100, new_customers: 12 },
      },
    ],
  });

  const lines = buildExecutiveSummary(ws);
  const all = lines.map((l) => l.text).join(' | ');
  check(lines.length >= 4 && lines.length <= 7, `summary should have 4-7 lines, got ${lines.length}`);
  check(/Revenue grew/.test(all), `should mention revenue growth: ${all}`);
  check(/Gross margin/.test(all), 'should mention gross margin');
  check(/earned/.test(all), 'should mention the bottom line');
  check(/Cash on hand/.test(all), 'should mention cash coverage');
  check(/1 of 2 client targets/.test(all), `should score targets 1 of 2: ${all}`);
  check(/marketing spend rose/i.test(all), `should flag spend up while leads flat: ${all}`);
  // Determinism: same input → same output.
  const again = buildExecutiveSummary(ws).map((l) => l.text).join(' | ');
  check(again === all, 'summary must be deterministic');
}

// ── Summary: operational-metric targets count in the scorecard ──────────────
{
  const accounts = [
    acc('r1', 'Food Sales', 'revenue'),
    acc('c1', 'Food Purchases', 'cogs', { costBehavior: 'variable' }),
  ];
  const values: AccountValue[] = [];
  for (let m = 1; m <= 4; m++) {
    values.push(val('r1', m, 50000));
    values.push(val('c1', m, 17500)); // food cost 35% — misses the ≤30% mandate
  }
  const ws = mkWorkspace({
    accounts,
    values,
    industryProfileId: 'restaurant',
    targets: {
      ratios: {},
      metrics: { food_cost_pct: { value: 0.3, direction: 'at_most', source: 'corporate' } },
    },
  });
  const all = buildExecutiveSummary(ws).map((l) => l.text).join(' | ');
  check(/0 of 1 client target is met/.test(all), `metric target should be scored: ${all}`);
  check(/Food Cost %/.test(all), `worst miss should name the metric: ${all}`);
}

// ── Summary: declining, loss-making month reads negative ────────────────────
{
  const accounts = [acc('r1', 'Sales', 'revenue'), acc('e1', 'Payroll', 'expense', { costBehavior: 'fixed' })];
  const values: AccountValue[] = [];
  for (let m = 1; m <= 6; m++) {
    values.push(val('r1', m, 20000 - (m - 1) * 2000)); // declining
    values.push(val('e1', m, 15000));
  }
  const ws = mkWorkspace({ accounts, values });
  const lines = buildExecutiveSummary(ws);
  const all = lines.map((l) => l.text).join(' | ');
  check(/declined/.test(all), `declining revenue should read 'declined': ${all}`);
  check(/lost/.test(all), `loss month should read 'lost': ${all}`);
}

if (failures > 0) {
  console.error(`\n${failures} insights check(s) FAILED`);
  process.exit(1);
}
console.log('All insights checks passed.');
