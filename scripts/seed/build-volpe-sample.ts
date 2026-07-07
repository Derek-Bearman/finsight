/**
 * Generates the sample franchise-restaurant client for Bob Volpe's
 * complimentary firm: "Bella Roma Pizza #42" — a franchisee with
 * 12 months of P&L + balance sheet, marketing-funnel shared inputs,
 * restaurant operational inputs, and corporate-mandated targets, so every
 * feature demos itself the moment Bob opens the workspace.
 *
 * Deterministic (seeded PRNG) — same output every run.
 *
 *   npx tsx scripts/seed/build-volpe-sample.ts > /path/to/out.json
 *
 * The JSON is a full ClientWorkspace blob ready for the workspaces.data
 * column (id/name/industry_profile are still layered from the row columns).
 */

import type {
  Account,
  AccountValue,
  ClientWorkspace,
  OperationalInputPool,
  Period,
} from '../../src/types';

// Mulberry32 — tiny deterministic PRNG.
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const jitter = (base: number, pct: number) => base * (1 + (rand() * 2 - 1) * pct);
const round = (n: number) => Math.round(n);

// ── Periods: Jul 2025 – Jun 2026 ─────────────────────────────────────────────
const PERIODS: Period[] = [];
for (let i = 0; i < 12; i++) {
  const month = ((6 + i) % 12) + 1; // 7..12,1..6
  const year = month >= 7 ? 2025 : 2026;
  PERIODS.push({ year, month });
}

// Seasonality for a pizza franchise (strong fall/winter, softer summer).
const SEASON: Record<number, number> = {
  1: 1.02, 2: 0.98, 3: 1.0, 4: 1.01, 5: 1.03, 6: 0.97,
  7: 0.92, 8: 0.95, 9: 1.0, 10: 1.05, 11: 1.08, 12: 1.12,
};

// ── Accounts ────────────────────────────────────────────────────────────────
const acc = (
  id: string,
  name: string,
  type: Account['type'],
  opts: Partial<Account> = {}
): Account => ({
  id,
  name,
  type,
  isManuallyClassified: false,
  classificationSource: 'profile_keyword',
  classificationConfidence: 'high',
  ...opts,
});

const accounts: Account[] = [
  // Revenue
  acc('rev-food', 'Food Sales', 'revenue', { number: '4000' }),
  acc('rev-bev', 'Beverage Sales', 'revenue', { number: '4100' }),
  acc('rev-catering', 'Catering Revenue', 'revenue', { number: '4200' }),
  acc('rev-delivery', 'Delivery Revenue', 'revenue', { number: '4300' }),
  // COGS
  acc('cogs-food', 'Food Purchases', 'cogs', { number: '5000', costBehavior: 'variable' }),
  acc('cogs-bev', 'Beverage Cost', 'cogs', { number: '5100', costBehavior: 'variable' }),
  acc('cogs-paper', 'Paper Goods & To-Go Supplies', 'cogs', { number: '5200', costBehavior: 'variable' }),
  acc('cogs-delivery', 'Third Party Delivery Commissions', 'cogs', { number: '5300', costBehavior: 'variable' }),
  // Expenses
  acc('exp-mgmt', 'Manager Salaries', 'expense', { number: '6000', costBehavior: 'fixed' }),
  acc('exp-hourly', 'Hourly Wages', 'expense', { number: '6100', costBehavior: 'variable' }),
  acc('exp-payroll-tax', 'Payroll Taxes & Benefits', 'expense', { number: '6200', costBehavior: 'variable' }),
  acc('exp-rent', 'Base Rent', 'expense', { number: '6300', costBehavior: 'fixed' }),
  acc('exp-utilities', 'Utilities', 'expense', { number: '6400', costBehavior: 'mixed', mixedFixedPercent: 0.6 }),
  acc('exp-marketing', 'Marketing & Advertising', 'expense', { number: '6500', costBehavior: 'variable' }),
  acc('exp-royalty', 'Franchise Royalty Fees', 'expense', { number: '6600', costBehavior: 'variable' }),
  acc('exp-adfund', 'Corporate Ad Fund Contribution', 'expense', { number: '6650', costBehavior: 'variable' }),
  acc('exp-insurance', 'Insurance', 'expense', { number: '6700', costBehavior: 'fixed' }),
  acc('exp-repairs', 'Repairs & Maintenance', 'expense', { number: '6800', costBehavior: 'mixed', mixedFixedPercent: 0.4 }),
  acc('exp-pos', 'POS & Processing Fees', 'expense', { number: '6900', costBehavior: 'variable' }),
  acc('exp-interest', 'Interest Expense', 'expense', { number: '7000', costBehavior: 'fixed' }),
  // Balance sheet
  acc('bs-cash', 'Business Checking', 'asset', { number: '1010' }),
  acc('bs-ar', 'Accounts Receivable', 'asset', { number: '1100' }),
  acc('bs-inventory', 'Food Inventory', 'asset', { number: '1300' }),
  acc('bs-equipment', 'Kitchen Equipment (Net)', 'asset', { number: '1500' }),
  acc('bs-leasehold', 'Leasehold Improvements (Net)', 'asset', { number: '1600' }),
  acc('bs-ap', 'Accounts Payable', 'liability', { number: '2010' }),
  acc('bs-cc', 'Credit Card Payable', 'liability', { number: '2100' }),
  acc('bs-accrued', 'Accrued Payroll', 'liability', { number: '2200' }),
  acc('bs-loan', 'Equipment Loan (Long Term)', 'liability', { number: '2600' }),
  acc('bs-equity', 'Owner Capital', 'equity', { number: '3000' }),
  acc('bs-retained', 'Retained Earnings', 'equity', { number: '3900' }),
];

