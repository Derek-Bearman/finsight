import type { IndustryProfile } from '@/types';
import { MARKETING_FUNNEL_METRICS } from '@/lib/operational/funnel';

export const professionalServicesProfile: IndustryProfile = {
  id: 'professional-services',
  name: 'Professional Services',
  description:
    'Law firms, accounting firms, management consulting, and marketing agencies. Headcount and billable hours are the primary capacity constraints. Revenue is driven by utilization and effective rates.',
  icon: '📊',

  classificationHints: [
    {
      keywords: ['contractor labor', 'freelancer', 'contract staff', '1099'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'high',
      note: 'Contract labor is direct variable cost of service delivery',
    },
    {
      keywords: ['billable software', 'project software', 'matter software'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'medium',
      note: 'Software billed directly to client engagements',
    },
    {
      keywords: ['travel reimbursable', 'client travel', 'reimbursable expense'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'high',
    },
    {
      keywords: ['staff salary', 'consultant salary', 'associate salary', 'paralegal'],
      accountType: 'cogs',
      costBehavior: 'fixed',
      confidence: 'medium',
      note: 'Professional staff salaries are fixed even if hours vary',
    },
    {
      keywords: ['professional liability', 'e&o insurance', 'malpractice'],
      costBehavior: 'fixed',
      confidence: 'high',
    },
    {
      keywords: ['cle', 'continuing education', 'cpe', 'training'],
      costBehavior: 'fixed',
      confidence: 'medium',
    },
    {
      keywords: ['retainer', 'engagement fee', 'project revenue', 'consulting revenue'],
      accountType: 'revenue',
      confidence: 'high',
    },
    {
      keywords: ['reimbursed expenses', 'expense reimbursement'],
      accountType: 'revenue',
      confidence: 'medium',
      note: 'Pass-through expense reimbursement from clients',
    },
  ],

  operationalMetrics: [
    {
      id: 'utilization_rate',
      label: 'Utilization Rate',
      description: 'Billable hours as a percentage of total available hours.',
      category: 'Capacity',
      inputFields: [
        { id: 'billable_hours', label: 'Billable Hours', unit: 'hours' },
        { id: 'available_hours', label: 'Available Hours', unit: 'hours' },
      ],
      formula: 'Billable Hours ÷ Available Hours',
      calculate: (inputs) => {
        if (!inputs['available_hours'] || inputs['available_hours'] === 0) return null;
        return (inputs['billable_hours'] ?? 0) / inputs['available_hours'];
      },
      format: 'percent',
      benchmark: { good: 0.75, warn: 0.60, bad: 0.45, direction: 'higher' },
    },
    {
      id: 'effective_hourly_rate',
      label: 'Effective Hourly Rate',
      description: 'Actual revenue per billable hour (vs. stated rack rate).',
      category: 'Pricing',
      inputFields: [
        { id: 'billable_hours', label: 'Billable Hours', unit: 'hours' },
      ],
      formula: 'Revenue ÷ Billable Hours',
      calculate: (inputs, financials) => {
        if (!inputs['billable_hours'] || inputs['billable_hours'] === 0) return null;
        return financials.revenue / inputs['billable_hours'];
      },
      format: 'currency',
      benchmark: { good: 250, warn: 150, bad: 100, direction: 'higher' },
    },
    {
      id: 'revenue_per_consultant',
      label: 'Revenue Per Consultant',
      description: 'Total revenue divided by billable headcount.',
      category: 'Capacity',
      inputFields: [
        { id: 'headcount', label: 'Billable Headcount', unit: 'people' },
      ],
      formula: 'Revenue ÷ Headcount',
      calculate: (inputs, financials) => {
        if (!inputs['headcount'] || inputs['headcount'] === 0) return null;
        return financials.revenue / inputs['headcount'];
      },
      format: 'currency',
      benchmark: { good: 200000, warn: 130000, bad: 80000, direction: 'higher' },
    },
    {
      id: 'realization_rate',
      label: 'Realization Rate',
      description: 'Revenue collected vs. hours billed at rack rate.',
      category: 'Pricing',
      inputFields: [
        { id: 'hours_billed_at_rack', label: 'Hours × Rack Rate ($)', unit: '$' },
      ],
      formula: 'Revenue ÷ (Billable Hours × Rack Rate)',
      calculate: (inputs, financials) => {
        if (!inputs['hours_billed_at_rack'] || inputs['hours_billed_at_rack'] === 0) return null;
        return financials.revenue / inputs['hours_billed_at_rack'];
      },
      format: 'percent',
      benchmark: { good: 0.90, warn: 0.75, bad: 0.60, direction: 'higher' },
    },
    {
      id: 'project_margin',
      label: 'Project Gross Margin',
      description: 'Gross profit margin on client engagements.',
      category: 'Profitability',
      inputFields: [],
      formula: 'Gross Profit ÷ Revenue',
      calculate: (_inputs, financials) => {
        if (!financials.revenue) return null;
        return financials.grossProfit / financials.revenue;
      },
      format: 'percent',
      benchmark: { good: 0.45, warn: 0.30, bad: 0.20, direction: 'higher' },
    },
    {
      id: 'cac',
      label: 'Client Acquisition Cost',
      category: 'Marketing',
      inputFields: [
        { id: 'new_clients', label: 'New Clients Won', unit: 'clients' },
      ],
      formula: 'Marketing Spend ÷ New Clients',
      calculate: (inputs, financials) => {
        if (!inputs['new_clients'] || inputs['new_clients'] === 0) return null;
        return financials.marketingSpend / inputs['new_clients'];
      },
      format: 'currency',
      benchmark: { good: 500, warn: 1500, bad: 3000, direction: 'lower' },
    },
    ...MARKETING_FUNNEL_METRICS,
  ],

  benchmarks: [
    { metricId: 'gross_margin', range: { low: 0.30, typical: 0.45, high: 0.65 } },
    { metricId: 'net_margin', range: { low: 0.08, typical: 0.15, high: 0.25 } },
    { metricId: 'current_ratio', range: { low: 1.0, typical: 1.8, high: 3.0 } },
  ],

  defaultGrowthRate: 0.06,
  seasonalityExpected: false,
  defaultProjectionModel: 'linear',

  labels: {
    capacityUnit: 'Consultant',
    primaryRevenueDriver: 'Billable Hours',
    costOfGoodsLabel: 'Cost of Services',
  },
};
