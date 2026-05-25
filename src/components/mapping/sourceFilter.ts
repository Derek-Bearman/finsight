/**
 * Pure predicate helpers for the mapping-page Source filter chips.
 * Kept out of the view components so they can be unit-tested and reused
 * across MappingViewA and MappingViewB.
 */

import type { Account } from '@/types';
import type { SourceFilter } from './MappingToolbar';
import { accountNeedsReview } from './AccountCard';

/**
 * Returns true if `account` should be visible under the given source filter.
 * 'all' matches everything; the other values narrow to accounts whose
 * classification provenance matches.
 */
export function matchesSourceFilter(account: Account, filter: SourceFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'manual':
      return account.isManuallyClassified === true;
    case 'profile':
      return (
        !account.isManuallyClassified &&
        account.classificationSource === 'profile_keyword'
      );
    case 'account_number':
      return (
        !account.isManuallyClassified &&
        account.classificationSource === 'account_number'
      );
    case 'auto':
      // Any auto-classification (baseline, profile, or account#) that wasn't manually overridden
      return (
        !account.isManuallyClassified &&
        (account.classificationSource === 'baseline_keyword' ||
          account.classificationSource === 'profile_keyword' ||
          account.classificationSource === 'account_number')
      );
    case 'needs_review':
      return accountNeedsReview(account);
  }
}

/**
 * Counts accounts in each non-'all' source bucket. Used to render the
 * "(N)" count next to each filter chip.
 */
export function computeSourceCounts(accounts: Account[]): {
  manual: number;
  profile: number;
  account_number: number;
  auto: number;
  needs_review: number;
} {
  let manual = 0;
  let profile = 0;
  let account_number = 0;
  let auto = 0;
  let needs_review = 0;
  for (const a of accounts) {
    if (a.isManuallyClassified) manual++;
    if (matchesSourceFilter(a, 'profile')) profile++;
    if (matchesSourceFilter(a, 'account_number')) account_number++;
    if (matchesSourceFilter(a, 'auto')) auto++;
    if (matchesSourceFilter(a, 'needs_review')) needs_review++;
  }
  return { manual, profile, account_number, auto, needs_review };
}