// ── Values ──────────────────────────────────────────────────────────────────
const values: AccountValue[] = [];
const pools: OperationalInputPool[] = [];

let cash = 38000;
let retained = 61000;

PERIODS.forEach((period, i) => {
  const growth = 1 + 0.006 * i; // ~7% annualized growth
  const season = SEASON[period.month]!;
  const scale = growth * season;

  const food = round(jitter(52000 * scale, 0.02));
  const bev = round(jitter(9500 * scale, 0.03));
  const catering = round(jitter(4200 * scale, 0.12));
  const delivery = round(jitter(8800 * scale, 0.04));
  const revenue = food + bev + catering + delivery;

  const cogsFood = round(food * jitter(0.31, 0.03)); // hovers around the 30% mandate
  const cogsBev = round(bev * jitter(0.24, 0.04));
  const cogsPaper = round(revenue * jitter(0.025, 0.05));
  const cogsDelivery = round(delivery * jitter(0.27, 0.03));

  const mgmt = 9800;
  const hourly = round(revenue * jitter(0.165, 0.03));
  const payrollTax = round((mgmt + hourly) * 0.12);
  const rent = 6400;
  const utilities = round(jitter(1900 * season, 0.05));
  const marketing = round(jitter(2100 * (1 + 0.012 * i), 0.05)); // creeping up
  const royalty = round(revenue * 0.05); // corporate 5% royalty
  const adFund = round(revenue * 0.02); // corporate 2% ad fund
  const insurance = 1150;
  const repairs = round(jitter(900, 0.35));
  const pos = round(revenue * 0.021);
  const interest = 420;

  const push = (accountId: string, amount: number) =>
    values.push({ accountId, period, amount });

  push('rev-food', food);
  push('rev-bev', bev);
  push('rev-catering', catering);
  push('rev-delivery', delivery);
  push('cogs-food', cogsFood);
  push('cogs-bev', cogsBev);
  push('cogs-paper', cogsPaper);
  push('cogs-delivery', cogsDelivery);
  push('exp-mgmt', mgmt);
  push('exp-hourly', hourly);
  push('exp-payroll-tax', payrollTax);
  push('exp-rent', rent);
  push('exp-utilities', utilities);
  push('exp-marketing', marketing);
  push('exp-royalty', royalty);
  push('exp-adfund', adFund);
  push('exp-insurance', insurance);
  push('exp-repairs', repairs);
  push('exp-pos', pos);
  push('exp-interest', interest);

  const totalCogs = cogsFood + cogsBev + cogsPaper + cogsDelivery;
  const totalExp =
    mgmt + hourly + payrollTax + rent + utilities + marketing + royalty + adFund + insurance + repairs + pos + interest;
  const netIncome = revenue - totalCogs - totalExp;

  // Balance sheet walks forward with earnings; retained earnings is the
  // balancing figure so assets always equal liabilities + equity.
  cash = round(cash + netIncome * 0.75);
  const ar = round(jitter(6200 * scale, 0.15));
  const inventory = round(jitter(7800 * scale, 0.08));
  const equipment = round(96000 - i * 800); // depreciating
  const leasehold = round(58000 - i * 480);
  const ap = round(jitter(11500 * scale, 0.1));
  const cc = round(jitter(3400, 0.25));
  const accrued = round(jitter(5200 * scale, 0.08));
  const loan = round(52000 - i * 950); // amortizing
  const ownerCapital = 85000;
  retained =
    cash + ar + inventory + equipment + leasehold - (ap + cc + accrued + loan) - ownerCapital;
  push('bs-cash', cash);
  push('bs-ar', ar);
  push('bs-inventory', inventory);
  push('bs-equipment', equipment);
  push('bs-leasehold', leasehold);
  push('bs-ap', ap);
  push('bs-cc', cc);
  push('bs-accrued', accrued);
  push('bs-loan', loan);
  push('bs-equity', ownerCapital);
  push('bs-retained', retained);

  // Shared operational inputs: marketing funnel + restaurant metrics,
  // entered once per period (the new shared-input pool).
  const leads = round(jitter(118 * (1 + 0.004 * i) * (marketing / 2100), 0.08));
  const appointments = round(leads * jitter(0.42, 0.08)); // catering tastings/quotes
  const newCustomers = round(appointments * jitter(0.55, 0.08));
  const covers = round(revenue / jitter(24.5, 0.03));
  pools.push({
    period,
    sharedInputs: {
      marketing_spend: marketing,
      total_leads: leads,
      appointments,
      new_customers: newCustomers,
      new_customer_revenue: round(newCustomers * jitter(310, 0.1)),
      total_labor_cost: mgmt + hourly + payrollTax,
      covers,
      seats: 86,
      beverage_revenue: bev,
    },
  });
});

