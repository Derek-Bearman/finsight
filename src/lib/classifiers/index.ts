/**
 * Classifiers barrel export.
 * Re-exports all baseline and profile-aware classification functions,
 * plus the `applyClassification` utility for merging results into Account objects.
 */

export * from './baseline';
export * from './profile-classifier';

import type { Account } from '@/types';
import type { ClassificationResult } from './baseline';

/**
 * Merges a `ClassificationResult` into an `Account`, updating:
 *   - `type` (AccountType)
 *   - `costBehavior`
 *   - `classificationConfidence`
 *   - `classificationSource`
 *   - `classificationHintFired`
 *
 * Accounts with `isManuallyClassified === true` are returned unchanged —
 * manual overrides always take precedence over auto-classification.
 *
 * @param account - The Account to update (not mutated; a new object is returned).
 * @param result  - The ClassificationResult produced by a classifier.
 * @returns A new Account object with classification fields updated, or the
 *          original Account if it has been manually classified.
 */
export function applyClassification(
  account: Account,
  result: ClassificationResult,
): Account {
  // Never overwrite a manually classified account
  if (account.isManuallyClassified) {
    return account;
  }

  // result.accountType may be null if classification failed; Account.type is
  // non-nullable, so we keep the existing type in that case.
  const newType = result.accountType ?? account.type;

  return {
    ...account,
    type: newType,
    costBehavior: result.costBehavior ?? account.costBehavior,
    classificationSource: result.source,
    classificationConfidence: result.confidence,
    classificationHintFired: result.hintFired,
  };
}
