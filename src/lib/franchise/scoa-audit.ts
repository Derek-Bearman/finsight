/**
 * Corporate SCOA audit + auto-mapping (FRANCHISE_BENCHMARKS_PLAN.md §F4).
 *
 * Given a franchise's corporate standard chart of accounts and a franchisee
 * workspace's actual accounts, produce:
 *   - missing:      SCOA accounts with no mapped/matchable client account
 *   - extra:        client accounts absent from the SCOA
 *   - discrepancies: matched pairs whose number or name drifts
 *   - autoMap:      proposed Account.scoaNumber assignments
 *
 * Matching mirrors the import matcher's structural guards (datasets.ts):
 * explicit scoaNumber mapping first, then exact number, then normalized name
 * BUT never across the P&L / Balance-Sheet divide when the SCOA row declares
 * a statement side, and summary-style rows are the caller's problem (the
 * workspace account list never contains summary rows — the parser strips
 * them). Pure functions, no I/O, no React.
 */

import type { Account, FranchiseScoaAccount } from '@/types';

function normName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

const PNL_TYPES = new Set(['revenue', 'cogs', 'expense']);

function accountStatementSide(a: Account): 'pnl' | 'balance' {
  return PNL_TYPES.has(a.type) ? 'pnl' : 'balance';
}

function sidesConflict(scoa: FranchiseScoaAccount, account: Account): boolean {
  if (!scoa.statementType) return false;
  return scoa.statementType !== accountStatementSide(account);
}

export interface ScoaDiscrepancy {
  scoa: FranchiseScoaAccount;
  account: Account;
  /** How the pair was matched. */
  matchedBy: 'mapping' | 'number' | 'name';
  /** Number drift: matched by name but the client number differs/missing. */
  numberMismatch: boolean;
  /** Name drift: matched by number/mapping but names normalize differently. */
  nameMismatch: boolean;
}

export interface ScoaAuditResult {
  /** SCOA rows with no client counterpart at all. */
  missing: FranchiseScoaAccount[];
  /** Client accounts that have no SCOA counterpart. */
  extra: Account[];
  /** Matched pairs with drift worth showing. */
  discrepancies: ScoaDiscrepancy[];
  /** Cleanly matched pairs (no drift). */
  matched: ScoaDiscrepancy[];
  /** Proposed scoaNumber assignments for currently-unmapped accounts,
   *  keyed by account id. Only structurally safe matches are proposed. */
  autoMap: Record<string, string>;
}

/**
 * Audit a workspace's chart against the corporate SCOA.
 *
 * Precedence per SCOA row: explicit mapping (Account.scoaNumber) → exact
 * account-number match → normalized-name match (statement-side guarded).
 * Each client account can satisfy at most one SCOA row (first wins in SCOA
 * order); each SCOA row matches at most one client account.
 */
export function auditScoa(
  scoaAccounts: FranchiseScoaAccount[],
  accounts: Account[]
): ScoaAuditResult {
  const missing: FranchiseScoaAccount[] = [];
  const discrepancies: ScoaDiscrepancy[] = [];
  const matched: ScoaDiscrepancy[] = [];
  const autoMap: Record<string, string> = {};
  const claimed = new Set<string>(); // account ids already paired

  // Indexes over the client chart.
  const byMapping = new Map<string, Account[]>();
  const byNumber = new Map<string, Account[]>();
  const byName = new Map<string, Account[]>();
  for (const a of accounts) {
    if (a.scoaNumber) push(byMapping, a.scoaNumber, a);
    if (a.number) push(byNumber, a.number.trim(), a);
    push(byName, normName(a.name), a);
  }

  for (const row of scoaAccounts) {
    const number = row.number.trim();

    // Tier 1: explicit mapping.
    let account = firstUnclaimed(byMapping.get(number), claimed);
    let matchedBy: ScoaDiscrepancy['matchedBy'] | null = account ? 'mapping' : null;

    // Tier 2: exact number (side-guarded).
    if (!account) {
      account = firstUnclaimed(byNumber.get(number), claimed, (a) => !sidesConflict(row, a));
      if (account) matchedBy = 'number';
    }

    // Tier 3: normalized name (side-guarded).
    if (!account) {
      account = firstUnclaimed(byName.get(normName(row.name)), claimed, (a) => !sidesConflict(row, a));
      if (account) matchedBy = 'name';
    }

    if (!account || !matchedBy) {
      missing.push(row);
      continue;
    }

    claimed.add(account.id);
    const numberMismatch = matchedBy === 'name' && (account.number?.trim() ?? '') !== number;
    const nameMismatch = matchedBy !== 'name' && normName(account.name) !== normName(row.name);
    const pair: ScoaDiscrepancy = { scoa: row, account, matchedBy, numberMismatch, nameMismatch };
    if (numberMismatch || nameMismatch) discrepancies.push(pair);
    else matched.push(pair);

    // Propose persisting the mapping when it is not already explicit.
    if (!account.scoaNumber) autoMap[account.id] = number;
  }

  const extra = accounts.filter((a) => !claimed.has(a.id));
  return { missing, extra, discrepancies, matched, autoMap };
}

function push<K>(map: Map<K, Account[]>, key: K, a: Account): void {
  const list = map.get(key);
  if (list) list.push(a);
  else map.set(key, [a]);
}

function firstUnclaimed(
  list: Account[] | undefined,
  claimed: Set<string>,
  extra?: (a: Account) => boolean
): Account | null {
  if (!list) return null;
  for (const a of list) {
    if (claimed.has(a.id)) continue;
    if (extra && !extra(a)) continue;
    return a;
  }
  return null;
}

/** Coverage summary line for UI chips: "42 of 51 SCOA accounts matched". */
export function scoaCoverage(result: ScoaAuditResult, scoaTotal: number): string {
  const matchedCount = result.matched.length + result.discrepancies.length;
  return `${matchedCount} of ${scoaTotal} SCOA accounts matched`;
}
