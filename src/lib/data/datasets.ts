/**
 * Dataset registry helpers + import-diff engine.
 *
 * A workspace can hold several import snapshots (`datasets`); the active one is
 * mirrored into the top-level accounts/values so every calc keeps working. When
 * new data is imported we diff it against the current working set so the user
 * sees exactly what matches, what changed (with deltas), and what's new before
 * committing — the accountant's "is this the same data plus July?" check.
 */

import type { Account, AccountValue, ClientWorkspace, Period } from '@/types';
import { AUTO_EXCLUDE_NAMES } from './import-pipeline';

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

function externalKey(a: Account): string | null {
  return a.externalId && a.externalId.trim() ? `x:${a.externalId.trim()}` : null;
}
function numberKey(a: Account): string | null {
  return a.number && a.number.trim() ? `#${a.number.trim()}` : null;
}
function nameKey(a: Account): string {
  return `n:${normName(a.name)}`;
}

/**
 * True when BOTH sides carry an externalId and they disagree. Two accounts
 * known to be different records in the external system of record must never
 * merge, whatever their number or name says. One side missing an externalId
 * is NOT a conflict — that's the CSV-then-QBO adoption path.
 */
function externalIdConflict(inc: Account, cand: Account): boolean {
  const ik = externalKey(inc);
  const ck = externalKey(cand);
  return ik !== null && ck !== null && ik !== ck;
}

const PNL_TYPES = new Set<Account['type']>(['revenue', 'cogs', 'expense']);

/**
 * True when the two accounts live on opposite sides of the P&L/Balance-Sheet
 * divide. The inferential (number/name) matcher tiers must never pair across
 * it: a combined QBO batch can carry a P&L 'Insurance' expense AND a BS
 * 'Insurance' asset, and attaching one onto the other silently rewrites a
 * balance with a monthly expense. Tier-1 externalId matches are exempt — an
 * established QBO linkage must survive the user reclassifying the account.
 */
function crossesStatementSides(a: Account, b: Account): boolean {
  return PNL_TYPES.has(a.type) !== PNL_TYPES.has(b.type);
}

/**
 * An auto-excluded summary row created by a CSV import ('Total Income',
 * 'Net Income', …). When the INCOMING account is externally linked (a genuine
 * QBO account that happens to carry a summary-ish name), the inferential tiers
 * must not match it onto the placeholder — its values would vanish from every
 * calc (isExcluded) while the placeholder silently adopted the QBO linkage.
 * CSV-to-CSV re-imports (no externalId) still match placeholder-onto-
 * placeholder, so identical re-imports stay 'identical'.
 */
function isExcludedSummaryPlaceholder(a: Account): boolean {
  return a.isExcluded === true && AUTO_EXCLUDE_NAMES.has(normName(a.name));
}

interface AccountMatcher {
  /** Match an incoming account to an existing one (externalId first, then
   *  number, then name) and claim it, so each existing account is matched at
   *  most once. */
  match(inc: Account): Account | undefined;
  /** Register a newly-adopted account as a candidate for later incoming rows. */
  add(a: Account): void;
}

/**
 * Build a triple index of existing accounts keyed by externalId, account
 * number, AND normalized name, and a resolver that matches an incoming
 * account by externalId first (the external system's stable id — survives
 * renames and renumbering, making API re-sync idempotent), then number, then
 * name. Number/name tiers keep matching robust when one side has account
 * numbers and the other only names (common across QBO export settings).
 *
 * Guards on the lower (inferential) tiers — tier-1 externalId matches are
 * exempt from all of them, an established linkage always wins:
 *  - both sides carry DIFFERENT externalIds → never match by number or name
 *    (they are provably different records in the source system — including a
 *    reconnect to a different QBO company, whose realm-qualified externalIds
 *    all disagree);
 *  - incoming carries one, existing doesn't → number/name match still applies
 *    (the merge functions then adopt the incoming externalId — how a
 *    CSV-imported workspace links up on its first QBO sync);
 *  - the sides sit on opposite ends of the P&L/Balance-Sheet divide → never
 *    match (see crossesStatementSides);
 *  - incoming is externally linked and the candidate is an auto-excluded CSV
 *    summary placeholder → never match (see isExcludedSummaryPlaceholder).
 *
 * The matcher CONSUMES matches: duplicate same-name accounts (e.g. two
 * numberless 'Other' leaves from a QBO export) pair positionally — the Nth
 * incoming duplicate claims the Nth existing duplicate — instead of every
 * duplicate collapsing onto the first, which produced phantom conflicts on
 * identical re-imports and stacked twins' values onto one account on merge.
 */
