/**
 * Operational shared-input + marketing-funnel checks, runnable headless:
 *   npx tsx scripts/checks/operational.check.ts
 *
 * Covers: pool-over-legacy input resolution, legacy-only fallback, funnel
 * derivations (CPL, stage conversions, CAC, ROI), P&L marketing-spend
 * fallback, and that every profile carries the funnel group.
 */

import type { FinancialSummary, OperationalDataPoint, OperationalInputPool } from '../../src/types';
import { computeMetricsForPeriod } from '../../src/lib/operational/calculator';
import { MARKETING_FUNNEL_METRICS } from '../../src/lib/operational/funnel';
import { ALL_PROFILES } from '../../src/lib/profiles';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

const PERIOD = { year: 2026, month: 6 };
const FIN: FinancialSummary = {
  revenue: 100000,
  cogs: 30000,
  grossProfit: 70000,
  grossMargin: 0.7,
  totalFixedCosts: 20000,
  totalVariableCosts: 10000,
  operatingExpenses: 30000,
  operatingIncome: 40000,
  netIncome: 40000,
  contributionMargin: 60000,
  contributionMarginPct: 0.6,
  marketingSpend: 5000,
  period: PERIOD,
};

function metric(results: ReturnType<typeof computeMetricsForPeriod>, id: string) {
  return results.find((r) => r.metricId === id);
}

// 1. Full funnel from the shared pool alone (no legacy points), manual spend.
{
  const pools: OperationalInputPool[] = [
    {
      period: PERIOD,
      sharedInputs: {
        marketing_spend: 8000,
        total_leads: 200,
        appointments: 80,
        new_customers: 20,
        new_customer_revenue: 40000,
      },
    },
  ];
  const results = computeMetricsForPeriod(MARKETING_FUNNEL_METRICS, [], FIN, PERIOD, pools);
  check(metric(results, 'funnel_cost_per_lead')?.value === 40, 'CPL should be 8000/200=40');
  check(metric(results, 'funnel_lead_to_appointment')?.value === 0.4, 'lead→appt should be 0.4');
  check(metric(results, 'funnel_appointment_to_close')?.value === 0.25, 'appt→close should be 0.25');
  check(metric(results, 'funnel_lead_to_sale')?.value === 0.1, 'lead→sale should be 0.1');
  check(metric(results, 'funnel_cac')?.value === 400, 'CAC should be 8000/20=400');
  check(metric(results, 'funnel_marketing_roi')?.value === 5, 'ROI should be 40000/8000=5');
}

// 2. Marketing spend falls back to P&L accounts when not entered.
{
  const pools: OperationalInputPool[] = [
    { period: PERIOD, sharedInputs: { total_leads: 100, new_customers: 10 } },
  ];
  const results = computeMetricsForPeriod(MARKETING_FUNNEL_METRICS, [], FIN, PERIOD, pools);
  check(metric(results, 'funnel_cost_per_lead')?.value === 50, 'CPL should fall back to P&L spend 5000/100');
  check(metric(results, 'funnel_cac')?.value === 500, 'CAC should fall back to P&L spend 5000/10');
}

// 3. Pool value WINS over a legacy per-metric data point.
{
  const legacy: OperationalDataPoint[] = [
    { metricDefId: 'funnel_cost_per_lead', period: PERIOD, inputs: { total_leads: 999 } },
  ];
  const pools: OperationalInputPool[] = [
    { period: PERIOD, sharedInputs: { total_leads: 100 } },
  ];
  const results = computeMetricsForPeriod(MARKETING_FUNNEL_METRICS, legacy, FIN, PERIOD, pools);
  check(metric(results, 'funnel_cost_per_lead')?.value === 50, 'pool total_leads should beat legacy 999');
}

// 4. Legacy-only workspaces (no pool) still compute — backward compatibility.
{
  const legacy: OperationalDataPoint[] = [
    { metricDefId: 'funnel_cost_per_lead', period: PERIOD, inputs: { total_leads: 250 } },
  ];
  const results = computeMetricsForPeriod(MARKETING_FUNNEL_METRICS, legacy, FIN, PERIOD, undefined);
  check(metric(results, 'funnel_cost_per_lead')?.value === 20, 'legacy-only CPL should be 5000/250=20');
}

// 5. A pool entered for one metric feeds SIBLING metrics sharing the field
//    (the whole point: enter once, everything derives).
{
  const pools: OperationalInputPool[] = [
    { period: PERIOD, sharedInputs: { total_leads: 100, appointments: 30 } },
  ];
  const results = computeMetricsForPeriod(MARKETING_FUNNEL_METRICS, [], FIN, PERIOD, pools);
  check(metric(results, 'funnel_lead_to_appointment')?.value === 0.3, 'shared inputs feed sibling metrics');
}

// 6. Every profile ships the Marketing Funnel group.
for (const profile of ALL_PROFILES) {
  const ids = new Set(profile.operationalMetrics.map((m) => m.id));
  for (const fm of MARKETING_FUNNEL_METRICS) {
    check(ids.has(fm.id), `${profile.id} is missing funnel metric ${fm.id}`);
  }
  // No duplicate metric ids within a profile.
  check(
    ids.size === profile.operationalMetrics.length,
    `${profile.id} has duplicate operational metric ids`
  );
}

if (failures > 0) {
  console.error(`\n${failures} operational check(s) FAILED`);
  process.exit(1);
}
console.log('All operational checks passed.');
