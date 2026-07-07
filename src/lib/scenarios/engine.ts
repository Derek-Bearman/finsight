import type { Account, AccountValue, Scenario, ScenarioAdjustment, Period } from '@/types';
import { computePnL } from '@/lib/calculations/pnl';
import { computeBreakeven } from '@/lib/calculations/breakeven';
import { aggregateValues, getUniquePeriods } from '@/lib/calculations/period-aggregation';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

export const SCENARIO_COLORS = [
  'hsl(217 91% 55%)',  // blue — baseline
  'hsl(142 71% 45%)',  // green
  'hsl(0 84% 60%)',    // red
  'hsl(38 92% 50%)',   // amber
  'hsl(280 65% 55%)',  // purple
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function periodToKey(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

function isAfterOrEqual(p: Period, from: Period): boolean {
  if (p.year !== from.year) return p.year > from.year;
  return p.month >= from.month;
}

/**
 * Expand sentinel accountIds to actual account IDs of the matching type.
 */
function expandAccountId(accountId: string, accounts: Account[]): string[] {
  // Sentinels never expand to excluded accounts (summary rows etc.) —
  // adjusting those would corrupt scenario math.
  if (accountId === '_all_revenue_') {
    return accounts.filter(a => a.type === 'revenue' && !a.isExcluded).map(a => a.id);
  }
  if (accountId === '_all_expense_') {
    return accounts.filter(a => a.type === 'expense' && !a.isExcluded).map(a => a.id);
  }
  if (accountId === '_all_costs_') {
    return accounts.filter(a => (a.type === 'expense' || a.type === 'cogs') && !a.isExcluded).map(a => a.id);
  }
  return [accountId];
}

// ─────────────────────────────────────────────
// applyScenario
// ─────────────────────────────────────────────

/**
 * Apply a single scenario's adjustments to the workspace's account values.
 * Returns a NEW array of AccountValue — never mutates the originals.
 *
 * Adjustment types:
 * - 'percent': multiply the account's amount by (1 + value/100) for all periods >= appliesFrom
 * - 'absolute': add `value` to the account's amount for periods >= appliesFrom
 * - 'replace': set the account's amount to `value` for periods >= appliesFrom
 *
 * Multiple adjustments to the same account are applied sequentially.
 * Baseline scenario (isBaseline=true): return values unchanged.
 */
export function applyScenario(
  values: AccountValue[],
  scenario: Scenario,
  accounts?: Account[]
): AccountValue[] {
  // Baseline: no changes
  if (scenario.isBaseline) return values.map(v => ({ ...v }));
  // No adjustments: no changes
  if (scenario.adjustments.length === 0) return values.map(v => ({ ...v }));

  // Build a mutable copy keyed by (accountId, periodKey)
  const valueMap = new Map<string, AccountValue>();
  for (const v of values) {
    const key = `${v.accountId}::${periodToKey(v.period)}`;
    valueMap.set(key, { ...v });
  }

  // Apply each adjustment sequentially
  for (const adj of scenario.adjustments) {
    // Expand sentinel accountIds
    const targetIds = accounts ? expandAccountId(adj.accountId, accounts) : [adj.accountId];

    for (const accountId of targetIds) {
      // Find all values for this accountId that are >= appliesFrom
      for (const [key, val] of valueMap) {
        if (val.accountId !== accountId) continue;
        if (!isAfterOrEqual(val.period, adj.appliesFrom)) continue;

        const current = val.amount;
        let newAmount: number;

        switch (adj.type) {
          case 'percent':
            newAmount = current * (1 + adj.value / 100);
            break;
          case 'absolute':
            newAmount = current + adj.value;
            break;
          case 'replace':
            newAmount = adj.value;
            break;
          default:
            newAmount = current;
        }

        valueMap.set(key, { ...val, amount: newAmount });
      }
    }
  }

  return Array.from(valueMap.values());
}

// ─────────────────────────────────────────────
// ScenarioPnLImpact
// ─────────────────────────────────────────────

export interface ScenarioPnLImpact {
  scenarioId: string;
  scenarioName: string;
  baseRevenue: number;
  scenarioRevenue: number;
  revenueDelta: number;
  revenueDeltaPct: number | null;
  baseNetIncome: number;
  scenarioNetIncome: number;
  netIncomeDelta: number;
  netIncomeDeltaPct: number | null;
  baseBreakeven: number;
  scenarioBreakeven: number;
  breakevenDelta: number;
  isAboveBreakeven: boolean;
  baseGrossMarginPct: number;
  scenarioGrossMarginPct: number;
}

// ─────────────────────────────────────────────
// computeScenarioImpact
// ─────────────────────────────────────────────

export function computeScenarioImpact(
  accounts: Account[],
  baseValues: AccountValue[],
  scenario: Scenario,
  periods?: Period[]
): ScenarioPnLImpact {
  // Determine which periods to use
  let targetPeriods: Period[];
  if (periods && periods.length > 0) {
    targetPeriods = periods;
  } else {
    targetPeriods = getUniquePeriods(baseValues);
  }

  // Filter base values to target periods
  const periodKeys = new Set(targetPeriods.map(periodToKey));
  const filteredBase = baseValues.filter(v => periodKeys.has(periodToKey(v.period)));

  // Apply scenario adjustments
  const scenarioValues = applyScenario(baseValues, scenario, accounts);
  const filteredScenario = scenarioValues.filter(v => periodKeys.has(periodToKey(v.period)));

  // Compute P&L for both
  const basePnL = computePnL(accounts, filteredBase, targetPeriods);
  const scenarioPnL = computePnL(accounts, filteredScenario, targetPeriods);

  // Compute breakeven for both
  const baseBreakevenResult = computeBreakeven(accounts, filteredBase, targetPeriods);
  const scenarioBreakevenResult = computeBreakeven(accounts, filteredScenario, targetPeriods);

  const baseRevenue = basePnL.revenue;
  const scenarioRevenue = scenarioPnL.revenue;
  const revenueDelta = scenarioRevenue - baseRevenue;
  const revenueDeltaPct = baseRevenue !== 0 ? revenueDelta / baseRevenue : null;

  const baseNetIncome = basePnL.netIncome;
  const scenarioNetIncome = scenarioPnL.netIncome;
  const netIncomeDelta = scenarioNetIncome - baseNetIncome;
  const netIncomeDeltaPct = baseNetIncome !== 0 ? netIncomeDelta / Math.abs(baseNetIncome) : null;

  const baseBreakeven = baseBreakevenResult.breakevenRevenue;
  const scenarioBreakeven = scenarioBreakevenResult.breakevenRevenue;
  const breakevenDelta = scenarioBreakeven - baseBreakeven;
  const isAboveBreakeven = scenarioRevenue >= scenarioBreakeven;

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    baseRevenue,
    scenarioRevenue,
    revenueDelta,
    revenueDeltaPct,
    baseNetIncome,
    scenarioNetIncome,
    netIncomeDelta,
    netIncomeDeltaPct,
    baseBreakeven,
    scenarioBreakeven,
    breakevenDelta,
    isAboveBreakeven,
    baseGrossMarginPct: basePnL.grossMarginPct,
    scenarioGrossMarginPct: scenarioPnL.grossMarginPct,
  };
}

// ─────────────────────────────────────────────
// ScenarioSeries
// ─────────────────────────────────────────────

export interface ScenarioSeries {
  scenarioId: string;
  name: string;
  color: string;
  isBaseline: boolean;
  data: { label: string; revenue: number; netIncome: number; grossProfit: number }[];
}

// ─────────────────────────────────────────────
// buildScenarioSeries
// ─────────────────────────────────────────────

function getMonthLabel(p: Period): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[p.month - 1]} ${p.year}`;
}

function getQuarterLabel(p: Period): string {
  return `Q${Math.ceil(p.month / 3)} ${p.year}`;
}

export function buildScenarioSeries(
  accounts: Account[],
  baseValues: AccountValue[],
  scenarios: Scenario[],
  granularity: 'monthly' | 'quarterly' | 'annual'
): ScenarioSeries[] {
  // Find the baseline scenario (or the first scenario)
  const baselineScenario = scenarios.find(s => s.isBaseline) ?? scenarios[0];
  if (!baselineScenario) return [];

  // Get aggregated unique periods from base values
  const aggregatedBase = aggregateValues(baseValues, granularity);
  const uniquePeriods = getUniquePeriods(aggregatedBase);

  if (uniquePeriods.length === 0) return [];

  return scenarios.map((scenario, idx) => {
    const color = scenario.isBaseline
      ? SCENARIO_COLORS[0]!
      : SCENARIO_COLORS[((idx) % (SCENARIO_COLORS.length - 1)) + 1]!;

    // Apply scenario adjustments to the base values
    const adjustedValues = applyScenario(baseValues, scenario, accounts);

    // Aggregate to the requested granularity
    const aggregated = aggregateValues(adjustedValues, granularity);
    const aggPeriods = getUniquePeriods(aggregated);

    const data = aggPeriods.map(period => {
      const periodKey = periodToKey(period);
      const periodVals = aggregated.filter(v => periodToKey(v.period) === periodKey);
      const pnl = computePnL(accounts, periodVals, period);

      let label: string;
      if (granularity === 'monthly') {
        label = getMonthLabel(period);
      } else if (granularity === 'quarterly') {
        label = getQuarterLabel(period);
      } else {
        label = `FY${period.year}`;
      }

      return {
        label,
        revenue: pnl.revenue,
        netIncome: pnl.netIncome,
        grossProfit: pnl.grossProfit,
      };
    });

    return {
      scenarioId: scenario.id,
      name: scenario.name,
      color,
      isBaseline: scenario.isBaseline ?? false,
      data,
    };
  });
}