function buildMatcher(existing: Account[]): AccountMatcher {
  const byExternalId = new Map<string, Account[]>();
  const byNumber = new Map<string, Account[]>();
  const byName = new Map<string, Account[]>();
  const claimed = new Set<Account>();
  const add = (a: Account) => {
    const xk = externalKey(a);
    if (xk) byExternalId.set(xk, [...(byExternalId.get(xk) ?? []), a]);
    const nk = numberKey(a);
    if (nk) byNumber.set(nk, [...(byNumber.get(nk) ?? []), a]);
    const nm = nameKey(a);
    byName.set(nm, [...(byName.get(nm) ?? []), a]);
  };
  for (const a of existing) add(a);
  return {
    add,
    match(inc: Account): Account | undefined {
      const xk = externalKey(inc);
      if (xk) {
        const byExt = (byExternalId.get(xk) ?? []).find((a) => !claimed.has(a));
        if (byExt) {
          claimed.add(byExt);
          return byExt;
        }
      }
      // Shared skip-guards for the inferential tiers below (doc above).
      const guarded = (cand: Account): boolean =>
        externalIdConflict(inc, cand) ||
        crossesStatementSides(inc, cand) ||
        (xk !== null && isExcludedSummaryPlaceholder(cand));
      const nk = numberKey(inc);
      if (nk) {
        const byNum = (byNumber.get(nk) ?? []).find((a) => !claimed.has(a) && !guarded(a));
        if (byNum) {
          claimed.add(byNum);
          return byNum;
        }
      }
      for (const cand of byName.get(nameKey(inc)) ?? []) {
        if (claimed.has(cand)) continue;
        if (guarded(cand)) continue;
        // If BOTH sides carry a number and they disagree, these are different
        // accounts that happen to share a name ('Other' #6000 vs 'Other' #7000) —
        // don't name-merge them. The one-side-missing-number case still matches.
        if (nk) {
          const ck = numberKey(cand);
          if (ck && ck !== nk) continue;
        }
        claimed.add(cand);
        return cand;
      }
      return undefined;
    },
  };
}

/**
 * When an incoming account carries an externalId and its matched existing
 * account has none, the existing account ADOPTS the incoming id — this is how
 * a CSV-imported workspace links each account to QuickBooks on the first API
 * sync. Every other case returns the existing account object unchanged (the
 * matcher guarantees both-sides-present externalIds always agree).
 */
function withAdoptedExternalId(exist: Account, inc: Account): Account {
  return inc.externalId && !exist.externalId ? { ...exist, externalId: inc.externalId } : exist;
}

/**
 * True when merging the incoming statement into the existing working set is
 * purely additive across the P&L/Balance-Sheet divide: no incoming account
 * would attach its values to an existing account on the OTHER statement side.
 * The matcher's inferential tiers refuse cross-statement pairs outright (a BS
 * 'Insurance' asset can no longer land on the P&L 'Insurance' expense — it
 * arrives as a new account), so the only attachment that can still cross the
 * divide is a tier-1 externalId match: the user reclassified a QBO-linked
 * account. This gate catches exactly that case before offering a same-period
 * Balance Sheet merge into a P&L-only working set (and vice versa).
 */
