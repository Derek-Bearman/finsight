/**
 * Dataset-commit extraction checks:
 *   npx tsx scripts/checks/dataset-commit.check.ts
 *
 * The commit bookkeeping moved out of StatementsView.tsx into
 * src/lib/data/dataset-commit.ts (shared with the QBO sync flow). This suite
 * is the parity proof: for a fixture workspace and incoming batch, the
 * extracted commitMergeNewPeriods / commitReplaceAsNewDataset must produce
 * the EXACT workspace patch the pre-refactor inline component logic produced
 * (encoded below as literals), plus commitOverwriteMerge behavior and
 * ensureDatasetRegistry on a legacy workspace without a registry.
 */

import type { Account, AccountValue, ClientWorkspace, Dataset } from '../../src/types';
import {
  ensureDatasetRegistry,
  commitMergeNewPeriods,
  commitReplaceAsNewDataset,
  commitOverwriteMerge,
} from '../../src/lib/data/dataset-commit';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

const acc = (id: string, name: string, type: Account['type'], number?: string): Account => ({
  id,
  name,
  type,
  number,
  isManuallyClassified: false,
});
const val = (accountId: string, year: number, month: number, amount: number): AccountValue => ({
  accountId,
  period: { year, month },
  amount,
});

// ── Fixture: a registry workspace with an in-session classification edit ─────
// ds-a is the active dataset; the WORKING copy carries an edit (costBehavior
// on Sales) that ds-a's stored snapshot doesn't have yet — this is exactly the
// state the pre-refactor inline logic had to handle (snapshot-before-append on
// replace; working-copy-wins on merge).

const A1 = acc('e1', 'Sales', 'revenue', '4000');
const A1edited: Account = { ...A1, costBehavior: 'variable' };
const A2 = acc('e2', 'Rent', 'expense', '6300');
const wsValues = [val('e1', 2026, 1, 1000), val('e1', 2026, 2, 1100), val('e2', 2026, 1, 300), val('e2', 2026, 2, 300)];

const dsA: Dataset = {
  id: 'ds-a',
  label: 'Original import',
  importedAt: '2026-01-05T00:00:00.000Z',
  accounts: [A1, A2], // stale: pre-edit snapshot
  values: wsValues,
};
const dsB: Dataset = {
  id: 'ds-b',
  label: 'Q1 upload',
  importedAt: '2026-02-01T00:00:00.000Z',
  accounts: [A1],
  values: [val('e1', 2026, 1, 999)],
};

const makeWs = (): ClientWorkspace => ({
  id: 'ws1',
  name: 'Parity Co',
  industryProfileId: 'generic',
  accounts: [A1edited, A2],
  values: wsValues,
  datasets: [dsA, dsB],
  activeDatasetId: 'ds-a',
  fiscalYearStart: 1,
  scenarios: [],
  operationalData: [],
  customMetrics: [],
  auditLog: [],
  createdAt: '2026-01-05T00:00:00.000Z',
  updatedAt: '2026-01-05T00:00:00.000Z',
});

// Incoming batch: same two accounts + March, plus a brand-new Delivery
// account with full Jan–Mar history.
const I3 = acc('i3', 'Delivery', 'expense', '5300');
const incoming = {
  accounts: [acc('i1', 'Sales', 'revenue', '4000'), acc('i2', 'Rent', 'expense', '6300'), I3],
  values: [
    val('i1', 2026, 1, 1000), val('i1', 2026, 2, 1100), val('i1', 2026, 3, 1200),
    val('i2', 2026, 1, 300), val('i2', 2026, 2, 300), val('i2', 2026, 3, 300),
    val('i3', 2026, 1, 20), val('i3', 2026, 2, 25), val('i3', 2026, 3, 30),
  ],
};

// ── 1. commitMergeNewPeriods parity (registry workspace) ─────────────────────
// Expected literal = what the pre-refactor inline handler passed to
// updateWorkspace: merged working copy, active dataset replaced with the
// merged accounts/values, other datasets untouched, active id unchanged.
{
  const ws = makeWs();
  const patch = commitMergeNewPeriods(ws, incoming);
  const _assignable: Partial<ClientWorkspace> = patch; // compile-time contract
  void _assignable;

  const expectedAccounts = [A1edited, A2, I3];
  const expectedValues = [
    ...wsValues,
    val('e1', 2026, 3, 1200),
    val('e2', 2026, 3, 300),
    val('i3', 2026, 1, 20),
    val('i3', 2026, 2, 25),
    val('i3', 2026, 3, 30),
  ];
  const expected = {
    accounts: expectedAccounts,
    values: expectedValues,
    datasets: [
      { id: 'ds-a', label: 'Original import', importedAt: '2026-01-05T00:00:00.000Z', accounts: expectedAccounts, values: expectedValues },
      dsB,
    ],
    activeDatasetId: 'ds-a',
  };
  check(JSON.stringify(patch) === JSON.stringify(expected), 'merge parity: patch matches the pre-refactor inline output exactly');
  check(patch.datasets[1] === dsB, 'merge parity: non-active dataset passes through by reference');
  check(patch.accounts[0] === A1edited, 'merge parity: merge starts from the WORKING copy (in-session edit kept), not the stale snapshot');
  check(patch.datasets[0]!.accounts === patch.accounts && patch.datasets[0]!.values === patch.values,
    'merge parity: active dataset mirrors the new working copy');
}

