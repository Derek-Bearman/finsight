/**
 * Industry benchmark packs (FRANCHISE_BENCHMARKS_PLAN.md §F2).
 *
 * Curated, VERSIONED, ILLUSTRATIVE benchmark data shipped inside the app —
 * there is no external data feed. Values are general aggregates assembled
 * from public sources for each industry profile, adjusted by revenue size
 * band and (where defensible) US census region. They are deliberately
 * presented with an asterisk + disclaimer everywhere they render:
 * general data scoped to the client's industry, NOT what any particular
 * client's goals ought to be. An uploaded corporate benchmark always
 * supersedes these, and a per-client custom target supersedes both.
 *
 * "Update with a button click": the Refresh Benchmarks button re-resolves the
 * workspace against the CURRENT pack below and stamps
 * workspace.benchmarkPackVersion. Newer numbers ship as new PACK_VERSIONs
 * with app deploys, so refresh is instant and offline-safe.
 *
 * Pure data + pure functions. No I/O, no React.
 */

import type { KpiTarget } from '@/types';
import type { RatioKey } from '@/lib/targets';

export const PACK_VERSION = '2026.07';
export const PACK_UPDATED = 'July 2026';

// ─────────────────────────────────────────────
// Scoping dimensions
// ─────────────────────────────────────────────

export type SizeBand = 'under_500k' | '500k_2m' | '2m_10m' | 'over_10m';

export const SIZE_BAND_LABELS: Record<SizeBand, string> = {
  under_500k: 'Under $500K revenue',
  '500k_2m': '$500K–$2M revenue',
  '2m_10m': '$2M–$10M revenue',
  over_10m: 'Over $10M revenue',
};

export function sizeBandForRevenue(trailing12Revenue: number | null | undefined): SizeBand {
  const r = trailing12Revenue ?? 0;
  if (r >= 10_000_000) return 'over_10m';
  if (r >= 2_000_000) return '2m_10m';
  if (r >= 500_000) return '500k_2m';
  return 'under_500k';
}

/** US census regions. 'national' = no regional adjustment. */
export type BenchmarkRegion = 'national' | 'northeast' | 'midwest' | 'south' | 'west';

export const REGION_LABELS: Record<BenchmarkRegion, string> = {
  national: 'National',
  northeast: 'Northeast',
  midwest: 'Midwest',
  south: 'South',
  west: 'West',
};

// ─────────────────────────────────────────────
// Pack data
// ─────────────────────────────────────────────

/** Per-ratio pack entry: the headline threshold + pass direction, in the
 *  ratio's native unit (percents as 0–1 fractions). */
interface PackEntry {
  value: number;
  direction: KpiTarget['direction'];
}

type RatioPack = Partial<Record<RatioKey, PackEntry>>;

/**
 * Base values per profile (the '500k_2m' band is the anchor; other bands
 * apply the band deltas below). Margin profiles differ by industry; balance
 * sheet discipline thresholds are steadier across industries.
 */
const BASE: Record<string, RatioPack> = {
  'generic-smb': {
    gross_margin: { value: 0.42, direction: 'at_least' },
    net_margin: { value: 0.08, direction: 'at_least' },
    contribution_margin: { value: 0.38, direction: 'at_least' },
    current_ratio: { value: 1.5, direction: 'at_least' },
    debt_to_equity: { value: 2.0, direction: 'at_most' },
    roe: { value: 0.14, direction: 'at_least' },
    altman_z: { value: 2.6, direction: 'at_least' },
  },
  restaurant: {
    gross_margin: { value: 0.65, direction: 'at_least' }, // post-COGS (food+bev) margin
    net_margin: { value: 0.05, direction: 'at_least' },
    contribution_margin: { value: 0.3, direction: 'at_least' },
    current_ratio: { value: 1.0, direction: 'at_least' }, // restaurants run lean current ratios
    debt_to_equity: { value: 2.5, direction: 'at_most' },
    roe: { value: 0.12, direction: 'at_least' },
    altman_z: { value: 2.0, direction: 'at_least' },
  },
  'trades-contractor': {
    gross_margin: { value: 0.45, direction: 'at_least' },
    net_margin: { value: 0.08, direction: 'at_least' },
    contribution_margin: { value: 0.35, direction: 'at_least' },
    current_ratio: { value: 1.6, direction: 'at_least' },
    debt_to_equity: { value: 1.8, direction: 'at_most' },
    roe: { value: 0.18, direction: 'at_least' },
    altman_z: { value: 2.6, direction: 'at_least' },
  },
  'professional-services': {
    gross_margin: { value: 0.6, direction: 'at_least' },
    net_margin: { value: 0.15, direction: 'at_least' },
    contribution_margin: { value: 0.5, direction: 'at_least' },
    current_ratio: { value: 1.8, direction: 'at_least' },
    debt_to_equity: { value: 1.0, direction: 'at_most' },
    roe: { value: 0.2, direction: 'at_least' },
    altman_z: { value: 3.0, direction: 'at_least' },
  },
  retail: {
    gross_margin: { value: 0.45, direction: 'at_least' },
    net_margin: { value: 0.04, direction: 'at_least' },
    contribution_margin: { value: 0.35, direction: 'at_least' },
    current_ratio: { value: 1.8, direction: 'at_least' }, // inventory-heavy
    debt_to_equity: { value: 2.2, direction: 'at_most' },
    roe: { value: 0.13, direction: 'at_least' },
    altman_z: { value: 2.4, direction: 'at_least' },
  },
  saas: {
    gross_margin: { value: 0.75, direction: 'at_least' },
    net_margin: { value: 0.1, direction: 'at_least' },
    contribution_margin: { value: 0.65, direction: 'at_least' },
    current_ratio: { value: 1.5, direction: 'at_least' },
    debt_to_equity: { value: 1.0, direction: 'at_most' },
    roe: { value: 0.15, direction: 'at_least' },
    altman_z: { value: 2.8, direction: 'at_least' },
  },
};

