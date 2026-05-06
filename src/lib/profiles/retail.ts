import type { IndustryProfile } from '@/types';

export const retailProfile: IndustryProfile = {
  id: 'retail',
  name: 'Retail / E-Commerce',
  description:
    'Specialty retailers, boutiques, and online stores. Inventory management, sell-through rates, and basket size are core KPIs. Holiday-heavy seasonality is the norm.',
  icon: '🛍️',

  classificationHints: [
    {
      keywords: ['inventory', 'merchandise', 'product cost', 'cost of goods', 'purchases'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'high',
      note: 'Inventory/merchandise cost is the primary variable COGS for retail',
    },
    {
      keywords: ['freight in', 'shipping in', 'inbound freight', 'landed cost'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'high',
    },
    {
      keywords: ['merchant fee', 'credit card fee', 'payment processing', 'stripe fee', 'square fee'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'high',
      note: 'Payment processing fees scale directly with sales volume',
    },
    {
      keywords: ['shrinkage', 'theft', 'spoilage', 'markdowns'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'medium',
    },
    {
      keywords: ['store rent', 'retail rent', 'location rent'],
      costBehavior: 'fixed',
      confidence: 'high',
    },
    {
      keywords: ['warehouse', 'fulfillment', 'storage'],
      costBehavior: 'mixed',
      confidence: 'medium',
      note: 'Warehouse costs have a fixed base + variable overflow',
    },
    {
      keywords: ['outbound shipping', 'shipping expense', 'postage', 'delivery expense'],
      costBehavior: 'variable',
      confidence: 'high',
    },
    {
      keywords: ['returns', 'refunds', 'chargeback'],
      accountType: 'revenue',
      confidence: 'medium',
      note: 'Returns are a contra-revenue account',
    },
    {
      keywords: ['sales revenue', 'net sales', 'retail sales', 'e-commerce revenue'],
      accountType: 'revenue',
      confidence: 'high',
    },
  ],

  operationalMetrics: [
    {
      id: 'avg_basket_size',
      label: 'Average Basket Size',
      description: 'Average order value per transaction.',
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
      benchmark: { good: 85, warn: 45, bad: 25, direction: 'higher' },
    },
    {
      id: 'units_per_transaction',
      label: 'Units Per Transaction',
      description: 'Average number of items per order.',
      category: 'Sales',
      inputFields: [
        { id: 'units_sold', label: 'Units Sold', unit: 'units' },
        { id: 'transaction_count', label: 'Transaction Count', unit: 'transactions' },
      ],
      formula: 'Units Sold ÷ Transaction Count',
      calculate: (inputs) => {
        if (!inputs['transaction_count'] || inputs['transaction_count'] === 0) return null;
        return (inputs['units_sold'] ?? 0) / inputs['transaction_count'];
      },
      format: 'number',
    },
    {
      id: 'conversion_rate',
      label: 'Conversion Rate',
      description: 'Percentage of visitors/sessions that result in a purchase.',
      category: 'Marketing',
      inputFields: [
        { id: 'sessions', label: 'Sessions / Foot Traffic', unit: 'visitors' },
        { id: 'transaction_count', label: 'Transactions', unit: 'transactions' },
      ],
      formula: 'Transactions ÷ Sessions',
      calculate: (inputs) => {
        if (!inputs['sessions'] || inputs['sessions'] === 0) return null;
        return (inputs['transaction_count'] ?? 0) / inputs['sessions'];
      },
      format: 'percent',
      benchmark: { good: 0.04, warn: 0.02, bad: 0.01, direction: 'higher' },
    },
    {
      id: 'return_rate',
      label: 'Return Rate',
      description: 'Units returned as a percentage of units sold.',
      category: 'Operations',
      inputFields: [
        { id: 'units_returned', label: 'Units Returned', unit: 'units' },
        { id: 'units_sold', label: 'Units Sold', unit: 'units' },
      ],
      formula: 'Units Returned ÷ Units Sold',
      calculate: (inputs) => {
        if (!inputs['units_sold'] || inputs['units_sold'] === 0) return null;
        return (inputs['units_returned'] ?? 0) / inputs['units_sold'];
      },
      format: 'percent',
      benchmark: { good: 0.05, warn: 0.12, bad: 0.20, direction: 'lower' },
    },
    {
      id: 'sell_through_rate',
      label: 'Sell-Through Rate',
      description: 'Units sold as a percentage of units received in the period.',
      category: 'Inventory',
      inputFields: [
        { id: 'units_sold', label: 'Units Sold', unit: 'units' },
        { id: 'units_received', label: 'Units Received', unit: 'units' },
      ],
      formula: 'Units Sold ÷ Units Received',
      calculate: (inputs) => {
        if (!inputs['units_received'] || inputs['units_received'] === 0) return null;
        return (inputs['units_sold'] ?? 0) / inputs['units_received'];
      },
      format: 'percent',
      benchmark: { good: 0.80, warn: 0.60, bad: 0.40, direction: 'higher' },
    },
    {
      id: 'sales_per_sqft',
      label: 'Sales Per Square Foot',
      description: 'Annual revenue per square foot of retail space.',
      category: 'Operations',
      inputFields: [
        { id: 'square_footage', label: 'Square Footage', unit: 'sq ft', optional: true },
      ],
      formula: 'Revenue ÷ Square Footage',
      calculate: (inputs, financials) => {
        if (!inputs['square_footage'] || inputs['square_footage'] === 0) return null;
        return financials.revenue / inputs['square_footage'];
      },
      format: 'currency',
      benchmark: { good: 400, warn: 200, bad: 100, direction: 'higher' },
    },
  ],

  benchmarks: [
    { metricId: 'gross_margin', range: { low: 0.30, typical: 0.45, high: 0.60 } },
    { metricId: 'net_margin', range: { low: 0.02, typical: 0.06, high: 0.12 } },
    { metricId: 'current_ratio', range: { low: 1.0, typical: 1.5, high: 2.5 } },
  ],

  defaultGrowthRate: 0.04,
  seasonalityExpected: true,
  defaultProjectionModel: 'seasonal',

  labels: {
    capacityUnit: 'Location',
    primaryRevenueDriver: 'Transactions',
    costOfGoodsLabel: 'Cost of Goods Sold',
  },
};
