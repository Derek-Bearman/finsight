/**
 * Dataset registry helpers + import-diff engine.
 *
 * A workspace can hold several import snapshots (`datasets`); the active one is
 * mirrored into the top-level accounts/values so every calc keeps working. When
 * new data is imported we diff it against the current working set so the user
 * sees exactly what matches, what changed (with deltas), and what's new before
 * committing — the accountant's "is this the same data plus July?" check.
 */

import type { Account, AccountValue, ClientWorkspace, Dataset, Period } from '@/types';

const EPSILON = 0.5; // dollars — sub-dollar differences are rounding noise

export function periodKey(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

export function periodLabelShort(p: Period): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[p.month - 1]} ${p.year}`;
}

/** Normalize an account name for matching (lowercase, collapse whitespace). */
function normName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

function numberKey(a: Account): string | null {
  return a.number && a.number.trim() ? `#${a.number.trim()}` : null;
}
function nameKey(a: Account): string {
  return `n:${normName(a.name)}`;
}

/**
 * Build a dual index of existing accounts keyed by BOTH account number and
 * normalized name, and a resolver that matches an incoming account by number
 * first, then name. This makes matching robust when one side has account
 * numbers and the other only names (common across QBO export settings).
 */
function buildMatcher(existing: Account[]): (inc: Account) => Account | undefined {
  const byNumber = new Map<string, Account>();
  const byName = new Map<string, Account>();
  for (const a of existing) {
    const nk = numberKey(a);
    if (nk && !byNumber.has(nk)) byNumber.set(nk, a);
    const nm = nameKey(a);
    if (!byName.has(nm)) byName.set(nm, a);
  }
  return (inc: Account) => {
    const nk = numberKey(inc);
    if (nk && byNumber.has(nk)) return byNumber.get(nk);
    const cand = byName.get(nameKey(inc));
    // If BOTH sides carry a number and they disagree, these are different
    // accounts that happen to share a name ('Other' #6000 vs 'Other' #7000) —
    // don't name-merge them. The one-side-missing-number case still matches.
    if (nk && cand) {
      const ck = numberKey(cand);
      if (ck && ck !== nk) return undefined;
    }
    return cand;
  };
}

/** The list the workspace should show in a dataset selector. Legacy workspaces
 *  with no registry get a single synthetic "Current data" entry. */
export function datasetOptions(ws: ClientWorkspace): { id: string; label: string; importedAt?: string }[] {
  if (ws.datasets && ws.datasets.length > 0) {
    return ws.datasets.map((d) => ({ id: d.id, label: d.label, importedAt: d.importedAt }));
  }
  return [{ id: '__current__', label: 'Current data' }];
}

export function activeDatasetId(ws: ClientWorkspace): string {
  if (ws.datasets && ws.datasets.length > 0) {
    return ws.activeDatasetId && ws.datasets.some((d) => d.id === ws.activeDatasetId)
      ? ws.activeDatasetId
      : ws.datasets[0]!.id;
  }
  return '__current__';
}

// ── Diff engine ──────────────────────────────────────────────────────────────

export interface CellChange {
  accountName: string;
  accountNumber?: string;
  period: Period;
  oldValue: number;
  newValue: number;
  delta: number;
}

export interface ImportDiff {
  /** All periods present in the incoming file. */
  incomingPeriods: Period[];
  /** Periods present in BOTH old and new. */
  overlappingPeriods: Period[];
  /** Periods in the incoming file that don't exist yet. */
  newPeriods: Period[];
  /** Overlapping account×period cells whose value changed beyond rounding. */
  changedCells: CellChange[];
  /** Count of overlapping cells that matched (within rounding). */
  matchedCells: number;
  /** Incoming accounts with no match in the existing set. */
  newAccounts: { name: string; number?: string }[];
  /** Overall verdict. */
  status: 'identical' | 'extends' | 'conflicts' | 'disjoint';
}

/**
 * Diff an incoming import against the current working accounts/values.
 *  - identical: overlap matches exactly and nothing new
 *  - extends:   overlap matches and there are new periods/accounts (the happy
 *               "same history + new month" case)
 *  - conflicts: some overlapping cell disagrees
 *  - disjoint:  no overlapping periods at all
 */
