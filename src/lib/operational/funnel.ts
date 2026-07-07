import type { OperationalMetricDef } from '@/types';

/**
 * Marketing Funnel metric group — universal across every industry profile
 * (spread into each profile's operationalMetrics; the profile system stays
 * data-only config).
 *
 * Tracks the conversion funnel dollars → leads → appointments → sales, the
 * marketing analysis accountants like Volpe deliver as part of their service.
 * All five underlying numbers are SHARED INPUTS entered once per period;
 * every rate below derives automatically.
 *
 * Marketing spend resolution: the optional `marketing_spend` input wins when
 * entered; otherwise we fall back to marketing/advertising expense accounts
 * detected in the imported P&L (financials.marketingSpend). This matters for
 * clients who don't break marketing out as its own account.
 *
 * No FinSight default benchmarks here on purpose — funnel economics vary too
 * much by industry and franchise to bless a loose number. Set corporate or
 * custom targets per client in the Targets editor instead.
 */

export const FUNNEL_INPUT_IDS = {
  spend: 'marketing_spend',
  leads: 'total_leads',
  appointments: 'appointments',
  customers: 'new_customers',
  revenue: 'new_customer_revenue',
} as const;

function resolveSpend(
  inputs: Record<string, number>,
  financials: { marketingSpend: number }
): number {
  const manual = inputs[FUNNEL_INPUT_IDS.spend];
  return manual !== undefined && manual > 0 ? manual : financials.marketingSpend;
}

export const MARKETING_FUNNEL_METRICS: OperationalMetricDef[] = [
  {
    id: 'funnel_cost_per_lead',
    label: 'Cost Per Lead',
    description:
      'Marketing dollars spent for each lead generated. Uses the entered marketing spend, or the P&L marketing accounts when left blank.',
    category: 'Marketing Funnel',
    inputFields: [
      {
        id: FUNNEL_INPUT_IDS.spend,
        label: 'Marketing Spend ($)',
        unit: '$',
        description: 'Leave blank to use marketing/advertising accounts from the imported P&L.',
        optional: true,
      },
      { id: FUNNEL_INPUT_IDS.leads, label: 'Leads', unit: 'leads' },
    ],
    formula: 'Marketing Spend ÷ Leads',
    calculate: (inputs, financials) => {
      const leads = inputs[FUNNEL_INPUT_IDS.leads];
      if (!leads) return null;
      const spend = resolveSpend(inputs, financials);
      if (!spend) return null;
      return spend / leads;
    },
    format: 'currency',
  },
  {
    id: 'funnel_lead_to_appointment',
    label: 'Lead → Appointment %',
    description: 'Share of leads that turn into booked appointments, estimates, or demos.',
    category: 'Marketing Funnel',
    inputFields: [
      { id: FUNNEL_INPUT_IDS.leads, label: 'Leads', unit: 'leads' },
      { id: FUNNEL_INPUT_IDS.appointments, label: 'Appointments / Estimates', unit: 'appts' },
    ],
    formula: 'Appointments ÷ Leads',
    calculate: (inputs) => {
      const leads = inputs[FUNNEL_INPUT_IDS.leads];
      if (!leads) return null;
      return (inputs[FUNNEL_INPUT_IDS.appointments] ?? 0) / leads;
    },
    format: 'percent',
  },
  {
    id: 'funnel_appointment_to_close',
    label: 'Appointment → Close %',
    description: 'Share of appointments that become paying customers.',
    category: 'Marketing Funnel',
    inputFields: [
      { id: FUNNEL_INPUT_IDS.appointments, label: 'Appointments / Estimates', unit: 'appts' },
      { id: FUNNEL_INPUT_IDS.customers, label: 'New Customers / Sales', unit: 'customers' },
    ],
    formula: 'New Customers ÷ Appointments',
    calculate: (inputs) => {
      const appts = inputs[FUNNEL_INPUT_IDS.appointments];
      if (!appts) return null;
      return (inputs[FUNNEL_INPUT_IDS.customers] ?? 0) / appts;
    },
    format: 'percent',
  },
  {
    id: 'funnel_lead_to_sale',
    label: 'Lead → Sale %',
    description: 'Overall conversion: share of leads that end as paying customers.',
    category: 'Marketing Funnel',
    inputFields: [
      { id: FUNNEL_INPUT_IDS.leads, label: 'Leads', unit: 'leads' },
      { id: FUNNEL_INPUT_IDS.customers, label: 'New Customers / Sales', unit: 'customers' },
    ],
    formula: 'New Customers ÷ Leads',
    calculate: (inputs) => {
      const leads = inputs[FUNNEL_INPUT_IDS.leads];
      if (!leads) return null;
      return (inputs[FUNNEL_INPUT_IDS.customers] ?? 0) / leads;
    },
    format: 'percent',
  },
  {
    id: 'funnel_cac',
    label: 'Customer Acquisition Cost',
    description: 'Marketing dollars spent for each new customer won.',
    category: 'Marketing Funnel',
    inputFields: [
      {
        id: FUNNEL_INPUT_IDS.spend,
        label: 'Marketing Spend ($)',
        unit: '$',
        description: 'Leave blank to use marketing/advertising accounts from the imported P&L.',
        optional: true,
      },
      { id: FUNNEL_INPUT_IDS.customers, label: 'New Customers / Sales', unit: 'customers' },
    ],
    formula: 'Marketing Spend ÷ New Customers',
    calculate: (inputs, financials) => {
      const customers = inputs[FUNNEL_INPUT_IDS.customers];
      if (!customers) return null;
      const spend = resolveSpend(inputs, financials);
      if (!spend) return null;
      return spend / customers;
    },
    format: 'currency',
  },
  {
    id: 'funnel_marketing_roi',
    label: 'Marketing ROI',
    description:
      'Revenue from new customers for every marketing dollar spent. Above 1.0× means the funnel pays for itself on first sales alone.',
    category: 'Marketing Funnel',
    inputFields: [
      {
        id: FUNNEL_INPUT_IDS.spend,
        label: 'Marketing Spend ($)',
        unit: '$',
        description: 'Leave blank to use marketing/advertising accounts from the imported P&L.',
        optional: true,
      },
      {
        id: FUNNEL_INPUT_IDS.revenue,
        label: 'Revenue From New Customers ($)',
        unit: '$',
        optional: true,
      },
    ],
    formula: 'New-Customer Revenue ÷ Marketing Spend',
    calculate: (inputs, financials) => {
      const revenue = inputs[FUNNEL_INPUT_IDS.revenue];
      if (revenue === undefined) return null;
      const spend = resolveSpend(inputs, financials);
      if (!spend) return null;
      return revenue / spend;
    },
    format: 'ratio',
  },
];
