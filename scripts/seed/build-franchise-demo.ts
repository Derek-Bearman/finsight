/**
 * Franchise practice pack generator (FRANCHISE_BENCHMARKS_PLAN.md follow-up).
 *
 * Produces a deterministic corporate franchise + 5 franchisees with 5 full
 * years (60 months) of monthly P&L + Balance Sheet in QBO-report account shape,
 * plus a corporate benchmark set and a corporate SCOA — so Derek can practice
 * and demo the franchise features (comparison, benchmark precedence, SCOA
 * audit/mapping) with realistic, varied data.
 *
 *   npx tsx scripts/seed/build-franchise-demo.ts <outDir>
 *
 * Writes to <outDir> (default scripts/seed/franchise-demo-assets/):
 *   seed.json                       — full payload for DB seeding
 *   corporate-benchmark.csv         — for the upload-practice flow
 *   corporate-scoa.csv              — for the SCOA upload-practice flow
 *   sample-pnl-<id>.csv             — one franchisee P&L for import practice
 *   sample-balancesheet-<id>.csv    — one franchisee BS for import practice
 *
 * Franchisees have deliberately varied performance (star / solid / average /
 * struggling / turnaround) and two carry COA drift so the SCOA audit shows
 * missing / extra / discrepancy buckets. Percent metrics in seed.json are
 * stored as 0-1 fractions (KpiTarget semantics); the benchmark CSV uses whole
 * percents (upload-flow semantics).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Account, AccountValue, ClientWorkspace, OperationalInputPool, Period } from '../../src/types';

// Mulberry32 — deterministic PRNG.
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (n: number) => Math.round(n);

// 60 months: Jan 2021 – Dec 2025 (5 full calendar years).
const PERIODS: Period[] = [];
for (let y = 2021; y <= 2025; y++) for (let m = 1; m <= 12; m++) PERIODS.push({ year: y, month: m });

// Pizza-franchise seasonality (strong fall/winter).
const SEASON: Record<number, number> = {
  1: 1.02, 2: 0.98, 3: 1.0, 4: 1.01, 5: 1.03, 6: 0.97,
  7: 0.92, 8: 0.95, 9: 1.0, 10: 1.05, 11: 1.08, 12: 1.12,
};

// ── Canonical corporate chart of accounts (the SCOA) ─────────────────────────
interface CoaDef {
  key: string; // stable internal id suffix
  number: string;
  name: string;
  type: Account['type'];
  costBehavior?: Account['costBehavior'];
  mixedFixedPercent?: number;
  statementType: 'pnl' | 'balance';
}

const CANONICAL_COA: CoaDef[] = [
  { key: 'rev-food', number: '4000', name: 'Food Sales', type: 'revenue', statementType: 'pnl' },
  { key: 'rev-bev', number: '4100', name: 'Beverage Sales', type: 'revenue', statementType: 'pnl' },
  { key: 'rev-catering', number: '4200', name: 'Catering Revenue', type: 'revenue', statementType: 'pnl' },
  { key: 'rev-delivery', number: '4300', name: 'Delivery Revenue', type: 'revenue', statementType: 'pnl' },
  { key: 'cogs-food', number: '5000', name: 'Food Purchases', type: 'cogs', costBehavior: 'variable', statementType: 'pnl' },
  { key: 'cogs-bev', number: '5100', name: 'Beverage Cost', type: 'cogs', costBehavior: 'variable', statementType: 'pnl' },
  { key: 'cogs-paper', number: '5200', name: 'Paper Goods & To-Go Supplies', type: 'cogs', costBehavior: 'variable', statementType: 'pnl' },
  { key: 'cogs-delivery', number: '5300', name: 'Third Party Delivery Commissions', type: 'cogs', costBehavior: 'variable', statementType: 'pnl' },
  { key: 'exp-mgmt', number: '6000', name: 'Manager Salaries', type: 'expense', costBehavior: 'fixed', statementType: 'pnl' },
  { key: 'exp-hourly', number: '6100', name: 'Hourly Wages', type: 'expense', costBehavior: 'variable', statementType: 'pnl' },
  { key: 'exp-payroll-tax', number: '6200', name: 'Payroll Taxes & Benefits', type: 'expense', costBehavior: 'variable', statementType: 'pnl' },
  { key: 'exp-rent', number: '6300', name: 'Base Rent', type: 'expense', costBehavior: 'fixed', statementType: 'pnl' },
  { key: 'exp-utilities', number: '6400', name: 'Utilities', type: 'expense', costBehavior: 'mixed', mixedFixedPercent: 0.6, statementType: 'pnl' },
  { key: 'exp-marketing', number: '6500', name: 'Marketing & Advertising', type: 'expense', costBehavior: 'variable', statementType: 'pnl' },
  { key: 'exp-royalty', number: '6600', name: 'Franchise Royalty Fees', type: 'expense', costBehavior: 'variable', statementType: 'pnl' },
  { key: 'exp-adfund', number: '6650', name: 'Corporate Ad Fund Contribution', type: 'expense', costBehavior: 'variable', statementType: 'pnl' },
  { key: 'exp-insurance', number: '6700', name: 'Insurance', type: 'expense', costBehavior: 'fixed', statementType: 'pnl' },
  { key: 'exp-repairs', number: '6800', name: 'Repairs & Maintenance', type: 'expense', costBehavior: 'mixed', mixedFixedPercent: 0.4, statementType: 'pnl' },
  { key: 'exp-pos', number: '6900', name: 'POS & Processing Fees', type: 'expense', costBehavior: 'variable', statementType: 'pnl' },
  { key: 'exp-interest', number: '7000', name: 'Interest Expense', type: 'expense', costBehavior: 'fixed', statementType: 'pnl' },
  { key: 'bs-cash', number: '1010', name: 'Business Checking', type: 'asset', statementType: 'balance' },
  { key: 'bs-ar', number: '1100', name: 'Accounts Receivable', type: 'asset', statementType: 'balance' },
  { key: 'bs-inventory', number: '1300', name: 'Food Inventory', type: 'asset', statementType: 'balance' },
  { key: 'bs-equipment', number: '1500', name: 'Kitchen Equipment (Net)', type: 'asset', statementType: 'balance' },
  { key: 'bs-leasehold', number: '1600', name: 'Leasehold Improvements (Net)', type: 'asset', statementType: 'balance' },
  { key: 'bs-ap', number: '2010', name: 'Accounts Payable', type: 'liability', statementType: 'balance' },
  { key: 'bs-cc', number: '2100', name: 'Credit Card Payable', type: 'liability', statementType: 'balance' },
  { key: 'bs-accrued', number: '2200', name: 'Accrued Payroll', type: 'liability', statementType: 'balance' },
  { key: 'bs-loan', number: '2600', name: 'Equipment Loan (Long Term)', type: 'liability', statementType: 'balance' },
  { key: 'bs-equity', number: '3000', name: 'Owner Capital', type: 'equity', statementType: 'balance' },
  { key: 'bs-retained', number: '3900', name: 'Retained Earnings', type: 'equity', statementType: 'balance' },
];

// ── Franchisee profiles (varied performance + COA drift) ─────────────────────
type Drift = 'none' | 'missing-catering' | 'rename-and-extra';
interface FranchiseeDef {
  id: number;
  name: string;
  seed: number;
  revBase: number;    // starting monthly food revenue anchor
  monthlyGrowth: number; // per-month compounding growth
  foodPct: number;    // food cost as % of food sales
  laborPct: number;   // hourly wages as % of revenue
  marketingBase: number;
  drift: Drift;
  note: string;
}

const FRANCHISEES: FranchiseeDef[] = [
  { id: 101, name: 'Pizza Palace #101 (Downtown)', seed: 101, revBase: 61000, monthlyGrowth: 0.009, foodPct: 0.275, laborPct: 0.152, marketingBase: 2200, drift: 'none', note: 'Star: beats corporate on nearly every metric.' },
  { id: 102, name: 'Pizza Palace #102 (Westside)', seed: 102, revBase: 47000, monthlyGrowth: 0.006, foodPct: 0.298, laborPct: 0.168, marketingBase: 1850, drift: 'none', note: 'Solid: meets most corporate targets.' },
  { id: 103, name: 'Pizza Palace #103 (Airport)', seed: 103, revBase: 40000, monthlyGrowth: 0.004, foodPct: 0.315, laborPct: 0.185, marketingBase: 1500, drift: 'missing-catering', note: 'Average, and no catering line (SCOA shows a missing account).' },
  { id: 104, name: 'Pizza Palace #104 (Suburban)', seed: 104, revBase: 36000, monthlyGrowth: 0.0015, foodPct: 0.348, laborPct: 0.206, marketingBase: 1250, drift: 'rename-and-extra', note: 'Struggling + COA drift (renamed food-cost account, extra gift-card liability).' },
  { id: 105, name: 'Pizza Palace #105 (University)', seed: 105, revBase: 32000, monthlyGrowth: 0.015, foodPct: 0.33, laborPct: 0.188, marketingBase: 1600, drift: 'none', note: 'Turnaround: low base, strongest growth, ends near corporate.' },
];

const acc = (id: string, name: string, type: Account['type'], opts: Partial<Account> = {}): Account => ({
  id,
  name,
  type,
  isManuallyClassified: false,
  classificationSource: 'profile_keyword',
  classificationConfidence: 'high',
  ...opts,
});

function buildAccounts(def: FranchiseeDef): Account[] {
  const out: Account[] = [];
  for (const c of CANONICAL_COA) {
    if (def.drift === 'missing-catering' && c.key === 'rev-catering') continue; // omit -> "missing from client"
    let name = c.name;
    if (def.drift === 'rename-and-extra' && c.key === 'cogs-food') name = 'Food & Ingredient Costs'; // number matches, name drifts
    out.push(
      acc(`${def.id}-${c.key}`, name, c.type, {
        number: c.number,
        ...(c.costBehavior ? { costBehavior: c.costBehavior } : {}),
        ...(c.mixedFixedPercent !== undefined ? { mixedFixedPercent: c.mixedFixedPercent } : {}),
      })
    );
  }
  if (def.drift === 'rename-and-extra') {
    // Extra client account not present in the SCOA.
    out.push(acc(`${def.id}-bs-giftcard`, 'Gift Card Liability', 'liability', { number: '2400' }));
  }
  return out;
}

function buildValues(def: FranchiseeDef): { values: AccountValue[]; pools: OperationalInputPool[] } {
  const rand = mulberry32(def.seed);
  const jitter = (base: number, pct: number) => base * (1 + (rand() * 2 - 1) * pct);
  const values: AccountValue[] = [];
  const pools: OperationalInputPool[] = [];
  const has = (key: string) => !(def.drift === 'missing-catering' && key === 'rev-catering');
  const push = (key: string, period: Period, amount: number) => {
    const id = def.drift === 'rename-and-extra' && key === 'cogs-food' ? `${def.id}-cogs-food` : `${def.id}-${key}`;
    values.push({ accountId: id, period, amount });
  };

  let cash = def.revBase * 0.7;
  const ownerCapital = round(def.revBase * 1.4);

  PERIODS.forEach((period, i) => {
    const growth = Math.pow(1 + def.monthlyGrowth, i);
    const season = SEASON[period.month]!;
    const scale = growth * season;

    const food = round(jitter(def.revBase * scale, 0.02));
    const bev = round(jitter(def.revBase * 0.18 * scale, 0.03));
    const catering = has('rev-catering') ? round(jitter(def.revBase * 0.08 * scale, 0.12)) : 0;
    const delivery = round(jitter(def.revBase * 0.17 * scale, 0.04));
    const revenue = food + bev + catering + delivery;

    const cogsFood = round(food * jitter(def.foodPct, 0.03));
    const cogsBev = round(bev * jitter(0.24, 0.04));
    const cogsPaper = round(revenue * jitter(0.025, 0.05));
    const cogsDelivery = round(delivery * jitter(0.27, 0.03));

    const mgmt = round(def.revBase * 0.17);
    const hourly = round(revenue * jitter(def.laborPct, 0.03));
    const payrollTax = round((mgmt + hourly) * 0.12);
    const rent = round(def.revBase * 0.11);
    const utilities = round(jitter(def.revBase * 0.033 * season, 0.05));
    const marketing = round(jitter(def.marketingBase * (1 + 0.01 * i), 0.05));
    const royalty = round(revenue * 0.05);
    const adFund = round(revenue * 0.02);
    const insurance = round(def.revBase * 0.02);
    const repairs = round(jitter(def.revBase * 0.016, 0.35));
    const pos = round(revenue * 0.021);
    const interest = round(def.revBase * 0.007);

    push('rev-food', period, food);
    push('rev-bev', period, bev);
    if (has('rev-catering')) push('rev-catering', period, catering);
    push('rev-delivery', period, delivery);
    push('cogs-food', period, cogsFood);
    push('cogs-bev', period, cogsBev);
    push('cogs-paper', period, cogsPaper);
    push('cogs-delivery', period, cogsDelivery);
    push('exp-mgmt', period, mgmt);
    push('exp-hourly', period, hourly);
    push('exp-payroll-tax', period, payrollTax);
    push('exp-rent', period, rent);
    push('exp-utilities', period, utilities);
    push('exp-marketing', period, marketing);
    push('exp-royalty', period, royalty);
    push('exp-adfund', period, adFund);
    push('exp-insurance', period, insurance);
    push('exp-repairs', period, repairs);
    push('exp-pos', period, pos);
    push('exp-interest', period, interest);

    const totalCogs = cogsFood + cogsBev + cogsPaper + cogsDelivery;
    const totalExp = mgmt + hourly + payrollTax + rent + utilities + marketing + royalty + adFund + insurance + repairs + pos + interest;
    const netIncome = revenue - totalCogs - totalExp;

    cash = round(cash + netIncome * 0.7);
    const ar = round(jitter(def.revBase * 0.1 * scale, 0.15));
    const inventory = round(jitter(def.revBase * 0.13 * scale, 0.08));
    const equipment = round(def.revBase * 1.6 - i * (def.revBase * 0.012));
    const leasehold = round(def.revBase * 0.95 - i * (def.revBase * 0.007));
    const ap = round(jitter(def.revBase * 0.19 * scale, 0.1));
    const cc = round(jitter(def.revBase * 0.055, 0.25));
    const accrued = round(jitter(def.revBase * 0.085 * scale, 0.08));
    const loan = Math.max(0, round(def.revBase * 0.85 - i * (def.revBase * 0.014)));
    const giftcard = def.drift === 'rename-and-extra' ? round(jitter(def.revBase * 0.04, 0.2)) : 0;
    const liabilities = ap + cc + accrued + loan + giftcard;
    const retained = cash + ar + inventory + equipment + leasehold - liabilities - ownerCapital;

    push('bs-cash', period, cash);
    push('bs-ar', period, ar);
    push('bs-inventory', period, inventory);
    push('bs-equipment', period, equipment);
    push('bs-leasehold', period, leasehold);
    push('bs-ap', period, ap);
    push('bs-cc', period, cc);
    push('bs-accrued', period, accrued);
    push('bs-loan', period, loan);
    if (def.drift === 'rename-and-extra') push('bs-giftcard', period, giftcard);
    push('bs-equity', period, ownerCapital);
    push('bs-retained', period, retained);

    const leads = round(jitter(120 * (1 + 0.004 * i) * (marketing / def.marketingBase), 0.08));
    const appointments = round(leads * jitter(0.42, 0.08));
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
        seats: 84,
        beverage_revenue: bev,
      },
    });
  });

  return { values, pools };
}

// ── Corporate benchmark set (stored fractions) + CSV (whole percents) ────────
const BENCHMARK_ROWS: { metricId: string; whole: number; frac: number; direction: 'gte' | 'lte'; percent: boolean; notes: string }[] = [
  { metricId: 'gross_margin', whole: 68, frac: 0.68, direction: 'gte', percent: true, notes: 'Corporate minimum gross margin' },
  { metricId: 'net_margin', whole: 8, frac: 0.08, direction: 'gte', percent: true, notes: 'Corporate minimum net margin' },
  { metricId: 'current_ratio', whole: 1.2, frac: 1.2, direction: 'gte', percent: false, notes: 'Liquidity floor' },
  { metricId: 'debt_to_equity', whole: 2.5, frac: 2.5, direction: 'lte', percent: false, notes: 'Leverage ceiling' },
  { metricId: 'food_cost_pct', whole: 30, frac: 0.3, direction: 'lte', percent: true, notes: 'Prime cost component' },
  { metricId: 'labor_cost_pct', whole: 28, frac: 0.28, direction: 'lte', percent: true, notes: 'Prime cost component' },
  { metricId: 'prime_cost', whole: 58, frac: 0.58, direction: 'lte', percent: true, notes: 'Food + labor ceiling' },
];

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function benchmarkCsv(): string {
  const lines = [
    '# Pizza Palace corporate benchmark set — practice upload',
    '# Percent metrics (gross_margin, net_margin, food_cost_pct, labor_cost_pct, prime_cost) are whole percents.',
    'metric_id,target,direction,notes',
  ];
  for (const r of BENCHMARK_ROWS) lines.push([r.metricId, String(r.whole), r.direction, csvEscape(r.notes)].join(','));
  return lines.join('\n') + '\n';
}

function scoaCsv(): string {
  const lines = ['# Pizza Palace corporate standard chart of accounts', 'number,name,statement,type'];
  for (const c of CANONICAL_COA) lines.push([c.number, csvEscape(c.name), c.statementType, c.type].join(','));
  return lines.join('\n') + '\n';
}

function franchiseePnlCsv(def: FranchiseeDef, accounts: Account[], values: AccountValue[]): string {
  return statementCsv(accounts.filter((a) => ['revenue', 'cogs', 'expense'].includes(a.type)), values);
}
function franchiseeBsCsv(def: FranchiseeDef, accounts: Account[], values: AccountValue[]): string {
  return statementCsv(accounts.filter((a) => ['asset', 'liability', 'equity'].includes(a.type)), values);
}
function statementCsv(accounts: Account[], values: AccountValue[]): string {
  const byId = new Map<string, Map<string, number>>();
  for (const v of values) {
    const k = `${v.period.year}-${String(v.period.month).padStart(2, '0')}`;
    if (!byId.has(v.accountId)) byId.set(v.accountId, new Map());
    byId.get(v.accountId)!.set(k, v.amount);
  }
  const cols = PERIODS.map((p) => `${p.year}-${String(p.month).padStart(2, '0')}`);
  const header = ['Account', ...cols].join(',');
  const rows = accounts.map((a) => {
    const m = byId.get(a.id) ?? new Map();
    return [csvEscape(a.name), ...cols.map((c) => String(m.get(c) ?? 0))].join(',');
  });
  return [header, ...rows].join('\n') + '\n';
}

// ── Assemble ─────────────────────────────────────────────────────────────────
const stamp = new Date('2026-07-23T12:00:00Z').toISOString();

const franchisees = FRANCHISEES.map((def) => {
  const accounts = buildAccounts(def);
  const { values, pools } = buildValues(def);
  const workspace: Omit<ClientWorkspace, 'id'> & { id: string } = {
    id: 'PLACEHOLDER',
    name: def.name,
    industryProfileId: 'restaurant',
    accounts,
    values,
    fiscalYearStart: 1,
    scenarios: [],
    operationalData: [],
    operationalInputs: pools,
    customMetrics: [],
    auditLog: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
  return { def, workspace };
});

const franchiseConfig = {
  benchmarkSets: [
    {
      id: 'corp-fy-current',
      label: 'Corporate targets (current)',
      effectiveDate: '2025-01-01',
      uploadedAt: stamp,
      active: true,
      metrics: BENCHMARK_ROWS.map((r) => ({ metricId: r.metricId, target: r.frac, direction: r.direction })),
    },
  ],
  scoa: {
    uploadedAt: stamp,
    accounts: CANONICAL_COA.map((c) => ({ number: c.number, name: c.name, statementType: c.statementType, type: c.type })),
  },
};

const payload = {
  firmName: 'Pizza Palace Franchising (Practice)',
  franchise: { name: 'Pizza Palace Co.', industryProfileId: 'restaurant', config: franchiseConfig },
  franchisees: franchisees.map(({ def, workspace }) => ({ note: def.note, workspace })),
};

// ── Write ────────────────────────────────────────────────────────────────────
const outDir = process.argv[2] ?? join('scripts', 'seed', 'franchise-demo-assets');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'seed.json'), JSON.stringify(payload));
writeFileSync(join(outDir, 'corporate-benchmark.csv'), benchmarkCsv());
writeFileSync(join(outDir, 'corporate-scoa.csv'), scoaCsv());
const sample = franchisees[1]!; // #102, a clean COA
writeFileSync(join(outDir, `sample-pnl-${sample.def.id}.csv`), franchiseePnlCsv(sample.def, sample.workspace.accounts, sample.workspace.values));
writeFileSync(join(outDir, `sample-balancesheet-${sample.def.id}.csv`), franchiseeBsCsv(sample.def, sample.workspace.accounts, sample.workspace.values));

// Summary to stderr so stdout stays parseable if piped.
const summary = franchisees.map(({ def, workspace }) => {
  const rev12 = workspace.values
    .filter((v) => v.accountId.includes('-rev-') && v.period.year === 2025)
    .reduce((s, v) => s + v.amount, 0);
  return `  #${def.id}: ${workspace.accounts.length} accounts, FY2025 revenue ~$${round(rev12).toLocaleString()} — ${def.note}`;
});
process.stderr.write(
  `Franchise practice pack written to ${outDir}\n` +
    `Firm: ${payload.firmName}\nFranchise: ${payload.franchise.name} (restaurant)\n` +
    `Benchmark set: ${BENCHMARK_ROWS.length} metrics · SCOA: ${CANONICAL_COA.length} accounts\nFranchisees:\n` +
    summary.join('\n') +
    `\nFiles: seed.json, corporate-benchmark.csv, corporate-scoa.csv, sample-pnl-${sample.def.id}.csv, sample-balancesheet-${sample.def.id}.csv\n`
);
process.stdout.write(JSON.stringify({ ok: true, outDir }));
