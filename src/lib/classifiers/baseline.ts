/**
 * Baseline classifier — pure functions, no React, no side effects.
 * Runs before profile-specific hints to establish a base classification.
 */

import type { AccountType, CostBehavior, ConfidenceLevel } from '@/types';

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

export interface ClassificationResult {
  accountType: AccountType | null;
  costBehavior: CostBehavior | null;
  confidence: ConfidenceLevel;
  source: 'account_number' | 'baseline_keyword' | 'profile_keyword' | 'manual';
  /** Human-readable description of what fired */
  hintFired: string;
}

// ─────────────────────────────────────────────
// Account number ranges (Step 1)
// ─────────────────────────────────────────────

/** Maps the leading digit of an account number to an AccountType. */
const ACCOUNT_NUMBER_RANGES: Array<{ pattern: RegExp; type: AccountType; label: string }> = [
  { pattern: /^1\d{3}/, type: 'asset',     label: '1xxx asset range' },
  { pattern: /^2\d{3}/, type: 'liability', label: '2xxx liability range' },
  { pattern: /^3\d{3}/, type: 'equity',    label: '3xxx equity range' },
  { pattern: /^4\d{3}/, type: 'revenue',   label: '4xxx revenue range' },
  { pattern: /^5\d{3}/, type: 'cogs',      label: '5xxx COGS range' },
  { pattern: /^6\d{3}/, type: 'expense',   label: '6xxx expense range' },
  { pattern: /^7\d{3}/, type: 'expense',   label: '7xxx expense range' },
  { pattern: /^8\d{3}/, type: 'revenue',   label: '8xxx other income range' },
  { pattern: /^9\d{3}/, type: 'expense',   label: '9xxx tax/interest range' },
];

// ─────────────────────────────────────────────
// Keyword maps (Step 2)
// ─────────────────────────────────────────────

const ACCOUNT_TYPE_KEYWORDS: Array<{ type: AccountType; keywords: string[] }> = [
  {
    type: 'revenue',
    keywords: [
      'revenue', 'sales', 'income', 'service', 'fees', 'fee revenue', 'consulting revenue',
    ],
  },
  {
    type: 'cogs',
    keywords: [
      'cost of goods', 'cogs', 'materials', 'direct labor', 'merchant fee', 'direct cost',
    ],
  },
  {
    type: 'expense',
    keywords: [
      'rent', 'insurance', 'salary', 'wages', 'marketing', 'advertising', 'utilities',
      'depreciation', 'interest', 'tax', 'office', 'software', 'amortization', 'phone',
      'travel', 'meals', 'supplies', 'postage', 'maintenance', 'repairs', 'training',
      'dues', 'subscriptions', 'bank fee', 'legal', 'accounting fee', 'professional fee',
      'payroll',
    ],
  },
  {
    type: 'asset',
    keywords: [
      'cash', 'checking', 'savings', 'accounts receivable', ' ar ', 'inventory', 'equipment',
      'vehicle', 'building', 'prepaid', 'deposits', 'furniture', 'computer', 'land',
    ],
  },
  {
    type: 'liability',
    keywords: [
      'accounts payable', ' ap ', 'loan', 'credit card', 'line of credit', 'accrued',
      'deferred', 'note payable', 'mortgage', 'payroll liab', 'sales tax payable',
    ],
  },
  {
    type: 'equity',
    keywords: [
      'retained earnings', 'owner', 'capital', 'distribution', 'draw', 'common stock',
      'member equity', 'partner equity', 'stockholder',
    ],
  },
];

// ─────────────────────────────────────────────
// Cost behavior keywords (Step 3)
// ─────────────────────────────────────────────

const COST_BEHAVIOR_KEYWORDS: Array<{ behavior: CostBehavior; keywords: string[] }> = [
  {
    behavior: 'variable',
    keywords: [
      'materials', 'commission', 'merchant fee', 'credit card fee', 'freight', 'hourly',
      'subcontractor', 'fuel', 'delivery', 'shipping', 'parts', 'supplies', 'cogs',
      'direct labor', 'cost of goods',
    ],
  },
  {
    behavior: 'fixed',
    keywords: [
      'rent', 'insurance', 'salary', 'subscription', 'software', 'loan payment',
      'depreciation', 'lease', 'amortization', 'base salary', 'office rent', 'property tax',
    ],
  },
  {
    behavior: 'mixed',
    keywords: [
      'utilities', 'phone', 'maintenance', 'repairs', 'travel', 'meals', 'payroll',
    ],
  },
];

// ─────────────────────────────────────────────
// Helper: find the longest matching keyword
// ─────────────────────────────────────────────

/**
 * Searches `haystack` for all keywords in `list` (case-insensitive, substring match).
 * Returns the keyword with the most characters (most specific match), or null.
 */
