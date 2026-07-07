import type { IndustryProfile, FinancialSummary } from '@/types';
import { MARKETING_FUNNEL_METRICS } from '@/lib/operational/funnel';

export const genericSmbProfile: IndustryProfile = {
  id: 'generic-smb',
  name: 'Generic SMB',
  description:
    'Standard accounting heuristics for small businesses without a specialized industry fit. A sensible fallback for bookkeeping-heavy clients, light professional services, and solo operators.',
  icon: '🏢',

  classificationHints: [],

  // cost_per_lead and conversion_rate moved to the universal Marketing Funnel
  // group (funnel_cost_per_lead / funnel_lead_to_sale) — same math, shared
  // inputs entered once per period.
  operationalMetrics: [
    {
      id: 'marketing_pct_revenue',
      label: 'Marketing % of Revenue',
      description: 'Marketing spend as a percentage of total revenue.',
      category: 'Marketing',
      inputFields: [],
      formula: 'Marketing Spend ÷ Revenue',
      calculate: (_inputs, financials) => {
        if (!financials.revenue) return null;
        return financials.marketingSpend / financials.revenue;
      },
      format: 'percent',
      benchmark: { good: 0.05, warn: 0.12, bad: 0.20, direction: 'lower' },
    },
    {
      id: 'avg_transaction_size',
      label: 'Average Transaction Size',
      description: 'Average revenue per transaction/job/order.',
      category: 'Sales',
      inputFields: [
        { id: 'transaction_count', label: 'Transaction Count', unit: 'transactions' },
      ],
      formula: 'Revenue ÷ Transaction Count',
      calculate: (inputs, financials) => {
        if (!inputs['transaction_count'] || inputs['transaction_count'] === 0) return null;
        return financials.revenue / inputs['transaction_count'];
      },
      format: 'currency',
    },
    ...MARKETING_FUNNEL_METRICS,
  ],

  benchmarks: [
    { metricId: 'gross_margin', range: { low: 0.30, typical: 0.45, high: 0.65 } },
    { metricId: 'net_margin', range: { low: 0.03, typical: 0.08, high: 0.15 } },
    { metricId: 'current_ratio', range: { low: 1.0, typical: 1.5, high: 2.5 } },
  ],

  defaultGrowthRate: 0.03,
  seasonalityExpected: false,
  defaultProjectionModel: 'linear',

  labels: {
    primaryRevenueDriver: 'Transactions',
  },
};
