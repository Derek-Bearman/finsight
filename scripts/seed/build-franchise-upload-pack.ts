/**
 * Franchise UPLOAD-PRACTICE pack (files only, nothing seeded).
 *
 * A SECOND, distinct franchise so Derek can walk the whole setup by hand:
 * create the franchise, upload the corporate SCOA, upload the benchmark set,
 * create 5 franchisee workspaces, import each one's P&L + Balance Sheet, link
 * them, then read the comparison + SCOA audit. Different industry from the
 * seeded Pizza Palace pack (home services / trades-contractor profile) so the
 * SCOA mapping is a fresh exercise.
 *
 *   npx tsx scripts/seed/build-franchise-upload-pack.ts <outDir>
 *
 * Writes to <outDir> (default scripts/seed/franchise-upload-pack/):
 *   README.txt                       — the exact upload order
 *   corporate-scoa.csv               — HandyPro standard chart of accounts
 *   corporate-benchmark.csv          — corporate targets (universal ratios)
 *   franchisee-<id>-pnl.csv          — one P&L per franchisee (QBO section shape)
 *   franchisee-<id>-balancesheet.csv — one Balance Sheet per franchisee
 *
 * The statement CSVs carry QBO-style section header rows (Income / Cost of
 * Goods Sold / Expenses / Assets / Liabilities / Equity) so FinSight's parser
 * classifies every account on import with no manual mapping. Benchmarks use
 * only registry ratios (gross_margin/net_margin/current_ratio/debt_to_equity/
 * roe) so the comparison + pass/fail works the moment the statements import,
 * with no operational-tab data entry required.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type Section = 'revenue' | 'cogs' | 'expense' | 'asset' | 'liability' | 'equity';

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (n: number) => Math.round(n);

// 60 months: Jan 2021 – Dec 2025.
interface P { year: number; month: number }
const PERIODS: P[] = [];
for (let y = 2021; y <= 2025; y++) for (let m = 1; m <= 12; m++) PERIODS.push({ year: y, month: m });

// Home-services seasonality (summer peak, winter trough).
const SEASON: Record<number, number> = {
  1: 0.82, 2: 0.84, 3: 0.95, 4: 1.05, 5: 1.12, 6: 1.2,
  7: 1.22, 8: 1.18, 9: 1.08, 10: 1.0, 11: 0.88, 12: 0.86,
};

interface CoaDef { key: string; number: string; name: string; section: Section }

// HandyPro Home Services standard chart of accounts.
const CANONICAL_COA: CoaDef[] = [
  { key: 'rev-service', number: '4000', name: 'Service Call Revenue', section: 'revenue' },
  { key: 'rev-project', number: '4100', name: 'Project Revenue', section: 'revenue' },
  { key: 'rev-maintenance', number: '4200', name: 'Maintenance Plan Revenue', section: 'revenue' },
  { key: 'rev-materials', number: '4300', name: 'Materials Markup', section: 'revenue' },
  { key: 'cogs-sub', number: '5000', name: 'Subcontractor Labor', section: 'cogs' },
  { key: 'cogs-materials', number: '5100', name: 'Materials & Parts', section: 'cogs' },
  { key: 'cogs-equip', number: '5200', name: 'Equipment Rental', section: 'cogs' },
  { key: 'cogs-fees', number: '5300', name: 'Disposal & Permit Fees', section: 'cogs' },
  { key: 'exp-tech', number: '6000', name: 'Field Technician Wages', section: 'expense' },
  { key: 'exp-payroll', number: '6100', name: 'Payroll Taxes & Benefits', section: 'expense' },
  { key: 'exp-vehicle', number: '6200', name: 'Vehicle & Fuel', section: 'expense' },
  { key: 'exp-rent', number: '6300', name: 'Shop Rent', section: 'expense' },
  { key: 'exp-utilities', number: '6400', name: 'Utilities', section: 'expense' },
  { key: 'exp-marketing', number: '6500', name: 'Marketing & Advertising', section: 'expense' },
  { key: 'exp-royalty', number: '6600', name: 'Franchise Royalty Fees', section: 'expense' },
  { key: 'exp-adfund', number: '6650', name: 'Corporate Ad Fund Contribution', section: 'expense' },
  { key: 'exp-insurance', number: '6700', name: 'Insurance', section: 'expense' },
  { key: 'exp-tools', number: '6800', name: 'Tools & Small Equipment', section: 'expense' },
  { key: 'exp-software', number: '6900', name: 'Software & Dispatch', section: 'expense' },
  { key: 'exp-interest', number: '7000', name: 'Interest Expense', section: 'expense' },
  { key: 'bs-cash', number: '1010', name: 'Operating Checking', section: 'asset' },
  { key: 'bs-ar', number: '1100', name: 'Accounts Receivable', section: 'asset' },
  { key: 'bs-inventory', number: '1300', name: 'Materials Inventory', section: 'asset' },
  { key: 'bs-vehicles', number: '1500', name: 'Vehicles (Net)', section: 'asset' },
  { key: 'bs-tools', number: '1600', name: 'Tools & Equipment (Net)', section: 'asset' },
  { key: 'bs-ap', number: '2010', name: 'Accounts Payable', section: 'liability' },
  { key: 'bs-cc', number: '2100', name: 'Credit Card Payable', section: 'liability' },
  { key: 'bs-accrued', number: '2200', name: 'Accrued Payroll', section: 'liability' },
  { key: 'bs-deposits', number: '2400', name: 'Customer Deposits', section: 'liability' },
  { key: 'bs-loan', number: '2600', name: 'Vehicle Loans (Long Term)', section: 'liability' },
  { key: 'bs-equity', number: '3000', name: 'Owner Capital', section: 'equity' },
  { key: 'bs-retained', number: '3900', name: 'Retained Earnings', section: 'equity' },
];

type Drift = 'none' | 'missing-maintenance' | 'rename-and-extra';
interface FranchiseeDef {
  id: number; name: string; seed: number; revBase: number; monthlyGrowth: number;
  cogsPct: number; techPct: number; marketingBase: number; drift: Drift; note: string;
}
const FRANCHISEES: FranchiseeDef[] = [
  { id: 201, name: 'HandyPro #201 (Metro)', seed: 201, revBase: 88000, monthlyGrowth: 0.008, cogsPct: 0.46, techPct: 0.16, marketingBase: 4200, drift: 'none', note: 'Star: high margins, strong growth.' },
  { id: 202, name: 'HandyPro #202 (Lakeside)', seed: 202, revBase: 64000, monthlyGrowth: 0.005, cogsPct: 0.5, techPct: 0.18, marketingBase: 3200, drift: 'none', note: 'Solid: meets most corporate targets.' },
  { id: 203, name: 'HandyPro #203 (Riverside)', seed: 203, revBase: 52000, monthlyGrowth: 0.003, cogsPct: 0.52, techPct: 0.19, marketingBase: 2600, drift: 'missing-maintenance', note: 'Average; no maintenance-plan line (SCOA shows a missing account).' },
  { id: 204, name: 'HandyPro #204 (Hilltop)', seed: 204, revBase: 46000, monthlyGrowth: 0.001, cogsPct: 0.56, techPct: 0.21, marketingBase: 2100, drift: 'rename-and-extra', note: 'Struggling + COA drift (renamed materials account, extra warranty-reserve liability).' },
  { id: 205, name: 'HandyPro #205 (Grove)', seed: 205, revBase: 41000, monthlyGrowth: 0.013, cogsPct: 0.53, techPct: 0.185, marketingBase: 2400, drift: 'none', note: 'Turnaround: low base, strongest growth.' },
];

// ── Benchmark set (registry ratios only, so they compute from P&L + BS) ──────
const BENCHMARK_ROWS = [
  { metricId: 'gross_margin', whole: 48, direction: 'gte', notes: 'Corporate minimum gross margin' },
  { metricId: 'net_margin', whole: 10, direction: 'gte', notes: 'Corporate minimum net margin' },
  { metricId: 'current_ratio', whole: 1.5, direction: 'gte', notes: 'Liquidity floor' },
  { metricId: 'debt_to_equity', whole: 1.8, direction: 'lte', notes: 'Leverage ceiling' },
  { metricId: 'roe', whole: 18, direction: 'gte', notes: 'Owner return target' },
];

function csvEscape(v: string): string { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
const monthKey = (p: P) => `${p.year}-${String(p.month).padStart(2, '0')}`;

interface Row { key: string; number: string; name: string; section: Section }
function franchiseeAccounts(def: FranchiseeDef): Row[] {
  const out: Row[] = [];
  for (const c of CANONICAL_COA) {
    if (def.drift === 'missing-maintenance' && c.key === 'rev-maintenance') continue;
    let name = c.name;
    if (def.drift === 'rename-and-extra' && c.key === 'cogs-materials') name = 'Parts & Supplies';
    out.push({ key: c.key, number: c.number, name, section: c.section });
  }
  if (def.drift === 'rename-and-extra') out.push({ key: 'bs-warranty', number: '2500', name: 'Warranty Reserve', section: 'liability' });
  return out;
}

function franchiseeValues(def: FranchiseeDef): Map<string, Map<string, number>> {
  const rand = mulberry32(def.seed);
  const jitter = (base: number, pct: number) => base * (1 + (rand() * 2 - 1) * pct);
  const has = (k: string) => !(def.drift === 'missing-maintenance' && k === 'rev-maintenance');
  const byKey = new Map<string, Map<string, number>>();
  const put = (key: string, p: P, amt: number) => {
    if (!byKey.has(key)) byKey.set(key, new Map());
    byKey.get(key)!.set(monthKey(p), round(amt));
  };
  let cash = def.revBase * 0.6;
  const ownerCapital = round(def.revBase * 1.5);

  PERIODS.forEach((p, i) => {
    const scale = Math.pow(1 + def.monthlyGrowth, i) * SEASON[p.month]!;
    const service = jitter(def.revBase * scale, 0.03);
    const project = jitter(def.revBase * 0.55 * scale, 0.1);
    const maintenance = has('rev-maintenance') ? jitter(def.revBase * 0.22 * scale, 0.05) : 0;
    const materials = jitter(def.revBase * 0.3 * scale, 0.06);
    const revenue = service + project + maintenance + materials;

    const sub = revenue * jitter(def.cogsPct * 0.5, 0.04);
    const mat = revenue * jitter(def.cogsPct * 0.38, 0.04);
    const equip = revenue * jitter(def.cogsPct * 0.07, 0.05);
    const fees = revenue * jitter(def.cogsPct * 0.05, 0.05);

    const tech = revenue * jitter(def.techPct, 0.03);
    const payroll = (tech) * 0.14;
    const vehicle = jitter(def.revBase * 0.05 * scale, 0.06);
    const rent = def.revBase * 0.06;
    const utilities = jitter(def.revBase * 0.018 * SEASON[p.month]!, 0.05);
    const marketing = jitter(def.marketingBase * (1 + 0.009 * i), 0.05);
    const royalty = revenue * 0.06;
    const adFund = revenue * 0.02;
    const insurance = def.revBase * 0.025;
    const tools = jitter(def.revBase * 0.012, 0.3);
    const software = def.revBase * 0.008;
    const interest = def.revBase * 0.006;

    put('rev-service', p, service); put('rev-project', p, project);
    if (has('rev-maintenance')) put('rev-maintenance', p, maintenance);
    put('rev-materials', p, materials);
    put('cogs-sub', p, sub); put('cogs-materials', p, mat); put('cogs-equip', p, equip); put('cogs-fees', p, fees);
    put('exp-tech', p, tech); put('exp-payroll', p, payroll); put('exp-vehicle', p, vehicle);
    put('exp-rent', p, rent); put('exp-utilities', p, utilities); put('exp-marketing', p, marketing);
    put('exp-royalty', p, royalty); put('exp-adfund', p, adFund); put('exp-insurance', p, insurance);
    put('exp-tools', p, tools); put('exp-software', p, software); put('exp-interest', p, interest);

    const totalCogs = sub + mat + equip + fees;
    const totalExp = tech + payroll + vehicle + rent + utilities + marketing + royalty + adFund + insurance + tools + software + interest;
    const netIncome = revenue - totalCogs - totalExp;

    cash = cash + netIncome * 0.7;
    const ar = jitter(def.revBase * 0.14 * scale, 0.15);
    const inventory = jitter(def.revBase * 0.09 * scale, 0.1);
    const vehicles = def.revBase * 1.1 - i * (def.revBase * 0.009);
    const toolsNet = def.revBase * 0.45 - i * (def.revBase * 0.004);
    const ap = jitter(def.revBase * 0.16 * scale, 0.1);
    const cc = jitter(def.revBase * 0.05, 0.25);
    const accrued = jitter(def.revBase * 0.07 * scale, 0.08);
    const deposits = jitter(def.revBase * 0.08 * scale, 0.12);
    const warranty = def.drift === 'rename-and-extra' ? jitter(def.revBase * 0.03, 0.2) : 0;
    const loan = Math.max(0, def.revBase * 0.9 - i * (def.revBase * 0.013));
    const liabilities = ap + cc + accrued + deposits + warranty + loan;
    const retained = cash + ar + inventory + vehicles + toolsNet - liabilities - ownerCapital;

    put('bs-cash', p, cash); put('bs-ar', p, ar); put('bs-inventory', p, inventory);
    put('bs-vehicles', p, vehicles); put('bs-tools', p, toolsNet);
    put('bs-ap', p, ap); put('bs-cc', p, cc); put('bs-accrued', p, accrued); put('bs-deposits', p, deposits);
    if (def.drift === 'rename-and-extra') put('bs-warranty', p, warranty);
    put('bs-loan', p, loan); put('bs-equity', p, ownerCapital); put('bs-retained', p, retained);
  });
  return byKey;
}

const SECTION_HEADER: Record<Section, string> = {
  revenue: 'Income', cogs: 'Cost of Goods Sold', expense: 'Expenses',
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity',
};

/** QBO-style statement CSV: an Account column + a dedicated Number column (so
 *  FinSight populates Account.number and the SCOA audit can match by number),
 *  section header rows (blank number + blank periods), then the accounts. */