/**
 * Size-band deltas, applied to margin-family ratios only (scale economics:
 * bigger operations trade margin points for volume; tiny operations need
 * thicker margins to survive). Additive in native units.
 */
const BAND_MARGIN_DELTA: Record<SizeBand, number> = {
  under_500k: +0.02,
  '500k_2m': 0,
  '2m_10m': -0.01,
  over_10m: -0.02,
};

const MARGIN_KEYS: RatioKey[] = ['gross_margin', 'net_margin', 'contribution_margin'];

/**
 * Regional adjustment, margin-family only — a rough cost-of-doing-business
 * signal (labor + occupancy). Kept deliberately small; regions differ far
 * more WITHIN themselves than between each other, which is exactly why the
 * disclaimer exists. Additive in native units.
 */
const REGION_MARGIN_DELTA: Record<BenchmarkRegion, number> = {
  national: 0,
  northeast: -0.01,
  west: -0.01,
  midwest: +0.01,
  south: +0.005,
};

// ─────────────────────────────────────────────
// Resolution
// ─────────────────────────────────────────────

export interface PackResolution {
  packVersion: string;
  packUpdated: string;
  /** e.g. "Restaurant · $500K–$2M revenue · Midwest" — used in captions. */
  scopeLabel: string;
  profileId: string;
  sizeBand: SizeBand;
  region: BenchmarkRegion;
  /** Ratio targets in KpiTarget shape with source 'industry'. */
  ratios: Partial<Record<RatioKey, KpiTarget>>;
}

/** Disclaimer copy — single source of truth for the asterisk tooltip. */
export const INDUSTRY_BENCHMARK_DISCLAIMER =
  'General industry data scoped to this client’s industry, size, and region. ' +
  'It is not specific to this business and is not necessarily what this ' +
  'client’s goals ought to be. Corporate benchmarks and custom targets ' +
  'always take precedence.';

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Resolve the pack overlay for a workspace. Nearest-scope logic: unknown
 * profiles fall back to generic-smb (profile tier), band/region apply as
 * adjustments rather than separate tables, so every combination resolves.
 */
export function resolvePack(params: {
  profileId: string;
  profileLabel: string;
  trailing12Revenue: number | null | undefined;
  region: BenchmarkRegion | undefined;
}): PackResolution {
  const base = BASE[params.profileId] ?? BASE['generic-smb'];
  const sizeBand = sizeBandForRevenue(params.trailing12Revenue);
  const region: BenchmarkRegion = params.region ?? 'national';

  const ratios: Partial<Record<RatioKey, KpiTarget>> = {};
  for (const [key, entry] of Object.entries(base) as [RatioKey, PackEntry][]) {
    let value = entry.value;
    if (MARGIN_KEYS.includes(key)) {
      value = value + BAND_MARGIN_DELTA[sizeBand] + REGION_MARGIN_DELTA[region];
    }
    ratios[key] = {
      value: round4(value),
      direction: entry.direction,
      source: 'industry',
      note: `Industry pack ${PACK_VERSION}`,
    };
  }

  const scopeParts = [params.profileLabel, SIZE_BAND_LABELS[sizeBand]];
  if (region !== 'national') scopeParts.push(REGION_LABELS[region]);

  return {
    packVersion: PACK_VERSION,
    packUpdated: PACK_UPDATED,
    scopeLabel: scopeParts.join(' · '),
    profileId: params.profileId,
    sizeBand,
    region,
    ratios,
  };
}