// ── The workspace blob ──────────────────────────────────────────────────────
const workspace: Omit<ClientWorkspace, 'id'> & { id: string } = {
  id: 'PLACEHOLDER', // overridden by the DB row id via rowToWorkspace
  name: 'Bella Roma Pizza #42',
  industryProfileId: 'restaurant',
  accounts,
  values,
  fiscalYearStart: 1,
  scenarios: [],
  operationalData: [],
  operationalInputs: pools,
  targets: {
    ratios: {
      net_margin: { value: 0.08, direction: 'at_least', source: 'corporate' },
      gross_margin: { value: 0.68, direction: 'at_least', source: 'corporate' },
      current_ratio: { value: 1.2, direction: 'at_least', source: 'custom' },
    },
    metrics: {
      food_cost_pct: { value: 0.3, direction: 'at_most', source: 'corporate' },
      labor_cost_pct: { value: 0.28, direction: 'at_most', source: 'corporate' },
      prime_cost: { value: 0.6, direction: 'at_most', source: 'corporate' },
      funnel_cac: { value: 45, direction: 'at_most', source: 'custom' },
    },
  },
  customMetrics: [],
  auditLog: [],
  createdAt: new Date('2026-07-07T12:00:00Z').toISOString(),
  updatedAt: new Date('2026-07-07T12:00:00Z').toISOString(),
};

process.stdout.write(JSON.stringify(workspace));