function statementCsv(rows: Row[], vals: Map<string, Map<string, number>>, sections: Section[]): string {
  const cols = PERIODS.map(monthKey);
  const out: string[] = [['Account', 'Number', ...cols].join(',')];
  for (const section of sections) {
    out.push([csvEscape(SECTION_HEADER[section]), '', ...cols.map(() => '')].join(',')); // section header row
    for (const r of rows.filter((x) => x.section === section)) {
      const m = vals.get(r.key) ?? new Map();
      out.push([csvEscape(r.name), r.number, ...cols.map((c) => String(m.get(c) ?? 0))].join(','));
    }
  }
  return out.join('\n') + '\n';
}

// ── Write ────────────────────────────────────────────────────────────────────
const outDir = process.argv[2] ?? join('scripts', 'seed', 'franchise-upload-pack');
mkdirSync(outDir, { recursive: true });

// SCOA
const scoaLines = ['# HandyPro Home Services corporate standard chart of accounts', 'number,name,statement,type'];
for (const c of CANONICAL_COA) {
  const stmt = ['asset', 'liability', 'equity'].includes(c.section) ? 'balance' : 'pnl';
  scoaLines.push([c.number, csvEscape(c.name), stmt, c.section].join(','));
}
writeFileSync(join(outDir, 'corporate-scoa.csv'), scoaLines.join('\n') + '\n');

