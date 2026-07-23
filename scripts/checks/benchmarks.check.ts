/**
 * Franchise/industry benchmark checks (FRANCHISE_BENCHMARKS_PLAN.md §F2):
 *   npx tsx scripts/checks/benchmarks.check.ts
 *
 * Pins the pure composition + pack-resolution layer:
 *   1. composeEffectiveTargets precedence: per-client > corporate set > pack,
 *      RATIO_DEF_MAP membership routes metrics into .ratios vs .metrics, and
 *      gte/lte map to at_least/at_most.
 *   2. Fast-path identity: compose(base, null, null) is deep-equal to base,
 *      which is the non-franchise byte-identical regression guarantee.
 *   3. resolvePack: size-band boundaries, band+region deltas move margin keys
 *      only, unknown profile falls back to generic-smb, scopeLabel region
 *      rules, and every emitted KpiTarget carries source 'industry'.
 *   4. activeBenchmarkSet selection.
 *   5. targetToBenchmark thresholds (guard against accidental edits).
 */

import type { FranchiseBenchmarkSet, KpiTarget, WorkspaceTargets } from '../../src/types';
import {
  activeBenchmarkSet,
  composeEffectiveTargets,
  RATIO_DEF_MAP,
  targetToBenchmark,
} from '../../src/lib/targets';
import {
  PACK_VERSION,
  REGION_LABELS,
  resolvePack,
  SIZE_BAND_LABELS,
} from '../../src/lib/benchmarks/packs';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}
const approx = (a: number | undefined, b: number): boolean =>
  a !== undefined && Math.abs(a - b) < 1e-9;
const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// Fixtures ────────────────────────────────────────────────────────────────────

// Anchor pack: generic-smb, $1M revenue (500k_2m band, zero delta), national
// (zero delta). Values equal the BASE table exactly.
const anchorPack = resolvePack({
  profileId: 'generic-smb',
  profileLabel: 'Generic SMB',
  trailing12Revenue: 1_000_000,
  region: undefined,
});

// Corporate set: two ratio-registry metrics (one gte, one lte, one with notes,
// one without) plus one operational metric NOT in the ratio registry.
const corporate = {
  setLabel: 'FY26 Corporate Standards',
  metrics: [
    { metricId: 'gross_margin', target: 0.5, direction: 'gte' as const },
    { metricId: 'debt_to_equity', target: 1.2, direction: 'lte' as const, notes: 'Corp leverage cap' },
    { metricId: 'food_cost_pct', target: 0.3, direction: 'lte' as const },
  ],
};

// Per-client targets: one ratio that collides with corporate AND pack, one
// operational metric of its own.
const clientBase: WorkspaceTargets = {
  ratios: {
    gross_margin: { value: 0.55, direction: 'at_least', source: 'custom', note: 'Owner goal' },
  },
  metrics: {
    labor_cost_pct: { value: 0.28, direction: 'at_most', source: 'custom' },
  },
};

// ── 1. composeEffectiveTargets precedence ────────────────────────────────────
{
  // Pack only: everything lands in .ratios with source 'industry'.
  const packOnly = composeEffectiveTargets(undefined, null, anchorPack.ratios);
  check(Object.keys(packOnly.ratios).length === 7, `pack-only: 7 ratio targets, got ${Object.keys(packOnly.ratios).length}`);
  check(Object.keys(packOnly.metrics).length === 0, 'pack-only: no operational targets');
  check(Object.values(packOnly.ratios).every((t) => t.source === 'industry'), 'pack-only: every target has source industry');
  check(approx(packOnly.ratios['gross_margin']?.value, 0.42), `pack-only: anchor gross_margin 0.42, got ${packOnly.ratios['gross_margin']?.value}`);

  // Corporate set overrides the pack per metric; untouched pack metrics survive.
  const corpOverPack = composeEffectiveTargets(undefined, corporate, anchorPack.ratios);
  const gm = corpOverPack.ratios['gross_margin'];
  check(gm?.source === 'corporate' && approx(gm?.value, 0.5), `corporate>pack: gross_margin is the corporate 0.5, got ${gm?.source}/${gm?.value}`);
  check(gm?.direction === 'at_least', `direction map: gte -> at_least, got ${gm?.direction}`);
  check(gm?.note === 'FY26 Corporate Standards', `corporate note falls back to the set label, got "${gm?.note}"`);
  const de = corpOverPack.ratios['debt_to_equity'];
  check(de?.source === 'corporate' && approx(de?.value, 1.2), `corporate>pack: debt_to_equity is the corporate 1.2, got ${de?.source}/${de?.value}`);
  check(de?.direction === 'at_most', `direction map: lte -> at_most, got ${de?.direction}`);
  check(de?.note === 'Corp leverage cap', `explicit notes win over the set label, got "${de?.note}"`);
  const nm = corpOverPack.ratios['net_margin'];
  check(nm?.source === 'industry' && approx(nm?.value, 0.08), `corporate>pack: net_margin not in the set stays industry, got ${nm?.source}/${nm?.value}`);

  // RATIO_DEF_MAP membership routes rows: registry keys -> .ratios, everything
  // else -> .metrics.
  check(Boolean(RATIO_DEF_MAP['gross_margin']) && !RATIO_DEF_MAP['food_cost_pct'], 'membership premise: gross_margin in registry, food_cost_pct not');
  check(corpOverPack.ratios['food_cost_pct'] === undefined, 'routing: food_cost_pct does not land in .ratios');
  const fc = corpOverPack.metrics['food_cost_pct'];
  check(fc?.source === 'corporate' && approx(fc?.value, 0.3) && fc?.direction === 'at_most', `routing: food_cost_pct lands in .metrics as corporate at_most 0.3, got ${JSON.stringify(fc)}`);

  // Per-client target beats corporate AND pack; client metrics merge alongside
  // corporate operational metrics.
  const full = composeEffectiveTargets(clientBase, corporate, anchorPack.ratios);
  const gm2 = full.ratios['gross_margin'];
  check(gm2?.source === 'custom' && approx(gm2?.value, 0.55) && gm2?.note === 'Owner goal', `client>corporate>pack: gross_margin is the client 0.55 custom, got ${JSON.stringify(gm2)}`);
  check(full.ratios['debt_to_equity']?.source === 'corporate', 'client layer leaves non-colliding corporate targets alone');
  check(full.ratios['net_margin']?.source === 'industry', 'client layer leaves non-colliding pack targets alone');
  check(full.metrics['food_cost_pct']?.source === 'corporate' && full.metrics['labor_cost_pct']?.source === 'custom', 'metrics: corporate and client operational targets coexist');
}

