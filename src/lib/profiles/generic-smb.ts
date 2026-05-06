import type { IndustryProfile, FinancialSummary } from '@/types';

export const genericSmbProfile: IndustryProfile = {
  id: 'generic-smb',
  name: 'Generic SMB',
  description:
    'Standard accounting heuristics for small businesses without a specialized industry fit. A sensible fallback for bookkeeping-heavy clients, light professional services, and solo operators.',
  icon: '🏢',

  classificationHints: [],

  operationalMetrics: [
    {
      id: 'cost_per_lead',
      label: 'Cost Per Lead',
      description: 'Total marketing spend divided by total leads generated.',
      category: 'Marketing',
      inputFields: [
        { id: 'total_leads', label: 'Total Leads', unit: 'leads' },
      ],
      formula: 'Marketing Spend ÷ Total Leads',
      calculate: (inputs, financials) => {
        if (!inputs['total_leads'] || inputs['total_leads'] === 0) return null;
        return financials.marketingSpend / inputs['total_leads'];
      },
      format: 'currency',
      benchmark: { good: 25, warn: 75, bad: 150, direction: 'lower' },
    },
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
    {
      id: 'conversion_rate',
      label: 'Lead Conversion Rate',
      description: 'Percentage of leads that become paying customers.',
      category: 'Sales',
      inputFields: [
        { id: 'total_leads', label: 'Total Leads', unit: 'leads' },
        { id: 'new_customers', label: 'New Customers', unit: 'customers' },
      ],
      formula: 'New Customers ÷ Total Leads',
      calculate: (inputs) => {
        if (!inputs['total_leads'] || inputs['total_leads'] === 0) return null;
        return (inputs['new_customers'] ?? 0) / inputs['total_leads'];
      },
      format: 'percent',
      benchmark: { good: 0.20, warn: 0.10, bad: 0.05, direction: 'higher' },
    },
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