// Benchmarks (whole percents for percent metrics; ratios as-is)
const benchLines = [
  '# HandyPro Home Services corporate benchmark set',
  '# Percent metrics (gross_margin, net_margin, roe) are whole percents; ratios use their native unit.',
  'metric_id,target,direction,notes',
];
for (const r of BENCHMARK_ROWS) benchLines.push([r.metricId, String(r.whole), r.direction, csvEscape(r.notes)].join(','));
writeFileSync(join(outDir, 'corporate-benchmark.csv'), benchLines.join('\n') + '\n');

// Per-franchisee P&L + BS
const summary: string[] = [];
for (const def of FRANCHISEES) {
  const rows = franchiseeAccounts(def);
  const vals = franchiseeValues(def);
  writeFileSync(join(outDir, `franchisee-${def.id}-pnl.csv`), statementCsv(rows, vals, ['revenue', 'cogs', 'expense']));
  writeFileSync(join(outDir, `franchisee-${def.id}-balancesheet.csv`), statementCsv(rows, vals, ['asset', 'liability', 'equity']));
  const rev25 = PERIODS.filter((p) => p.year === 2025).reduce((s, p) => {
    return s + ['rev-service', 'rev-project', 'rev-maintenance', 'rev-materials'].reduce((a, k) => a + (vals.get(k)?.get(monthKey(p)) ?? 0), 0);
  }, 0);
  summary.push(`  ${def.name}: ${rows.length} accounts, FY2025 revenue ~$${round(rev25).toLocaleString()} — ${def.note}`);
}

