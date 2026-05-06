import type { Scenario, Period } from '@/types';

/**
 * Build the 3 default scenarios for a new workspace.
 * Best Case: +15% revenue, -5% all expense accounts (from appliesFrom)
 * Worst Case: -20% revenue, +10% all expense accounts
 * Base Case: no adjustments (isBaseline=true)
 *
 * These use special sentinel accountIds:
 * - '_all_revenue_' → all accounts with type='revenue'
 * - '_all_expense_' → all accounts with type='expense'
 * - '_all_costs_'   → all accounts with type='expense' or type='cogs'
 */
export function buildDefaultScenarios(appliesFrom: Period): Scenario[] {
  const now = new Date().toISOString();

  const baseCase: Scenario = {
    id: `scenario-base-${Date.now()}`,
    name: 'Base Case',
    description: 'Current actuals — no adjustments applied.',
    adjustments: [],
    createdAt: now,
    isBaseline: true,
  };

  const bestCase: Scenario = {
    id: `scenario-best-${Date.now() + 1}`,
    name: 'Best Case',
    description: '+15% revenue, −5% expenses',
    adjustments: [
      {
        accountId: '_all_revenue_',
        type: 'percent',
        value: 15,
        appliesFrom,
      },
      {
        accountId: '_all_costs_',
        type: 'percent',
        value: -5,
        appliesFrom,
      },
    ],
    createdAt: now,
    isBaseline: false,
  };

  const worstCase: Scenario = {
    id: `scenario-worst-${Date.now() + 2}`,
    name: 'Worst Case',
    description: '−20% revenue, +10% expenses',
    adjustments: [
      {
        accountId: '_all_revenue_',
        type: 'percent',
        value: -20,
        appliesFrom,
      },
      {
        accountId: '_all_costs_',
        type: 'percent',
        value: 10,
        appliesFrom,
      },
    ],
    createdAt: now,
    isBaseline: false,
  };

  return [baseCase, bestCase, worstCase];
}
