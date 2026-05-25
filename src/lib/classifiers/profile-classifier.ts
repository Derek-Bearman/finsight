/**
 * Profile-aware classifier — layers IndustryProfile hints on top of the baseline result.
 */

import type { AccountType, IndustryProfile, ClassificationHint, StatementType } from '@/types';
import { classifyBaseline, type ClassificationResult } from './baseline';

// ─────────────────────────────────────────────
// Statement-type constraint
// ─────────────────────────────────────────────

const PNL_TYPES: ReadonlySet<AccountType> = new Set(['revenue', 'cogs', 'expense']);
const BS_TYPES: ReadonlySet<AccountType> = new Set(['asset', 'liability', 'equity']);

/**
 * For a given statement type, returns the set of valid account types.
 * Returns null if no constraint (mixed import).
 */
function allowedTypesFor(
  statementType: StatementType | undefined,
): ReadonlySet<AccountType> | null {
  if (statementType === 'pnl') return PNL_TYPES;
  if (statementType === 'balance_sheet') return BS_TYPES;
  return null;
}

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
 * When `statementType` is supplied, the result is constrained to types
 * valid for that statement (revenue/cogs/expense for P&L,
 * asset/liability/equity for Balance Sheet). If the underlying classifier
 * picks an invalid type, the per-account `section` hint (from the parser)
 * is used as the authoritative override. This prevents BS lines like
 * "Customer Deposits" from being keyword-matched as 'deposits'→asset
 * when they sit under a LIABILITIES section.
 *
 * @param accounts        - Array of account objects with id, name, and optional number/section.
 * @param profile         - The active IndustryProfile.
 * @param statementType   - Optional. If 'pnl' / 'balance_sheet', constrains output to that statement's types.
 * @returns A Map keyed by account id, with ClassificationResult values.
 */
export function classifyAll(
  accounts: Array<{
    id: string;
    name: string;
    number?: string;
    section?: AccountType;
  }>,
  profile: IndustryProfile,
  statementType?: StatementType,
): Map<string, ClassificationResult> {
  const results = new Map<string, ClassificationResult>();
  const allowed = allowedTypesFor(statementType);

  for (const account of accounts) {
    const raw = classifyWithProfile(account.name, account.number, profile);

    // If statementType is unconstrained, return raw result as-is
    if (allowed === null) {
      results.set(account.id, raw);
      continue;
    }

    const sectionHint =
      account.section && allowed.has(account.section) ? account.section : null;

    // SECTION ALWAYS WINS for typed statement imports. Document structure
    // (the ASSETS / LIABILITIES / EQUITY headers in a BS, the Income /
    // COGS / Expenses headers in a P&L) is far more reliable than name
    // keywords. Example: "Customer Deposits" keyword-matches 'deposits'→
    // asset, but under a LIABILITIES section it's clearly a liability.
    if (sectionHint && raw.accountType !== sectionHint) {
      results.set(account.id, {
        ...raw,
        accountType: sectionHint,
        // If the raw classifier had high confidence (account number match),
        // demote to medium since section overrode it. Otherwise medium is
        // the right level — section context is strong but not definitive.
        confidence: raw.confidence === 'high' ? 'medium' : raw.confidence,
        hintFired: `${raw.hintFired}; forced to ${sectionHint} by ${statementType === 'pnl' ? 'P&L' : 'Balance Sheet'} section context`,
      });
      continue;
    }

    // Section agreed (or no section), and raw type is valid → accept raw
    if (raw.accountType !== null && allowed.has(raw.accountType)) {
      results.set(account.id, raw);
      continue;
    }

    // Raw type invalid AND no section hint → safe default with low confidence
    const fallback: AccountType =
      statementType === 'balance_sheet' ? 'asset' : 'expense';
    results.set(account.id, {
      ...raw,
      accountType: fallback,
      confidence: 'low',
      hintFired: `${raw.hintFired}; ${statementType === 'pnl' ? 'P&L' : 'Balance Sheet'} import — defaulted to ${fallback} (no section detected; review and reclassify)`,
    });
  }
  return results;
}