const readme = `HANDYPRO HOME SERVICES — franchise upload-practice pack
=======================================================
These are STANDALONE files. Nothing is seeded into FinSight. Upload them
yourself to practice the full setup, in this order:

1. Franchises page (top nav) -> create a franchise, e.g. "HandyPro Home Services".
   Set its industry profile to "Trades Contractor".
2. On that franchise: Benchmarks -> Add benchmark set -> Upload CSV ->
   corporate-benchmark.csv  (gross margin, net margin, current ratio,
   debt/equity, ROE). Make it active.
3. On that franchise: SCOA -> upload corporate-scoa.csv (31 accounts).
4. For each of the 5 franchisees, create a client workspace (New Workspace),
   profile "Trades Contractor", and designate it a franchisee of "HandyPro
   Home Services":
     - On the P&L Upload step, import franchisee-<id>-pnl.csv
     - On the Balance Sheet step, import franchisee-<id>-balancesheet.csv
   (Or create the workspace empty and use "Import data" on the Statements tab.)
5. Open any franchisee -> Reports tab -> Franchise comparison ranks all five
   against each other and the corporate benchmarks (green = meets target).
6. Open #203 or #204 -> Mapping tab -> Corporate SCOA mapping: #203 is missing
   the Maintenance Plan Revenue account, #204 renamed "Materials & Parts" to
   "Parts & Supplies" (number 5100 matches, name drifts) and has an extra
   "Warranty Reserve" account not in the SCOA. Use "Apply suggested mappings"
   then map the rest.

The statement CSVs carry QBO-style section headers (Income / Cost of Goods
Sold / Expenses / Assets / Liabilities / Equity) so FinSight classifies every
account automatically on import.

Franchisees (varied on purpose):
${summary.join('\n')}
`;
writeFileSync(join(outDir, 'README.txt'), readme);

process.stderr.write(`Upload-practice pack written to ${outDir}\n${readme}`);
process.stdout.write(JSON.stringify({ ok: true, outDir, files: 2 + FRANCHISEES.length * 2 + 1 }));