// ── 2. commitReplaceAsNewDataset parity (registry workspace) ─────────────────
// The inline handler snapshotted the outgoing active dataset from the WORKING
// copy first (so in-session edits survive), then appended the new dataset and
// switched to it. Only newDs.id / importedAt are time-generated — everything
// else must match the encoded literals.
{
  const ws = makeWs();
  const label = 'P&L · restated.xlsx';
  const before = Date.now();
  const patch = commitReplaceAsNewDataset(ws, incoming, label);
  const after = Date.now();

  check(patch.accounts === incoming.accounts && patch.values === incoming.values,
    'replace parity: working copy becomes the incoming batch (by reference)');
  check(patch.datasets.length === 3, `replace parity: 3 datasets, got ${patch.datasets.length}`);
  const expectedSnapshotA = {
    id: 'ds-a',
    label: 'Original import',
    importedAt: '2026-01-05T00:00:00.000Z',
    accounts: [A1edited, A2], // the WORKING copy, not ds-a's stale snapshot
    values: wsValues,
  };
  check(JSON.stringify(patch.datasets[0]) === JSON.stringify(expectedSnapshotA),
    'replace parity: outgoing active dataset snapshots the working copy exactly');
  check(patch.datasets[1] === dsB, 'replace parity: non-active dataset passes through by reference');
  const newDs = patch.datasets[2]!;
  check(/^ds-\d+$/.test(newDs.id), `replace parity: generated id shape ds-<ts>, got ${newDs.id}`);
  check(newDs.label === label, `replace parity: label passes through, got ${newDs.label}`);
  const importedAtMs = Date.parse(newDs.importedAt);
  check(importedAtMs >= before && importedAtMs <= after, `replace parity: importedAt is now(), got ${newDs.importedAt}`);
  check(newDs.accounts === incoming.accounts && newDs.values === incoming.values,
    'replace parity: new dataset holds the incoming batch by reference');
  check(patch.activeDatasetId === newDs.id, 'replace parity: switches to the new dataset');
}

// ── 3. ensureDatasetRegistry ─────────────────────────────────────────────────
{
  // Registry workspace: pass-through by reference (no synthesis).
  const ws = makeWs();
  check(ensureDatasetRegistry(ws) === ws.datasets, 'ensureRegistry: existing registry passes through by reference');

  // Legacy workspace (no datasets): synthesize the "Original import" snapshot
  // exactly as the inline code did.
  const legacy: ClientWorkspace = { ...makeWs(), datasets: undefined, activeDatasetId: undefined };
  const reg = ensureDatasetRegistry(legacy);
  check(reg.length === 1, `ensureRegistry legacy: one synthetic entry, got ${reg.length}`);
  const entry = reg[0]!;
  check(/^ds-original-\d+$/.test(entry.id), `ensureRegistry legacy: id shape ds-original-<ts>, got ${entry.id}`);
  check(entry.label === 'Original import', `ensureRegistry legacy: label, got ${entry.label}`);
  check(entry.importedAt === legacy.createdAt, `ensureRegistry legacy: importedAt = workspace createdAt, got ${entry.importedAt}`);
  check(entry.accounts === legacy.accounts && entry.values === legacy.values,
    'ensureRegistry legacy: snapshot holds the working copy by reference');
}

// ── 4. commitMergeNewPeriods on a LEGACY workspace ───────────────────────────
// Pre-refactor: activeDatasetId(ws) = '__current__' resolves to nothing, so
// the synthesized registry's first entry becomes the active dataset.
{
  const legacy: ClientWorkspace = { ...makeWs(), datasets: undefined, activeDatasetId: undefined };
  const patch = commitMergeNewPeriods(legacy, incoming);
  check(patch.datasets.length === 1, `legacy merge: single synthesized dataset, got ${patch.datasets.length}`);
  const ds = patch.datasets[0]!;
  check(/^ds-original-\d+$/.test(ds.id) && patch.activeDatasetId === ds.id,
    'legacy merge: active id is the synthesized dataset');
  check(ds.label === 'Original import' && ds.importedAt === legacy.createdAt, 'legacy merge: synthesized metadata intact');
  check(ds.accounts === patch.accounts && ds.values === patch.values, 'legacy merge: dataset mirrors the merged working copy');
  const march = patch.values.find((v) => v.accountId === 'e1' && v.period.month === 3);
  check(march?.amount === 1200, `legacy merge: March lands in the working copy, got ${march?.amount}`);
}