function findLongestKeywordMatch(haystack: string, keywords: string[]): string | null {
  const lower = haystack.toLowerCase();
  let best: string | null = null;
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      if (best === null || kw.length > best.length) {
        best = kw;
      }
    }
  }
  return best;
}

// ─────────────────────────────────────────────
// Step 1 — Account number classification
// ─────────────────────────────────────────────

/**
 * Attempts to classify an account purely from its account number.
 * Returns null if the number is absent or unrecognised.
 */
function classifyByAccountNumber(
  accountNumber: string,
): { type: AccountType; label: string } | null {
  const trimmed = accountNumber.trim();
  for (const entry of ACCOUNT_NUMBER_RANGES) {
    if (entry.pattern.test(trimmed)) {
      return { type: entry.type, label: entry.label };
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// Step 2 — Account name keyword classification
// ─────────────────────────────────────────────

/**
 * Classifies an account type from keywords in the account name.
 * Returns the entry with the longest matching keyword for highest specificity.
 */
function classifyTypeByKeyword(
  accountName: string,
): { type: AccountType; keyword: string } | null {
  let bestType: AccountType | null = null;
  let bestKeyword: string | null = null;

  for (const { type, keywords } of ACCOUNT_TYPE_KEYWORDS) {
    const match = findLongestKeywordMatch(accountName, keywords);
    if (match !== null) {
      if (bestKeyword === null || match.length > bestKeyword.length) {
        bestType = type;
        bestKeyword = match;
      }
    }
  }

  return bestType && bestKeyword ? { type: bestType, keyword: bestKeyword } : null;
}

// ─────────────────────────────────────────────
// Step 3 — Cost behavior keyword classification
// ─────────────────────────────────────────────

/**
 * Determines cost behavior from keywords in the account name.
 * Returns the behavior matching the longest keyword, or 'mixed' as a fallback
 * when the name contains ambiguous cost-related language.
 */
function classifyCostBehavior(
  accountName: string,
): { behavior: CostBehavior; keyword: string } | null {
  let bestBehavior: CostBehavior | null = null;
  let bestKeyword: string | null = null;

  for (const { behavior, keywords } of COST_BEHAVIOR_KEYWORDS) {
    const match = findLongestKeywordMatch(accountName, keywords);
    if (match !== null) {
      if (bestKeyword === null || match.length > bestKeyword.length) {
        bestBehavior = behavior;
        bestKeyword = match;
      }
    }
  }

  return bestBehavior && bestKeyword ? { behavior: bestBehavior, keyword: bestKeyword } : null;
}

// ─────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────

/**
 * Baseline classifier that runs before profile-specific hints.
 *
 * Classification priority:
 * 1. Account number range match → high confidence for accountType
 * 2. Account name keyword match → medium confidence for accountType
 * 3. No match → null accountType, low confidence
 *
 * Cost behavior is always derived from keyword matching only,
 * never inferred from the account number.
 *
 * @param accountName  - The human-readable account name (e.g. "Office Rent")
 * @param accountNumber - Optional QBO-style account number (e.g. "6100")
 * @returns A ClassificationResult with accountType, costBehavior, confidence, source, and hintFired.
 */
export function classifyBaseline(
  accountName: string,
  accountNumber?: string,
): ClassificationResult {
  // ── Step 1: account number range ──
  if (accountNumber) {
    const numResult = classifyByAccountNumber(accountNumber);
    if (numResult) {
      // Cost behavior from keyword matching regardless of number match
      const behaviorResult = classifyCostBehavior(accountName);
      return {
        accountType: numResult.type,
        costBehavior: behaviorResult ? behaviorResult.behavior : null,
        confidence: 'high',
        source: 'account_number',
        hintFired: `Account number ${accountNumber.trim()} matched ${numResult.label}${
          behaviorResult ? `; cost behavior "${behaviorResult.keyword}" → ${behaviorResult.behavior}` : ''
        }`,
      };
    }
  }

  // ── Step 2: account name keyword ──
  const typeResult = classifyTypeByKeyword(accountName);
  const behaviorResult = classifyCostBehavior(accountName);

  if (typeResult) {
    return {
      accountType: typeResult.type,
      costBehavior: behaviorResult ? behaviorResult.behavior : null,
      confidence: 'medium',
      source: 'baseline_keyword',
      hintFired: `Keyword "${typeResult.keyword}" → ${typeResult.type}${
        behaviorResult ? `; cost behavior "${behaviorResult.keyword}" → ${behaviorResult.behavior}` : ''
      }`,
    };
  }

  // ── Step 3: no match ──
  return {
    accountType: null,
    costBehavior: behaviorResult ? behaviorResult.behavior : null,
    confidence: 'low',
    source: 'baseline_keyword',
    hintFired: `No account type match found for "${accountName}"${
      behaviorResult ? `; cost behavior "${behaviorResult.keyword}" → ${behaviorResult.behavior}` : ''
    }`,
  };
}
