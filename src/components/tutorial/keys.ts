// ── Tutorial localStorage keys ─────────────────────────────────────────────
//
// Every tour has its OWN storage key so completing one never suppresses another
// (the pre-split bug: the workspace tour wrote the shared legacy key, which the
// home tour read as "already seen"). The legacy key is still honored as "the
// main tours were seen" so existing users aren't re-onboarded after the split.

/** Main getting-started tour on the home / new-client wizard page. */
export const HOME_TOUR_KEY = 'finsight-tour-home-seen';

/** Main orientation tour on the workspace page (was the legacy shared key). */
export const WORKSPACE_TOUR_KEY = 'finsight-tour-workspace-seen';

/** Pre-split shared key. Read-only now: treated as "both main tours seen". */
export const LEGACY_TOUR_KEY = 'finsight-tutorial-seen';

/** Per-page tour keys, e.g. finsight-pagetour-overview-seen. */
export const pageTourKey = (pageId: string) => `finsight-pagetour-${pageId}-seen`;

/** Page ids that have their own page-specific tour (the 7 workspace tabs + the
 *  franchises manager). Home is intentionally excluded — its page tour IS the
 *  main home tour. */
export const PAGE_TOUR_IDS = [
  'overview',
  'statements',
  'mapping',
  'reports',
  'projections',
  'whatif',
  'operational',
  'franchises',
] as const;

export type PageTourId = (typeof PAGE_TOUR_IDS)[number];
