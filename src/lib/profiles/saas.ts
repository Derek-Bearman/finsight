import type { IndustryProfile } from '@/types';
import { MARKETING_FUNNEL_METRICS } from '@/lib/operational/funnel';

export const saasProfile: IndustryProfile = {
  id: 'saas',
  name: 'SaaS / Subscription',
  description:
    'B2B and B2C software-as-a-service companies with recurring revenue. MRR, churn, LTV, and CAC payback are the core metrics. Revenue is predictable; growth is driven by net new MRR and retention.',
  icon: '💻',

  classificationHints: [
    {
      keywords: ['hosting', 'aws', 'gcp', 'azure', 'cloud hosting', 'compute', 'server cost'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'high',
      note: 'Cloud hosting scales with usage/customer count',
    },
    {
      keywords: ['third party api', 'api cost', 'twilio', 'sendgrid', 'stripe fees', 'payment processing'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'high',
    },
    {
      keywords: ['customer success', 'support staff', 'onboarding team'],
      accountType: 'cogs',
      costBehavior: 'mixed',
      confidence: 'medium',
      note: 'CS/support is mixed — base team is fixed, scales with customer volume',
    },
    {
      keywords: ['developer salary', 'engineering salary', 'r&d salary', 'product salary'],
      costBehavior: 'fixed',
      confidence: 'high',
      note: 'Engineering/product salaries are fixed overhead',
    },
    {
      keywords: ['subscription revenue', 'mrr', 'arr', 'saas revenue', 'recurring revenue'],
      accountType: 'revenue',
      confidence: 'high',
    },
    {
      keywords: ['professional services revenue', 'implementation revenue', 'onboarding revenue'],
      accountType: 'revenue',
      confidence: 'high',
      note: 'Non-recurring services revenue on top of subscription',
    },
    {
      keywords: ['sales commission', 'commission expense', 'quota bonus'],
      costBehavior: 'variable',
      confidence: 'high',
    },
    {
      keywords: ['seo', 'content marketing', 'paid search', 'digital advertising', 'demand gen'],
      costBehavior: 'variable',
      confidence: 'medium',
    },
    {
      keywords: ['deferred revenue', 'annual contract liability'],
      accountType: 'liability',
      confidence: 'high',
      note: 'Annual subscriptions paid upfront create deferred revenue',
    },
  ],

  operationalMetrics: [
    {
      id: 'net_new_mrr',
      label: 'Net New MRR',
      description: 'New MRR added minus churned MRR. The key growth indicator.',
      category: 'Revenue',
      inputFields: [
        { id: 'new_mrr', label: 'New MRR ($)', unit: '$' },
        { id: 'churned_mrr', label: 'Churned MRR ($)', unit: '$' },
        { id: 'expansion_mrr', label: 'Expansion MRR ($)', unit: '$', optional: true },
      ],
      formula: 'New MRR + Expansion MRR − Churned MRR',
      calculate: (inputs) => {
        return (inputs['new_mrr'] ?? 0) + (inputs['expansion_mrr'] ?? 0) - (inputs['churned_mrr'] ?? 0);
      },
      format: 'currency',
    },
    {
      id: 'gross_revenue_retention',
      label: 'Gross Revenue Retention (GRR)',
      description: 'Retention of existing MRR excluding expansion. Measures contraction + churn.',
      category: 'Retention',
      inputFields: [
        { id: 'beg_mrr', label: 'Beginning MRR ($)', unit: '$' },
        { id: 'churned_mrr', label: 'Churned MRR ($)', unit: '$' },
        { id: 'contraction_mrr', label: 'Contraction MRR ($)', unit: '$', optional: true },
      ],
      formula: '(Beginning MRR − Churned − Contraction) ÷ Beginning MRR',
      calculate: (inputs) => {
        if (!inputs['beg_mrr'] || inputs['beg_mrr'] === 0) return null;
        const retained = inputs['beg_mrr'] - (inputs['churned_mrr'] ?? 0) - (inputs['contraction_mrr'] ?? 0);
        return retained / inputs['beg_mrr'];
      },
      format: 'percent',
      benchmark: { good: 0.90, warn: 0.85, bad: 0.75, direction: 'higher' },
    },
    {
      id: 'net_revenue_retention',
      label: 'Net Revenue Retention (NRR)',
      description: 'Retention including expansion. NRR > 100% means existing customers are growing revenue.',
      category: 'Retention',
      inputFields: [
        { id: 'beg_mrr', label: 'Beginning MRR ($)', unit: '$' },
        { id: 'churned_mrr', label: 'Churned MRR ($)', unit: '$' },
        { id: 'expansion_mrr', label: 'Expansion MRR ($)', unit: '$', optional: true },
        { id: 'contraction_mrr', label: 'Contraction MRR ($)', unit: '$', optional: true },
      ],
      formula: '(Beginning MRR + Expansion − Churned − Contraction) ÷ Beginning MRR',
      calculate: (inputs) => {
        if (!inputs['beg_mrr'] || inputs['beg_mrr'] === 0) return null;
        const retained = inputs['beg_mrr'] + (inputs['expansion_mrr'] ?? 0)
          - (inputs['churned_mrr'] ?? 0) - (inputs['contraction_mrr'] ?? 0);
        return retained / inputs['beg_mrr'];
      },
      format: 'percent',
      benchmark: { good: 1.10, warn: 0.95, bad: 0.85, direction: 'higher' },
    },
    {
      id: 'churn_rate',
      label: 'Monthly Churn Rate',
      description: 'Percentage of customers lost each month.',
      category: 'Retention',
      inputFields: [
        { id: 'customers_start', label: 'Customers (Start of Month)', unit: 'customers' },
        { id: 'customers_churned', label: 'Customers Churned', unit: 'customers' },
      ],
      formula: 'Customers Churned ÷ Customers at Start',
      calculate: (inputs) => {
        if (!inputs['customers_start'] || inputs['customers_start'] === 0) return null;
        return (inputs['customers_churned'] ?? 0) / inputs['customers_start'];
      },
      format: 'percent',
      benchmark: { good: 0.01, warn: 0.03, bad: 0.05, direction: 'lower' },
    },
    {
      id: 'arpu',
      label: 'ARPU (Avg Revenue Per User)',
      description: 'Average monthly revenue per active customer.',
      category: 'Revenue',
      inputFields: [
        { id: 'active_customers', label: 'Active Customers', unit: 'customers' },
      ],
      formula: 'MRR ÷ Active Customers',
      calculate: (inputs, financials) => {
        if (!inputs['active_customers'] || inputs['active_customers'] === 0) return null;
        // financials.revenue is a SINGLE month's revenue (= MRR for a
        // subscription business), so ARPU is MRR / customers directly — do NOT
        // divide by 12 (that made ARPU/LTV 12x too small and payback 12x too big).
        return financials.revenue / inputs['active_customers'];
      },
      format: 'currency',
    },
    {
      id: 'ltv',
      label: 'Customer LTV',
      description: 'Lifetime value of an average customer.',
      category: 'Unit Economics',
      inputFields: [
        { id: 'active_customers', label: 'Active Customers', unit: 'customers' },
        { id: 'customers_churned', label: 'Customers Churned', unit: 'customers' },
        { id: 'customers_start', label: 'Customers (Start)', unit: 'customers' },
      ],
      formula: 'ARPU ÷ Monthly Churn Rate × Gross Margin',
      calculate: (inputs, financials) => {
        const churnRate = inputs['customers_start']
          ? (inputs['customers_churned'] ?? 0) / inputs['customers_start']
          : null;
        const arpu = inputs['active_customers']
          ? financials.revenue / inputs['active_customers'] // MRR/customer (revenue is one month)
          : null;
        if (!churnRate || !arpu || churnRate === 0) return null;
        const grossMargin = financials.revenue ? financials.grossProfit / financials.revenue : 0.7;
        return (arpu * grossMargin) / churnRate;
      },
      format: 'currency',
    },
    {
      id: 'cac',
      label: 'Customer Acquisition Cost (CAC)',
      category: 'Unit Economics',
      inputFields: [
        { id: 'new_customers', label: 'New Customers', unit: 'customers' },
      ],
      formula: 'Sales & Marketing Spend ÷ New Customers',
      calculate: (inputs, financials) => {
        if (!inputs['new_customers'] || inputs['new_customers'] === 0) return null;
        return financials.marketingSpend / inputs['new_customers'];
      },
      format: 'currency',
      benchmark: { good: 0, warn: 0, bad: 0, direction: 'lower' },
    },
    {
      id: 'cac_payback',
      label: 'CAC Payback Period',
      description: 'Months to recover customer acquisition cost.',
      category: 'Unit Economics',
      inputFields: [
        { id: 'new_customers', label: 'New Customers', unit: 'customers' },
        { id: 'active_customers', label: 'Active Customers', unit: 'customers' },
      ],
      formula: 'CAC ÷ (ARPU × Gross Margin %)',
      calculate: (inputs, financials) => {
        if (!inputs['new_customers'] || inputs['new_customers'] === 0) return null;
        if (!inputs['active_customers'] || inputs['active_customers'] === 0) return null;
        const cac = financials.marketingSpend / inputs['new_customers'];
        const arpu = financials.revenue / inputs['active_customers']; // MRR/customer (revenue is one month)
        const gm = financials.revenue ? financials.grossProfit / financials.revenue : 0.7;
        if (arpu * gm === 0) return null;
        return cac / (arpu * gm);
      },
      format: 'number',
      benchmark: { good: 12, warn: 18, bad: 24, direction: 'lower' },
    },
    {
      id: 'magic_number',
      label: 'SaaS Magic Number',
      description: 'Efficiency of sales & marketing spend: net new ARR generated per $ spent. > 0.75 = efficient.',
      category: 'Unit Economics',
      inputFields: [
        { id: 'curr_arr', label: 'Current ARR ($)', unit: '$' },
        { id: 'prev_arr', label: 'Prior Period ARR ($)', unit: '$' },
      ],
      formula: '(Current ARR − Prior ARR) ÷ Prior Period S&M Spend',
      calculate: (inputs, financials) => {
        if (!financials.marketingSpend || financials.marketingSpend === 0) return null;
        const netNewArr = (inputs['curr_arr'] ?? 0) - (inputs['prev_arr'] ?? 0);
        return netNewArr / financials.marketingSpend;
      },
      format: 'ratio',
      benchmark: { good: 0.75, warn: 0.50, bad: 0.25, direction: 'higher' },
    },
    ...MARKETING_FUNNEL_METRICS,
  ],

  benchmarks: [
    { metricId: 'gross_margin', range: { low: 0.60, typical: 0.72, high: 0.82 } },
    { metricId: 'net_margin', range: { low: -0.20, typical: 0.05, high: 0.20 } },
    { metricId: 'current_ratio', range: { low: 1.5, typical: 2.5, high: 4.0 } },
  ],

  defaultGrowthRate: 0.12,
  seasonalityExpected: false,
  defaultProjectionModel: 'linear',

  labels: {
    capacityUnit: 'Server',
    primaryRevenueDriver: 'MRR',
    costOfGoodsLabel: 'Cost of Revenue',
  },
};