export function diffImport(
  existingAccounts: Account[],
  existingValues: AccountValue[],
  incomingAccounts: Account[],
  incomingValues: AccountValue[]
): ImportDiff {
  const matchExisting = buildMatcher(existingAccounts);

  const existValByAcct = new Map<string, Map<string, number>>(); // acctId -> periodKey -> amount
  for (const v of existingValues) {
    const m = existValByAcct.get(v.accountId) ?? new Map<string, number>();
    m.set(periodKey(v.period), (m.get(periodKey(v.period)) ?? 0) + v.amount);
    existValByAcct.set(v.accountId, m);
  }

  const incValByAcct = new Map<string, Map<string, number>>();
  for (const v of incomingValues) {
    const m = incValByAcct.get(v.accountId) ?? new Map<string, number>();
    m.set(periodKey(v.period), (m.get(periodKey(v.period)) ?? 0) + v.amount);
    incValByAcct.set(v.accountId, m);
  }

  const existPeriods = new Set(existingValues.map((v) => periodKey(v.period)));
  const incPeriodMap = new Map<string, Period>();
  for (const v of incomingValues) incPeriodMap.set(periodKey(v.period), v.period);

  const incomingPeriods = Array.from(incPeriodMap.values()).sort(
    (a, b) => a.year * 12 + a.month - (b.year * 12 + b.month)
  );
  const overlappingPeriods = incomingPeriods.filter((p) => existPeriods.has(periodKey(p)));
  const newPeriods = incomingPeriods.filter((p) => !existPeriods.has(periodKey(p)));

  const changedCells: CellChange[] = [];
  let matchedCells = 0;
  const newAccounts: { name: string; number?: string }[] = [];

  for (const inc of incomingAccounts) {
    const exist = matchExisting(inc);
    if (!exist) {
      // Only flag as a new account if it actually carries values.
      const hasValues = (incValByAcct.get(inc.id)?.size ?? 0) > 0;
      if (hasValues) newAccounts.push(inc.number ? { name: inc.name, number: inc.number } : { name: inc.name });
      continue;
    }
    const incVals = incValByAcct.get(inc.id) ?? new Map();
    const existVals = existValByAcct.get(exist.id) ?? new Map();
    for (const p of overlappingPeriods) {
      const pk = periodKey(p);
      if (!incVals.has(pk)) continue;
      const oldV = existVals.get(pk) ?? 0;
      const newV = incVals.get(pk) ?? 0;
      if (Math.abs(newV - oldV) <= EPSILON) {
        matchedCells++;
      } else {
        changedCells.push({
          accountName: inc.name,
          accountNumber: inc.number,
          period: p,
          oldValue: oldV,
          newValue: newV,
          delta: newV - oldV,
        });
      }
    }
  }

  let status: ImportDiff['status'];
  if (overlappingPeriods.length === 0) status = 'disjoint';
  else if (changedCells.length > 0) status = 'conflicts';
  else if (newPeriods.length > 0 || newAccounts.length > 0) status = 'extends';
  else status = 'identical';

  return {
    incomingPeriods,
    overlappingPeriods,
    newPeriods,
    changedCells,
    matchedCells,
    newAccounts,
    status,
  };
}

/**
 * Merge incoming data into the existing working set for the NEW periods only
 * (and new accounts) — the safe, non-destructive "add July" path. Existing
 * overlapping values are left untouched. Returns a new {accounts, values}.
 */
export function mergeNewPeriods(
  existingAccounts: Account[],
  existingValues: AccountValue[],
  incomingAccounts: Account[],
  incomingValues: AccountValue[]
): { accounts: Account[]; values: AccountValue[] } {
  const existPeriods = new Set(existingValues.map((v) => periodKey(v.period)));

  const accounts = [...existingAccounts];
  const values = [...existingValues];

  // Map incoming account id -> the existing account id it should attach to.
  // Rebuild the matcher as we adopt new accounts so two incoming rows with the
  // same name don't each become a separate new account.
  const idRemap = new Map<string, string>();
  // Newly-adopted accounts have no existing values in ANY period, so their
  // full history (including overlapping periods) must come in — otherwise a
  // back-filled new account shows blank for the prior months.
  const newAccountIds = new Set<string>();
  let matchExisting = buildMatcher(accounts);
  for (const inc of incomingAccounts) {
    const exist = matchExisting(inc);
    if (exist) {
      idRemap.set(inc.id, exist.id);
    } else {
      accounts.push(inc);
      matchExisting = buildMatcher(accounts);
      idRemap.set(inc.id, inc.id);
      newAccountIds.add(inc.id);
    }
  }

  // Add values for new periods, plus ALL periods of a newly-adopted account
  // (its overlapping-period values can't overwrite anything that exists).
  for (const v of incomingValues) {
    const isNewAccount = newAccountIds.has(v.accountId);
    if (existPeriods.has(periodKey(v.period)) && !isNewAccount) continue;
    const targetId = idRemap.get(v.accountId) ?? v.accountId;
    values.push({ ...v, accountId: targetId });
  }

  return { accounts, values };
}