// ── 2. Fast-path identity (the non-franchise regression guarantee) ───────────
{
  const composed = composeEffectiveTargets(clientBase, null, null);
  check(deepEqual(composed, clientBase), 'fast path: compose(base, null, null) deep-equals base');
  check(deepEqual(composed.ratios, clientBase.ratios) && deepEqual(composed.metrics, clientBase.metrics), 'fast path: ratios and metrics maps each deep-equal');

  const empty = composeEffectiveTargets(undefined, null, null);
  check(deepEqual(empty, { ratios: {}, metrics: {} }), `fast path: undefined base -> empty maps, got ${JSON.stringify(empty)}`);

  // undefined (not just null) layers behave the same.
  check(deepEqual(composeEffectiveTargets(clientBase, undefined, undefined), clientBase), 'fast path: undefined layers behave like null');
}

// ── 3. resolvePack ────────────────────────────────────────────────────────────
{
  const packFor = (revenue: number | null) =>
    resolvePack({ profileId: 'generic-smb', profileLabel: 'Generic SMB', trailing12Revenue: revenue, region: undefined });

  // Size-band boundaries (inclusive lower edges).
  check(packFor(499_999).sizeBand === 'under_500k', `band: 499,999 -> under_500k, got ${packFor(499_999).sizeBand}`);
  check(packFor(500_000).sizeBand === '500k_2m', `band: 500,000 -> 500k_2m, got ${packFor(500_000).sizeBand}`);
  check(packFor(2_000_000).sizeBand === '2m_10m', `band: 2,000,000 -> 2m_10m, got ${packFor(2_000_000).sizeBand}`);
  check(packFor(10_000_000).sizeBand === 'over_10m', `band: 10,000,000 -> over_10m, got ${packFor(10_000_000).sizeBand}`);
  check(packFor(null).sizeBand === 'under_500k', `band: null revenue -> under_500k, got ${packFor(null).sizeBand}`);

  // Margin keys shift by band delta (2m_10m = -0.01) + region delta
  // (northeast = -0.01); non-margin keys never shift.
  const shifted = resolvePack({ profileId: 'restaurant', profileLabel: 'Restaurant', trailing12Revenue: 2_000_000, region: 'northeast' });
  check(approx(shifted.ratios.gross_margin?.value, 0.63), `deltas: restaurant gross_margin 0.65 - 0.01 - 0.01 = 0.63, got ${shifted.ratios.gross_margin?.value}`);
  check(approx(shifted.ratios.net_margin?.value, 0.03), `deltas: restaurant net_margin 0.05 - 0.01 - 0.01 = 0.03, got ${shifted.ratios.net_margin?.value}`);
  check(approx(shifted.ratios.contribution_margin?.value, 0.28), `deltas: restaurant contribution_margin 0.30 - 0.01 - 0.01 = 0.28, got ${shifted.ratios.contribution_margin?.value}`);
  check(approx(shifted.ratios.current_ratio?.value, 1.0), `deltas: current_ratio never shifts, got ${shifted.ratios.current_ratio?.value}`);
  check(approx(shifted.ratios.debt_to_equity?.value, 2.5), `deltas: debt_to_equity never shifts, got ${shifted.ratios.debt_to_equity?.value}`);
  check(approx(shifted.ratios.roe?.value, 0.12), `deltas: roe never shifts, got ${shifted.ratios.roe?.value}`);
  check(approx(shifted.ratios.altman_z?.value, 2.0), `deltas: altman_z never shifts, got ${shifted.ratios.altman_z?.value}`);

  // Unknown profile falls back to generic-smb values wholesale.
  const unknown = resolvePack({ profileId: 'underwater-basketry', profileLabel: 'Underwater Basketry', trailing12Revenue: 1_000_000, region: undefined });
  check(deepEqual(unknown.ratios, anchorPack.ratios), 'fallback: unknown profileId resolves to generic-smb values');
  check(unknown.profileId === 'underwater-basketry', `fallback: resolution still reports the requested profileId, got ${unknown.profileId}`);

  // scopeLabel: region appears only when region !== national.
  const national = resolvePack({ profileId: 'restaurant', profileLabel: 'Restaurant', trailing12Revenue: 1_000_000, region: 'national' });
  check(national.scopeLabel === `Restaurant · ${SIZE_BAND_LABELS['500k_2m']}`, `scopeLabel national: no region suffix, got "${national.scopeLabel}"`);
  const midwest = resolvePack({ profileId: 'restaurant', profileLabel: 'Restaurant', trailing12Revenue: 1_000_000, region: 'midwest' });
  check(midwest.scopeLabel === `Restaurant · ${SIZE_BAND_LABELS['500k_2m']} · ${REGION_LABELS.midwest}`, `scopeLabel regional: region suffix present, got "${midwest.scopeLabel}"`);

  // Undefined region behaves as national.
  const noRegion = resolvePack({ profileId: 'restaurant', profileLabel: 'Restaurant', trailing12Revenue: 1_000_000, region: undefined });
  check(noRegion.region === 'national' && noRegion.scopeLabel === national.scopeLabel, 'region default: undefined -> national, same label');

  // Every emitted KpiTarget is source 'industry' and stamps the pack version.
  const all = [shifted, unknown, national, midwest].flatMap((p) => Object.values(p.ratios));
  check(all.length > 0 && all.every((t) => t.source === 'industry'), 'every pack target has source industry');
  check(all.every((t) => t.note === `Industry pack ${PACK_VERSION}`), 'every pack target notes the pack version');
  check(shifted.packVersion === PACK_VERSION, `resolution carries PACK_VERSION, got ${shifted.packVersion}`);
}