// ── 5. commitOverwriteMerge (restatement + optional relabel) ─────────────────
{
  const ws = makeWs();
  // Restates Feb Sales (1100 → 1150) and adds March; Rent absent from batch.
  const restated = {
    accounts: [acc('i1', 'Sales', 'revenue', '4000')],
    values: [val('i1', 2026, 1, 1000), val('i1', 2026, 2, 1150), val('i1', 2026, 3, 1200)],
  };
  const patch = commitOverwriteMerge(ws, restated, 'QuickBooks — Acme Co');
  const _assignable: Partial<ClientWorkspace> = patch;
  void _assignable;

  check(patch.activeDatasetId === 'ds-a', `overwrite commit: stays on the active dataset, got ${patch.activeDatasetId}`);
  check(patch.datasets[0]!.label === 'QuickBooks — Acme Co', `overwrite commit: active dataset relabeled, got ${patch.datasets[0]!.label}`);
  check(patch.datasets[1] === dsB, 'overwrite commit: non-active dataset passes through by reference');
  check(patch.datasets[0]!.accounts === patch.accounts && patch.datasets[0]!.values === patch.values,
    'overwrite commit: active dataset mirrors the new working copy');
  check(patch.accounts.length === 2 && patch.accounts[0] === A1edited && patch.accounts[1] === A2,
    'overwrite commit: classification edit and absent account survive');
  const feb = patch.values.filter((v) => v.accountId === 'e1' && v.period.month === 2);
  check(feb.length === 1 && feb[0]!.amount === 1150, `overwrite commit: Feb restated to 1150, got ${JSON.stringify(feb.map((v) => v.amount))}`);
  const march = patch.values.find((v) => v.accountId === 'e1' && v.period.month === 3);
  check(march?.amount === 1200, `overwrite commit: March added, got ${march?.amount}`);
  const rent = patch.values.filter((v) => v.accountId === 'e2');
  check(rent.length === 2 && rent.every((v) => v.amount === 300), `overwrite commit: absent account's values untouched, got ${rent.length}`);

  // Without a label the active dataset keeps its name.
  const patch2 = commitOverwriteMerge(makeWs(), restated);
  check(patch2.datasets[0]!.label === 'Original import', `overwrite commit: no label → name unchanged, got ${patch2.datasets[0]!.label}`);
}

// ── 6. commitMergeNewPeriods provenance label (QBO into empty workspace) ─────
// Regression for the 2026-07-23 first-real-connect finding: a QBO backfill
// into an EMPTY workspace takes the merge-new-periods path (diff verdict
// 'disjoint' — nothing overlaps), lands in the bootstrap dataset, and stayed
// labeled "Original import". With `label` passed the commit carries its
// provenance (plan §2.8: "QuickBooks — <CompanyName>").
{
  const empty: ClientWorkspace = {
    ...makeWs(),
    accounts: [],
    values: [],
    datasets: undefined,
    activeDatasetId: undefined,
  };
  const patch = commitMergeNewPeriods(empty, incoming, 'QuickBooks — Arktos Bookkeeping');
  check(patch.datasets.length === 1, `qbo label: single bootstrap dataset, got ${patch.datasets.length}`);
  check(
    patch.datasets[0]!.label === 'QuickBooks — Arktos Bookkeeping',
    `qbo label: empty-workspace backfill carries provenance, got "${patch.datasets[0]!.label}"`
  );
  check(patch.values.length === incoming.values.length, 'qbo label: full batch lands in the empty workspace');

  // Registry workspace: label relabels the ACTIVE dataset only.
  const patch2 = commitMergeNewPeriods(makeWs(), incoming, 'QuickBooks — Acme Co');
  check(patch2.datasets[0]!.label === 'QuickBooks — Acme Co', `qbo label: active dataset relabeled, got "${patch2.datasets[0]!.label}"`);
  check(patch2.datasets[1]!.label === 'Q1 upload', 'qbo label: non-active dataset keeps its name');

  // No label (the file-import path) stays exactly as before — also pinned by
  // the section-1 parity literal above.
  const patch3 = commitMergeNewPeriods(makeWs(), incoming);
  check(patch3.datasets[0]!.label === 'Original import', `qbo label: no label → name unchanged, got "${patch3.datasets[0]!.label}"`);
}

if (failures > 0) {
  console.error(`\n${failures} dataset-commit check(s) FAILED`);
  process.exit(1);
}
console.log('All dataset-commit checks passed.');