export function isAdditiveStatementMerge(
  existingAccounts: Account[],
  incomingAccounts: Account[]
): boolean {
  const matcher = buildMatcher(existingAccounts);
  for (const inc of incomingAccounts) {
    const exist = matcher.match(inc);
    if (exist && PNL_TYPES.has(exist.type) !== PNL_TYPES.has(inc.type)) return false;
  }
  return true;
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
  const matcher = buildMatcher(existingAccounts);

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
    const exist = matcher.match(inc);
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
  // Adopted accounts are registered on the matcher so a later incoming row
  // with the same name remaps onto them instead of becoming another new
  // account (registering — rather than rebuilding — preserves the matcher's
  // claimed set, so existing duplicate twins keep pairing positionally).
  const idRemap = new Map<string, string>();
  // Newly-adopted accounts have no existing values in ANY period, so their
  // full history (including overlapping periods) must come in — otherwise a
  // back-filled new account shows blank for the prior months.
  const newAccountIds = new Set<string>();
  const matcher = buildMatcher(accounts);
  for (const inc of incomingAccounts) {
    const exist = matcher.match(inc);
    if (exist) {
      idRemap.set(inc.id, exist.id);
      // First-sync linkage: a matched account with no externalId adopts the
      // incoming one so the NEXT sync matches on the stable id tier.
      const adopted = withAdoptedExternalId(exist, inc);
      if (adopted !== exist) {
        const idx = accounts.findIndex((a) => a.id === exist.id);
        if (idx >= 0) accounts[idx] = adopted;
      }
    } else {
      accounts.push(inc);
      matcher.add(inc);
      idRemap.set(inc.id, inc.id);
      newAccountIds.add(inc.id);
    }
  }

  // Adopted accounts arrive verbatim, but a parentId pointing at an incoming
  // account that MATCHED an existing one would dangle — that incoming id
  // never enters the workspace. Remap it through the same idRemap the values
  // use (a post-pass, since the parent may appear after the child). A parent
  // absent from the batch entirely is left as-is.
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i]!;
    if (!newAccountIds.has(a.id) || !a.parentId) continue;
    const target = idRemap.get(a.parentId);
    if (target !== undefined && target !== a.parentId) accounts[i] = { ...a, parentId: target };
  }

  // Add values for new periods, plus ALL periods of a newly-adopted account
  // (its overlapping-period values can't overwrite anything that exists).
  // The new-account test must use the remap TARGET id: a second incoming row
  // remapped onto a newly-adopted duplicate must bring its backfill history
  // too, not just its new-period values.
  for (const v of incomingValues) {
    const targetId = idRemap.get(v.accountId) ?? v.accountId;
    const isNewAccount = newAccountIds.has(targetId);
    if (existPeriods.has(periodKey(v.period)) && !isNewAccount) continue;
    values.push({ ...v, accountId: targetId });
  }

  return { accounts, values };
}

/**
 * Restatement-capable merge for authoritative re-syncs (QBO): matched
 * accounts get overlapping cells OVERWRITTEN with incoming values, new
 * periods and brand-new accounts come in with full history, and account
 * metadata (`name` / `number` / `externalId`) refreshes from incoming —
 * while the user's classification work (type, costBehavior, isExcluded,
 * isManuallyClassified, …) is preserved untouched. Existing accounts absent
 * from the incoming batch are left completely alone: a QBO report omits
 * accounts with no activity in the requested range, so absence is NOT
 * deletion.
 *
 * A cell is only overwritten where incoming actually provides a value for
 * that account×period — existing cells the batch doesn't mention survive.
 * `changedCells` counts overlapping-period cells on matched accounts whose
 * value moved beyond rounding (mirrors diffImport, so the review numbers and
 * the commit report agree); new periods and new accounts are additions, not
 * restatements, and are reported via `addedPeriods` / `addedAccounts`.
 */
