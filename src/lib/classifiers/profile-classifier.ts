/**
 * Profile-aware classifier — layers IndustryProfile hints on top of the baseline result.
 */

import type { IndustryProfile, ClassificationHint } from '@/types';
import { classifyBaseline, type ClassificationResult } from './baseline';

// ─────────────────────────────────────────────
// Confidence ordering helper
// ─────────────────────────────────────────────

const CONFIDENCE_RANK: Record<string, number> = { high: 2, medium: 1, low: 0 };

/** Returns true if `a` is strictly better than `b`. */
function higherConfidence(a: string, b: string): boolean {
  return (CONFIDENCE_RANK[a] ?? -1) > (CONFIDENCE_RANK[b] ?? -1);
}

/** Returns true if `a` is at least as good as `b`. */
function atLeastAsGood(a: string, b: string): boolean {
  return (CONFIDENCE_RANK[a] ?? -1) >= (CONFIDENCE_RANK[b] ?? -1);
}

// ─────────────────────────────────────────────
// Best profile-hint selection
// ─────────────────────────────────────────────

interface FiredHint {
  hint: ClassificationHint;
  matchedKeyword: string;
}

/**
 * Finds all profile hints whose keywords appear (case-insensitive substring)
 * in `accountName`, then returns the single "best" one:
 *   - highest confidence wins
 *   - tie-break: longest matched keyword
 */
function selectBestHint(
  accountName: string,
  hints: ClassificationHint[],
): FiredHint | null {
  const lower = accountName.toLowerCase();
  const candidates: FiredHint[] = [];

  for (const hint of hints) {
    let longestMatch: string | null = null;
    for (const kw of hint.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        if (longestMatch === null || kw.length > longestMatch.length) {
          longestMatch = kw;
        }
      }
    }
    if (longestMatch !== null) {
      candidates.push({ hint, matchedKeyword: longestMatch });
    }
  }

  if (candidates.length === 0) return null;

  // Sort: highest confidence first, then longest keyword
  candidates.sort((a, b) => {
    const confDiff =
      (CONFIDENCE_RANK[b.hint.confidence] ?? 0) - (CONFIDENCE_RANK[a.hint.confidence] ?? 0);
    if (confDiff !== 0) return confDiff;
    return b.matchedKeyword.length - a.matchedKeyword.length;
  });

  return candidates[0]!;
}

// ─────────────────────────────────────────────
// Main classifier
// ─────────────────────────────────────────────

/**
 * Classifies an account by first running the baseline classifier, then layering
 * IndustryProfile hints on top.
 *
 * Merge rules:
 * - Profile hint for accountType overrides baseline when hint confidence >= baseline
 *   confidence OR when hint confidence is 'high'.
 * - Profile hint for costBehavior always overrides baseline costBehavior when a hint fires.
 * - If a profile hint fired, source becomes 'profile_keyword'.
 *
 * @param accountName   - The human-readable account name.
 * @param accountNumber - Optional QBO-style account number.
 * @param profile       - The active IndustryProfile whose hints are applied.
 */
export function classifyWithProfile(
  accountName: string,
  accountNumber: string | undefined,
  profile: IndustryProfile,
): ClassificationResult {
  const base = classifyBaseline(accountName, accountNumber);

  const best = selectBestHint(accountName, profile.classificationHints);
  if (best === null) {
    // No profile hint fired — return baseline unchanged
    return base;
  }

  const { hint, matchedKeyword } = best;

  // ── Decide whether to override accountType ──
  const shouldOverrideType =
    hint.accountType !== undefined &&
    (hint.confidence === 'high' || atLeastAsGood(hint.confidence, base.confidence));

  const newAccountType = shouldOverrideType && hint.accountType !== undefined
    ? hint.accountType
    : base.accountType;

  // ── costBehavior: always override if profile hint has one ──
  const newCostBehavior =
    hint.costBehavior !== undefined ? hint.costBehavior : base.costBehavior;

  // ── Determine result confidence ──
  // Use the better of baseline confidence or hint confidence when type overridden,
  // otherwise keep baseline confidence.
  const newConfidence: ClassificationResult['confidence'] = shouldOverrideType
    ? (higherConfidence(hint.confidence, base.confidence) ? hint.confidence : base.confidence)
    : base.confidence;

  const hintNote = hint.note ? ` (${hint.note})` : '';
  const hintFired =
    `Profile hint "${matchedKeyword}" → ${hint.accountType ?? '(type unchanged)'}` +
    (hint.costBehavior ? `, ${hint.costBehavior}` : '') +
    hintNote;

  return {
    accountType: newAccountType,
    costBehavior: newCostBehavior,
    confidence: newConfidence,
    source: 'profile_keyword',
    hintFired,
  };
}

// ─────────────────────────────────────────────
// Batch classifier
// ─────────────────────────────────────────────

/**
 * Classifies a batch of accounts using the given IndustryProfile.
 *
 * @param accounts - Array of account objects with id, name, and optional number.
 * @param profile  - The active IndustryProfile.
 * @returns A Map keyed by account id, with ClassificationResult values.
 */
export function classifyAll(
  accounts: Array<{ id: string; name: string; number?: string }>,
  profile: IndustryProfile,
): Map<string, ClassificationResult> {
  const results = new Map<string, ClassificationResult>();
  for (const account of accounts) {
    results.set(account.id, classifyWithProfile(account.name, account.number, profile));
  }
  return results;
}
