/**
 * Driver (cost-behavior-aware) projection checks, runnable headless:
 *   npx tsx scripts/checks/driver-projection.check.ts
 *
 * Covers the new model === 'driver' branch of projectWorkspace:
 *   (i)   variable cost scales with projected revenue (ratio preserved)
 *   (ii)  fixed cost stays flat at the trailing average
 *   (iii) mixed cost = f*avg + (1-f)*ratio*driver, and moving mixedFixedPercent
 *         from 0.6 to 0.2 changes projected net income in the pinned direction
 *   (iv)  linear/seasonal/yoy output is UNCHANGED by this addition (regression
 *         against an oracle that mirrors the untouched per-account path)
 *   (v)   divide-by-zero guard when trailing revenue is 0
 */

import type { Account, AccountValue, Period, ProjectionModel } from '../../src/types';
import { projectWorkspace } from '../../src/lib/projections/workspace-projections';
import { project } from '../../src/lib/projections/models';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

const EPS = 1e-4;
function approx(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

const acc = (id: string, name: string, type: Account['type'], opts: Partial<Account> = {}): Account => ({
  id,
  name,
  type,
  isManuallyClassified: false,
  ...opts,
});

function periodKey(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/**
 * Oracle mirroring projectWorkspace's untouched per-account (non-driver) path
 * for an account with >= 3 historical points: run the requested model, then
 * fall back to linear if the first projected month is >80% below the last-3
 * average. Used only for the regression check (iv).
 */
function oracleProject(
  history: { period: Period; amount: number }[],
  model: ProjectionModel,
  horizonMonths: number,
  growthRateOverride: number | undefined
) {
  let result = project({ history, horizonMonths, model, growthRateOverride });
  if (result.model !== 'linear' && result.projected.length > 0 && history.length >= 3) {
    const lastThree = history.slice(-3);
    const last3Avg = lastThree.reduce((s, h) => s + h.amount, 0) / lastThree.length;
    const firstProjected = result.projected[0]!.value;
    if (last3Avg > 0 && firstProjected < last3Avg * 0.2) {
      result = project({ history, horizonMonths, model: 'linear', growthRateOverride });
    }
  }
  return result;
}

// ─────────────────────────────────────────────
// Fixture A — clean 12-month history, growing revenue.
//   Revenue ramp 1000..2100 (Σ = 18,600).
//   Variable COGS = exactly 20% of revenue (ratio 0.2).
//   Fixed expense = 500 flat (trailing avg 500).
//   Mixed expense = 300 flat, mixedFixedPercent 0.6.
// ─────────────────────────────────────────────

const MONTHS = 12;
const REV = Array.from({ length: MONTHS }, (_, i) => 1000 + 100 * i); // 1000..2100
const VAR = REV.map((r) => 0.2 * r); // exactly 20% of revenue
const FIX = Array.from({ length: MONTHS }, () => 500);
const MIX = Array.from({ length: MONTHS }, () => 300);

const trailingRev = REV.reduce((s, v) => s + v, 0); // 18600
const trailingVar = VAR.reduce((s, v) => s + v, 0); // 3720
const trailingFix = FIX.reduce((s, v) => s + v, 0); // 6000
const trailingMix = MIX.reduce((s, v) => s + v, 0); // 3600
const W = MONTHS; // min(12, 12)

const ratioVar = trailingVar / trailingRev; // 0.2
const ratioMix = trailingMix / trailingRev;
const avgFix = trailingFix / W; // 500
const avgMix = trailingMix / W; // 300

function buildValues(mix: Account): { accounts: Account[]; values: AccountValue[] } {
  const accounts: Account[] = [
    acc('rev', 'Revenue', 'revenue'),
    acc('var', 'Variable COGS', 'cogs', { costBehavior: 'variable' }),
    acc('fix', 'Fixed Expense', 'expense', { costBehavior: 'fixed' }),
    mix,
  ];
  const values: AccountValue[] = [];
  for (let m = 1; m <= MONTHS; m++) {
    const period: Period = { year: 2025, month: m };
    values.push({ accountId: 'rev', period, amount: REV[m - 1]! });
    values.push({ accountId: 'var', period, amount: VAR[m - 1]! });
    values.push({ accountId: 'fix', period, amount: FIX[m - 1]! });
    values.push({ accountId: 'mix', period, amount: MIX[m - 1]! });
  }
  return { accounts, values };
}

const HORIZON = 6;
const GROWTH = 0.2; // 20% annual — makes projected revenue exceed the trailing average

const mix06 = acc('mix', 'Mixed Expense', 'expense', { costBehavior: 'mixed', mixedFixedPercent: 0.6 });
const fixtureA = buildValues(mix06);
const projA = projectWorkspace(fixtureA.accounts, fixtureA.values, {
  model: 'driver',
  horizonMonths: HORIZON,
  growthRateOverride: GROWTH,
});

// Sanity: every account got a driver projection.
for (const id of ['rev', 'var', 'fix', 'mix']) {
  check(
    projA.accountProjections.some((p) => p.accountId === id && p.model === 'driver' && p.points.length === HORIZON),
    `driver: account ${id} should have ${HORIZON} driver-model projected points`
  );
}

// Driver series = projected total revenue per future period (= rolled-up revenue).
const projRowsA = projA.rolledUp.filter((r) => r.isProjected).sort(
  (a, b) => a.period.year * 100 + a.period.month - (b.period.year * 100 + b.period.month)
);
const driverByKey = new Map<string, number>();
for (const row of projRowsA) driverByKey.set(periodKey(row.period), row.revenue);

const pointsFor = (proj: typeof projA, id: string) =>
  proj.accountProjections.find((p) => p.accountId === id)?.points ?? [];

// ── (i) Variable cost scales with projected revenue — ratio preserved ──
{
  check(approx(ratioVar, 0.2), `ratioVar should be 0.2 (got ${ratioVar})`);
  const varPts = pointsFor(projA, 'var');
  let allScaled = true;
  for (const pt of varPts) {
    const driver = driverByKey.get(periodKey(pt.period)) ?? 0;
    if (!approx(pt.value, ratioVar * driver)) allScaled = false;
    // ratio recovered from the projection itself
    if (driver > 0 && !approx(pt.value / driver, ratioVar)) allScaled = false;
  }
  check(allScaled, '(i) variable cost should equal ratio * projected revenue at every period');
  // Revenue must actually grow, otherwise the ratio test is vacuous.
  check(
    projRowsA.length === HORIZON && projRowsA[0]!.revenue > trailingRev / W,
    '(i) projected revenue should exceed the trailing average (growth applied)'
  );
}

// ── (ii) Fixed cost stays flat at the trailing average ──
{
  const fixPts = pointsFor(projA, 'fix');
  let allFlat = true;
  for (const pt of fixPts) {
    if (!approx(pt.value, avgFix)) allFlat = false;
  }
  check(allFlat && fixPts.length === HORIZON, `(ii) fixed cost should be flat at trailing avg ${avgFix}`);
}

// ── (iii) Mixed cost = f*avg + (1-f)*ratio*driver ──
{
  const f = 0.6;
  const mixPts = pointsFor(projA, 'mix');
  let formulaHolds = true;
  for (const pt of mixPts) {
    const driver = driverByKey.get(periodKey(pt.period)) ?? 0;
    const expected = Math.max(0, f * avgMix + (1 - f) * ratioMix * driver);
    if (!approx(pt.value, expected)) formulaHolds = false;
  }
  check(formulaHolds && mixPts.length === HORIZON, '(iii) mixed cost should equal f*avg + (1-f)*ratio*driver');
}

// ── (iii cont.) Changing mixedFixedPercent 0.6 -> 0.2 changes projected net income ──
{
  const mix02 = acc('mix', 'Mixed Expense', 'expense', { costBehavior: 'mixed', mixedFixedPercent: 0.2 });
  const fixtureB = buildValues(mix02);
  const projB = projectWorkspace(fixtureB.accounts, fixtureB.values, {
    model: 'driver',
    horizonMonths: HORIZON,
    growthRateOverride: GROWTH,
  });

  const sumNI = (proj: typeof projA) =>
    proj.rolledUp.filter((r) => r.isProjected).reduce((s, r) => s + r.netIncome, 0);

  const ni06 = sumNI(projA);
  const ni02 = sumNI(projB);

  check(!approx(ni06, ni02), '(iii) the mixed split MUST change projected net income (the whole point)');
  // More variable share (f=0.2) in a growing-revenue future -> higher mixed cost
  // -> LOWER net income than the more-fixed (f=0.6) split.
  check(ni02 < ni06, '(iii) more variable share should lower projected net income when revenue is growing');

  // No confidence band in driver mode: lower80 = upper80 = value on projected rows.
  let noBand = true;
  for (const row of projA.rolledUp.filter((r) => r.isProjected)) {
    if (!row.revenueProjected || !approx(row.revenueProjected.lower80, row.revenueProjected.upper80)) noBand = false;
    if (!row.netIncomeProjected || !approx(row.netIncomeProjected.lower80, row.netIncomeProjected.upper80)) noBand = false;
  }
  check(noBand, '(iii) driver projections should carry no confidence band (lower80 == upper80)');
}

// ─────────────────────────────────────────────
// (iv) Regression — linear/seasonal/yoy UNCHANGED by the driver addition.
//   24 months so the seasonal model actually runs (n >= 24). costBehavior is
//   present on the cost account; non-driver modes must ignore it entirely, so
//   matching the oracle (which never sees costBehavior) proves it's untouched.
// ─────────────────────────────────────────────
{
  const N = 24;
  const rev = Array.from({ length: N }, (_, i) => 1000 + 50 * i);
  const cost = rev.map((r) => 0.3 * r);
  const accountsR: Account[] = [
    acc('rev', 'Revenue', 'revenue'),
    acc('c', 'Cost', 'expense', { costBehavior: 'variable', mixedFixedPercent: 0.5 }),
  ];
  const valuesR: AccountValue[] = [];
  for (let i = 0; i < N; i++) {
    const period: Period = { year: 2024 + Math.floor(i / 12), month: (i % 12) + 1 };
    valuesR.push({ accountId: 'rev', period, amount: rev[i]! });
    valuesR.push({ accountId: 'c', period, amount: cost[i]! });
  }

  const histFor = (id: string) =>
    valuesR
      .filter((v) => v.accountId === id)
      .sort((a, b) => a.period.year * 100 + a.period.month - (b.period.year * 100 + b.period.month))
      .map((v) => ({ period: v.period, amount: v.amount }));

  for (const model of ['linear', 'seasonal', 'yoy'] as ProjectionModel[]) {
    const p = projectWorkspace(accountsR, valuesR, { model, horizonMonths: HORIZON });
    for (const id of ['rev', 'c']) {
      const oracle = oracleProject(histFor(id), model, HORIZON, undefined);
      const ap = p.accountProjections.find((a) => a.accountId === id);
      check(ap !== undefined, `(iv) ${model}: missing projection for ${id}`);
      if (!ap) continue;
      check(ap.model === oracle.model, `(iv) ${model}: ${id} model tag drifted (got ${ap.model}, want ${oracle.model})`);
      check(ap.points.length === oracle.projected.length, `(iv) ${model}: ${id} point count drifted`);
      let identical = ap.points.length === oracle.projected.length;
      for (let k = 0; k < ap.points.length; k++) {
        const a = ap.points[k]!;
        const b = oracle.projected[k]!;
        if (
          a.period.year !== b.period.year ||
          a.period.month !== b.period.month ||
          !approx(a.value, b.value) ||
          !approx(a.lower80, b.lower80) ||
          !approx(a.upper80, b.upper80) ||
          a.isProjected !== b.isProjected
        ) {
          identical = false;
        }
      }
      check(identical, `(iv) ${model}: ${id} projected points differ from the untouched per-account path`);
    }
  }
}

// ─────────────────────────────────────────────
// (v) Divide-by-zero guard — trailing revenue is 0.
//   Revenue all zero; a variable cost with real history must fall back to flat
//   (trailingAvg) instead of ratio/0 = Infinity/NaN.
// ─────────────────────────────────────────────
{
  const N = 12;
  const accountsZ: Account[] = [
    acc('rev', 'Revenue', 'revenue'),
    acc('var', 'Variable COGS', 'cogs', { costBehavior: 'variable' }),
    acc('mix', 'Mixed Expense', 'expense', { costBehavior: 'mixed', mixedFixedPercent: 0.4 }),
  ];
  const valuesZ: AccountValue[] = [];
  for (let m = 1; m <= N; m++) {
    const period: Period = { year: 2025, month: m };
    valuesZ.push({ accountId: 'rev', period, amount: 0 });
    valuesZ.push({ accountId: 'var', period, amount: 100 });
    valuesZ.push({ accountId: 'mix', period, amount: 80 });
  }
  const projZ = projectWorkspace(accountsZ, valuesZ, { model: 'driver', horizonMonths: HORIZON });

  const varPtsZ = pointsFor(projZ, 'var');
  const mixPtsZ = pointsFor(projZ, 'mix');
  let guarded = varPtsZ.length === HORIZON && mixPtsZ.length === HORIZON;
  for (const pt of varPtsZ) {
    if (!Number.isFinite(pt.value) || !approx(pt.value, 100)) guarded = false; // trailingAvg = 1200/12
  }
  for (const pt of mixPtsZ) {
    if (!Number.isFinite(pt.value) || !approx(pt.value, 80)) guarded = false; // flat trailingAvg = 960/12
  }
  check(guarded, '(v) with trailing revenue 0, every cost should be finite and flat at its trailing average');

  // No NaN/Infinity anywhere in the rolled-up series.
  let allFinite = true;
  for (const row of projZ.rolledUp) {
    if (!Number.isFinite(row.revenue) || !Number.isFinite(row.netIncome) || !Number.isFinite(row.cogs)) {
      allFinite = false;
    }
  }
  check(allFinite, '(v) rolled-up series must stay finite when trailing revenue is 0');
}

if (failures > 0) {
  console.error(`\n${failures} driver-projection check(s) FAILED`);
  process.exit(1);
}
console.log('All driver-projection checks passed.');
