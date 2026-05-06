import type { IndustryProfile } from '@/types';

export const tradesContractorProfile: IndustryProfile = {
  id: 'trades-contractor',
  name: 'Trades Contractor',
  description:
    'HVAC, plumbing, electrical, remodeling, and roofing companies. Field-service operations with trucks and technicians as primary capacity constraints. Seasonal revenue peaks in summer and winter.',
  icon: '🔧',

  classificationHints: [
    {
      keywords: ['fuel', 'gas', 'diesel'],
      costBehavior: 'variable',
      confidence: 'high',
      note: 'Fuel is a direct variable cost tied to truck dispatch',
    },
    {
      keywords: ['subcontractor', 'sub-contractor', 'sub contractor', 'contract labor'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'high',
      note: 'Subcontractor labor is variable COGS for trades',
    },
    {
      keywords: ['truck lease', 'vehicle lease', 'truck payment', 'fleet lease'],
      costBehavior: 'fixed',
      confidence: 'high',
      note: 'Fleet lease payments are fixed regardless of utilization',
    },
    {
      keywords: ['parts', 'materials', 'supplies', 'equipment parts'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'high',
      note: 'Parts and materials are direct variable COGS',
    },
    {
      keywords: ['technician', 'tech wage', 'field labor', 'installer'],
      accountType: 'cogs',
      costBehavior: 'mixed',
      confidence: 'medium',
      note: 'Field labor is mixed — base salary fixed, overtime variable',
    },
    {
      keywords: ['dispatch', 'call center', 'scheduling'],
      costBehavior: 'fixed',
      confidence: 'medium',
    },
    {
      keywords: ['warranty', 'callback', 'rework'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'medium',
    },
    {
      keywords: ['service agreement', 'maintenance contract', 'maintenance plan'],
      accountType: 'revenue',
      confidence: 'high',
      note: 'Recurring maintenance plan revenue',
    },
    {
      keywords: ['permit', 'permits'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'medium',
    },
  ],

  operationalMetrics: [
    // ── Marketing / Acquisition ──
    {
      id: 'cost_per_lead',
      label: 'Cost Per Lead',
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
      benchmark: { good: 40, warn: 100, bad: 200, direction: 'lower' },
    },
    {
      id: 'cost_per_qualified_lead',
      label: 'Cost Per Qualified Lead',
      category: 'Marketing',
      inputFields: [
        { id: 'qualified_leads', label: 'Qualified Leads', unit: 'leads' },
      ],
      formula: 'Marketing Spend ÷ Qualified Leads',
      calculate: (inputs, financials) => {
        if (!inputs['qualified_leads'] || inputs['qualified_leads'] === 0) return null;
        return financials.marketingSpend / inputs['qualified_leads'];
      },
      format: 'currency',
      benchmark: { good: 80, warn: 200, bad: 400, direction: 'lower' },
    },
    {
      id: 'lead_to_qualified_ratio',
      label: 'Lead-to-Qualified Ratio',
      category: 'Marketing',
      inputFields: [
        { id: 'total_leads', label: 'Total Leads', unit: 'leads' },
        { id: 'qualified_leads', label: 'Qualified Leads', unit: 'leads' },
      ],
      formula: 'Qualified Leads ÷ Total Leads',
      calculate: (inputs) => {
        if (!inputs['total_leads'] || inputs['total_leads'] === 0) return null;
        return (inputs['qualified_leads'] ?? 0) / inputs['total_leads'];
      },
      format: 'percent',
      benchmark: { good: 0.60, warn: 0.40, bad: 0.25, direction: 'higher' },
    },
    {
      id: 'close_rate',
      label: 'Close Rate',
      description: 'Jobs sold as a percentage of qualified leads.',
      category: 'Sales',
      inputFields: [
        { id: 'qualified_leads', label: 'Qualified Leads', unit: 'leads' },
        { id: 'jobs_sold', label: 'Jobs Sold', unit: 'jobs' },
      ],
      formula: 'Jobs Sold ÷ Qualified Leads',
      calculate: (inputs) => {
        if (!inputs['qualified_leads'] || inputs['qualified_leads'] === 0) return null;
        return (inputs['jobs_sold'] ?? 0) / inputs['qualified_leads'];
      },
      format: 'percent',
      benchmark: { good: 0.65, warn: 0.45, bad: 0.30, direction: 'higher' },
    },
    {
      id: 'cac',
      label: 'Customer Acquisition Cost (CAC)',
      description: 'Total marketing spend divided by new customers acquired.',
      category: 'Marketing',
      inputFields: [
        { id: 'new_customers', label: 'New Customers', unit: 'customers' },
      ],
      formula: 'Marketing Spend ÷ New Customers',
      calculate: (inputs, financials) => {
        if (!inputs['new_customers'] || inputs['new_customers'] === 0) return null;
        return financials.marketingSpend / inputs['new_customers'];
      },
      format: 'currency',
      benchmark: { good: 150, warn: 350, bad: 600, direction: 'lower' },
    },
    {
      id: 'marketing_pct_revenue',
      label: 'Marketing % of Revenue',
      category: 'Marketing',
      inputFields: [],
      formula: 'Marketing Spend ÷ Revenue',
      calculate: (_inputs, financials) => {
        if (!financials.revenue) return null;
        return financials.marketingSpend / financials.revenue;
      },
      format: 'percent',
      benchmark: { good: 0.06, warn: 0.12, bad: 0.18, direction: 'lower' },
    },
    // ── Capacity ──
    {
      id: 'revenue_per_truck',
      label: 'Revenue Per Truck',
      description: 'Annual revenue divided by number of revenue-generating trucks.',
      category: 'Capacity',
      inputFields: [
        { id: 'truck_count', label: 'Number of Trucks', unit: 'trucks' },
      ],
      formula: 'Revenue ÷ Truck Count',
      calculate: (inputs, financials) => {
        if (!inputs['truck_count'] || inputs['truck_count'] === 0) return null;
        return financials.revenue / inputs['truck_count'];
      },
      format: 'currency',
      benchmark: { good: 250000, warn: 175000, bad: 120000, direction: 'higher' },
    },
    {
      id: 'revenue_per_billable_hour',
      label: 'Revenue Per Billable Hour',
      category: 'Capacity',
      inputFields: [
        { id: 'billable_hours', label: 'Billable Hours', unit: 'hours' },
      ],
      formula: 'Revenue ÷ Billable Hours',
      calculate: (inputs, financials) => {
        if (!inputs['billable_hours'] || inputs['billable_hours'] === 0) return null;
        return financials.revenue / inputs['billable_hours'];
      },
      format: 'currency',
      benchmark: { good: 175, warn: 120, bad: 85, direction: 'higher' },
    },
    {
      id: 'labor_efficiency_ratio',
      label: 'Labor Efficiency Ratio',
      description: 'Ratio of billable hours to total field hours paid.',
      category: 'Capacity',
      inputFields: [
        { id: 'billable_hours', label: 'Billable Hours', unit: 'hours' },
        { id: 'total_field_hours', label: 'Total Field Hours Paid', unit: 'hours' },
      ],
      formula: 'Billable Hours ÷ Total Field Hours',
      calculate: (inputs) => {
        if (!inputs['total_field_hours'] || inputs['total_field_hours'] === 0) return null;
        return (inputs['billable_hours'] ?? 0) / inputs['total_field_hours'];
      },
      format: 'percent',
      benchmark: { good: 0.85, warn: 0.70, bad: 0.55, direction: 'higher' },
    },
    {
      id: 'average_ticket',
      label: 'Average Ticket',
      description: 'Average revenue per job completed.',
      category: 'Sales',
      inputFields: [
        { id: 'jobs_sold', label: 'Jobs Completed', unit: 'jobs' },
      ],
      formula: 'Revenue ÷ Jobs Completed',
      calculate: (inputs, financials) => {
        if (!inputs['jobs_sold'] || inputs['jobs_sold'] === 0) return null;
        return financials.revenue / inputs['jobs_sold'];
      },
      format: 'currency',
      benchmark: { good: 600, warn: 350, bad: 200, direction: 'higher' },
    },
  ],

  benchmarks: [
    { metricId: 'gross_margin', range: { low: 0.35, typical: 0.50, high: 0.65 } },
    { metricId: 'net_margin', range: { low: 0.05, typical: 0.10, high: 0.18 } },
    { metricId: 'current_ratio', range: { low: 1.0, typical: 1.5, high: 2.5 } },
  ],

  defaultGrowthRate: 0.05,
  seasonalityExpected: true,
  defaultProjectionModel: 'seasonal',

  labels: {
    capacityUnit: 'Truck',
    primaryRevenueDriver: 'Service Calls',
    costOfGoodsLabel: 'Cost of Services',
  },
};
