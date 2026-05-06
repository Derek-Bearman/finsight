import type { IndustryProfile } from '@/types';

export const restaurantProfile: IndustryProfile = {
  id: 'restaurant',
  name: 'Restaurant / Food Service',
  description:
    'Single-location and multi-unit restaurants, cafes, and food service operations. Prime cost (food + labor) is the defining metric. Revenue per cover and table turnover drive profitability.',
  icon: '🍽️',

  classificationHints: [
    {
      keywords: ['food cost', 'food purchases', 'produce', 'meat', 'seafood', 'dairy', 'dry goods'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'high',
      note: 'Food cost is the primary variable COGS for restaurants',
    },
    {
      keywords: ['liquor', 'beer', 'wine', 'beverage cost', 'bar supplies'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'high',
    },
    {
      keywords: ['linen service', 'linen', 'uniform laundry'],
      costBehavior: 'mixed',
      confidence: 'medium',
      note: 'Linen/laundry has a fixed base plus variable usage component',
    },
    {
      keywords: ['kitchen supplies', 'paper goods', 'disposables', 'to-go supplies'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'high',
    },
    {
      keywords: ['server', 'server wages', 'bartender', 'host wages', 'front of house', 'foh wages'],
      accountType: 'cogs',
      costBehavior: 'mixed',
      confidence: 'medium',
      note: 'FOH labor is mixed — minimum staffing fixed, extra covers variable',
    },
    {
      keywords: ['kitchen labor', 'cook', 'chef wages', 'back of house', 'boh wages'],
      accountType: 'cogs',
      costBehavior: 'mixed',
      confidence: 'medium',
    },
    {
      keywords: ['delivery commission', 'doordash', 'grubhub', 'uber eats', 'third party delivery'],
      accountType: 'cogs',
      costBehavior: 'variable',
      confidence: 'high',
      note: 'Delivery platform commissions are a percentage of delivery revenue',
    },
    {
      keywords: ['food revenue', 'dining revenue', 'restaurant sales'],
      accountType: 'revenue',
      confidence: 'high',
    },
    {
      keywords: ['beverage revenue', 'bar revenue', 'liquor revenue'],
      accountType: 'revenue',
      confidence: 'high',
    },
    {
      keywords: ['rent', 'location rent', 'base rent'],
      costBehavior: 'fixed',
      confidence: 'high',
    },
  ],

  operationalMetrics: [
    {
      id: 'prime_cost',
      label: 'Prime Cost %',
      description: 'Food cost + labor cost as a percentage of revenue. The single most important restaurant metric.',
      category: 'Core',
      inputFields: [
        { id: 'total_labor_cost', label: 'Total Labor Cost ($)', unit: '$' },
      ],
      formula: '(COGS + Labor Cost) ÷ Revenue',
      calculate: (inputs, financials) => {
        if (!financials.revenue) return null;
        const labor = inputs['total_labor_cost'] ?? 0;
        return (financials.cogs + labor) / financials.revenue;
      },
      format: 'percent',
      benchmark: { good: 0.58, warn: 0.65, bad: 0.72, direction: 'lower' },
    },
    {
      id: 'food_cost_pct',
      label: 'Food Cost %',
      description: 'Food purchases as a percentage of food revenue.',
      category: 'Core',
      inputFields: [],
      formula: 'COGS ÷ Revenue',
      calculate: (_inputs, financials) => {
        if (!financials.revenue) return null;
        return financials.cogs / financials.revenue;
      },
      format: 'percent',
      benchmark: { good: 0.28, warn: 0.33, bad: 0.38, direction: 'lower' },
    },
    {
      id: 'labor_cost_pct',
      label: 'Labor Cost %',
      description: 'Total labor (FOH + BOH) as a percentage of revenue.',
      category: 'Core',
      inputFields: [
        { id: 'total_labor_cost', label: 'Total Labor Cost ($)', unit: '$' },
      ],
      formula: 'Total Labor Cost ÷ Revenue',
      calculate: (inputs, financials) => {
        if (!financials.revenue) return null;
        return (inputs['total_labor_cost'] ?? 0) / financials.revenue;
      },
      format: 'percent',
      benchmark: { good: 0.28, warn: 0.35, bad: 0.40, direction: 'lower' },
    },
    {
      id: 'sales_per_cover',
      label: 'Sales Per Cover',
      description: 'Average check size per guest.',
      category: 'Revenue',
      inputFields: [
        { id: 'covers', label: 'Covers (Guests Served)', unit: 'covers' },
      ],
      formula: 'Revenue ÷ Covers',
      calculate: (inputs, financials) => {
        if (!inputs['covers'] || inputs['covers'] === 0) return null;
        return financials.revenue / inputs['covers'];
      },
      format: 'currency',
      benchmark: { good: 55, warn: 35, bad: 22, direction: 'higher' },
    },
    {
      id: 'table_turnover',
      label: 'Table Turnover Rate',
      description: 'Average number of times each seat is used per service period.',
      category: 'Operations',
      inputFields: [
        { id: 'covers', label: 'Covers (Guests Served)', unit: 'covers' },
        { id: 'seats', label: 'Available Seats', unit: 'seats', optional: true },
      ],
      formula: 'Covers ÷ Available Seats',
      calculate: (inputs) => {
        if (!inputs['seats'] || inputs['seats'] === 0) return null;
        return (inputs['covers'] ?? 0) / inputs['seats'];
      },
      format: 'number',
      benchmark: { good: 3.0, warn: 2.0, bad: 1.5, direction: 'higher' },
    },
    {
      id: 'beverage_mix_pct',
      label: 'Beverage Mix %',
      description: 'Beverage revenue as a percentage of total revenue. Higher beverage mix improves overall margins.',
      category: 'Revenue',
      inputFields: [
        { id: 'beverage_revenue', label: 'Beverage Revenue ($)', unit: '$' },
      ],
      formula: 'Beverage Revenue ÷ Total Revenue',
      calculate: (inputs, financials) => {
        if (!financials.revenue) return null;
        return (inputs['beverage_revenue'] ?? 0) / financials.revenue;
      },
      format: 'percent',
      benchmark: { good: 0.30, warn: 0.20, bad: 0.12, direction: 'higher' },
    },
  ],

  benchmarks: [
    { metricId: 'gross_margin', range: { low: 0.55, typical: 0.65, high: 0.75 } },
    { metricId: 'net_margin', range: { low: 0.03, typical: 0.06, high: 0.12 } },
    { metricId: 'current_ratio', range: { low: 0.5, typical: 1.0, high: 1.5 } },
  ],

  defaultGrowthRate: 0.03,
  seasonalityExpected: true,
  defaultProjectionModel: 'seasonal',

  labels: {
    capacityUnit: 'Location',
    primaryRevenueDriver: 'Covers',
    costOfGoodsLabel: 'Food & Beverage Cost',
  },
};