export function mergeOverwrite(
  existingAccounts: Account[],
  existingValues: AccountValue[],
  incomingAccounts: Account[],
  incomingValues: AccountValue[]
): {
  accounts: Account[];
  values: AccountValue[];
  changedCells: number;
  addedPeriods: number;
  addedAccounts: number;
} {
  const existPeriods = new Set(existingValues.map((v) => periodKey(v.period)));
  const incPeriods = new Set(incomingValues.map((v) => periodKey(v.period)));
  let addedPeriods = 0;
  for (const pk of incPeriods) if (!existPeriods.has(pk)) addedPeriods++;

  // name always follows the source of record; number/externalId refresh only
  // when incoming provides one — a numberless CSV overwrite must not strip
  // the account numbers (or the QBO linkage) that future matching depends on.
  const refreshMetadata = (exist: Account, inc: Account): Account => {
    const number = inc.number && inc.number.trim() ? inc.number : exist.number;
    const externalId = inc.externalId && inc.externalId.trim() ? inc.externalId : exist.externalId;
    if (inc.name === exist.name && number === exist.number && externalId === exist.externalId) {
      return exist; // nothing moved — keep object identity stable
    }
    return { ...exist, name: inc.name, number, externalId };
  };

  // Same remap/adopt walk as mergeNewPeriods (see its comments for why
  // adopted accounts register on the matcher instead of rebuilding it).
  const matcher = buildMatcher(existingAccounts);
  const idRemap = new Map<string, string>();
  const newAccountIds = new Set<string>();
  const refreshedById = new Map<string, Account>();
  const adopted: Account[] = [];
  for (const inc of incomingAccounts) {
    const exist = matcher.match(inc);
    if (exist) {
      idRemap.set(inc.id, exist.id);
      const refreshed = refreshMetadata(exist, inc);
      if (refreshed !== exist) refreshedById.set(exist.id, refreshed);
    } else {
      matcher.add(inc);
      idRemap.set(inc.id, inc.id);
      newAccountIds.add(inc.id);
      adopted.push(inc);
    }
  }
  // Same dangling-parentId remap as mergeNewPeriods: an adopted account whose
  // parent matched an existing account must follow the remap, not keep an
  // incoming id that never enters the workspace.
  const accounts = [
    ...existingAccounts.map((a) => refreshedById.get(a.id) ?? a),
    ...adopted.map((a) => {
      if (!a.parentId) return a;
      const target = idRemap.get(a.parentId);
      return target !== undefined && target !== a.parentId ? { ...a, parentId: target } : a;
    }),
  ];

  const cellKey = (accountId: string, pk: string) => `${accountId}|${pk}`;

  // Sum existing amounts per cell for change counting (duplicate rows for one
  // account×period sum together, mirroring diffImport).
  const existSumByCell = new Map<string, number>();
  for (const v of existingValues) {
    const k = cellKey(v.accountId, periodKey(v.period));
    existSumByCell.set(k, (existSumByCell.get(k) ?? 0) + v.amount);
  }

  // Remap incoming rows onto their target accounts and group per cell — an
  // overwrite replaces the whole cell (all its duplicate rows) at once.
  const incRowsByCell = new Map<string, AccountValue[]>();
  for (const v of incomingValues) {
    const targetId = idRemap.get(v.accountId) ?? v.accountId;
    const k = cellKey(targetId, periodKey(v.period));
    const row = v.accountId === targetId ? v : { ...v, accountId: targetId };
    const rows = incRowsByCell.get(k);
    if (rows) rows.push(row);
    else incRowsByCell.set(k, [row]);
  }

  // Existing rows survive unless incoming provides that exact cell.
  const values: AccountValue[] = existingValues.filter(
    (v) => !incRowsByCell.has(cellKey(v.accountId, periodKey(v.period)))
  );

  let changedCells = 0;
  for (const [k, rows] of incRowsByCell) {
    values.push(...rows);
    const targetId = rows[0]!.accountId;
    if (newAccountIds.has(targetId)) continue; // adopted account backfill
    const pk = periodKey(rows[0]!.period);
    if (!existPeriods.has(pk)) continue; // new period, not a restatement
    const newSum = rows.reduce((s, r) => s + r.amount, 0);
    const oldSum = existSumByCell.get(k) ?? 0;
    if (Math.abs(newSum - oldSum) > EPSILON) changedCells++;
  }

  return { accounts, values, changedCells, addedPeriods, addedAccounts: adopted.length };
}