// ── 4. activeBenchmarkSet ────────────────────────────────────────────────────
{
  const setOf = (id: string, active: boolean): FranchiseBenchmarkSet => ({
    id,
    label: `Set ${id}`,
    uploadedAt: '2026-07-01T00:00:00.000Z',
    active,
    metrics: corporate.metrics,
  });

  check(activeBenchmarkSet(undefined) === null, 'activeSet: undefined config -> null');
  check(activeBenchmarkSet(null) === null, 'activeSet: null config -> null');
  check(activeBenchmarkSet({}) === null, 'activeSet: config without benchmarkSets -> null');
  check(activeBenchmarkSet({ benchmarkSets: [setOf('a', false), setOf('b', false)] }) === null, 'activeSet: none active -> null');

  const b = setOf('b', true);
  const picked = activeBenchmarkSet({ benchmarkSets: [setOf('a', false), b, setOf('c', false)] });
  check(picked === b, `activeSet: the one active set among several is returned by reference, got ${picked?.id}`);
}

// ── 5. targetToBenchmark (guard against accidental edits) ───────────────────
{
  const atLeast = targetToBenchmark({ value: 100, direction: 'at_least', source: 'custom' });
  check(approx(atLeast.good, 100) && approx(atLeast.warn ?? NaN, 90) && approx(atLeast.bad ?? NaN, 75) && atLeast.direction === 'higher', `at_least 100: good 100 / warn 90 / bad 75 / higher, got ${JSON.stringify(atLeast)}`);

  const atMost = targetToBenchmark({ value: 100, direction: 'at_most', source: 'corporate' });
  check(approx(atMost.good, 100) && approx(atMost.warn ?? NaN, 110) && approx(atMost.bad ?? NaN, 125) && atMost.direction === 'lower', `at_most 100: good 100 / warn 110 / bad 125 / lower, got ${JSON.stringify(atMost)}`);

  // Fractional target: warn/bad scale from the value, direction preserved.
  const frac = targetToBenchmark({ value: 0.4, direction: 'at_least', source: 'industry' });
  check(approx(frac.good, 0.4) && approx(frac.warn ?? NaN, 0.36) && approx(frac.bad ?? NaN, 0.3) && frac.direction === 'higher', `at_least 0.4: good 0.4 / warn 0.36 / bad 0.30, got ${JSON.stringify(frac)}`);
}

if (failures > 0) {
  console.error(`\n${failures} benchmark check(s) FAILED`);
  process.exit(1);
}
console.log('All benchmark checks passed.');
