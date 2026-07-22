/**
 * Dataset-commit bookkeeping — the pure "what does this import do to the
 * workspace" layer. This lives in lib (not in a component) because TWO flows
 * commit imported data through identical rules: the statements-view manual
 * upload AND the QuickBooks sync loop. Each helper takes the current
 * ClientWorkspace plus an incoming {accounts, values} batch and returns the
 * exact Partial<ClientWorkspace> patch the caller hands to
 * useWorkspaceStore.updateWorkspace — no React, no store imports, so the same
 * functions are callable from a component event handler, the client-driven
 * QBO sync orchestrator, or a headless check script.
 */

import type { Account, AccountValue, ClientWorkspace, Dataset } from '@/types';
import { activeDatasetId, mergeNewPeriods, mergeOverwrite } from './datasets';

/** An import batch ready to commit (parsed file or transformed QBO report). */
export interface IncomingBatch {
  accounts: Account[];
  values: AccountValue[];
}

/**
 * The workspace fields a dataset commit touches. Structurally a
 * Partial<ClientWorkspace>, but concrete so callers can read the result
 * (e.g. the post-commit toast counts) without null checks.
 */
export interface DatasetCommitPatch {
  accounts: Account[];
  values: AccountValue[];
  datasets: Dataset[];
  activeDatasetId: string;
}

/**
 * Snapshot the current working data as a dataset if the registry is empty, so
 * nothing is lost when the first re-import happens. Legacy workspaces predate
 * the registry and only carry top-level accounts/values; their first commit
 * materializes those as the "Original import" entry.
 */
export function ensureDatasetRegistry(ws: ClientWorkspace): NonNullable<ClientWorkspace['datasets']> {
  if (ws.datasets && ws.datasets.length > 0) return ws.datasets;
  return [
    {
      id: `ds-original-${Date.now()}`,
      label: 'Original import',
      importedAt: ws.createdAt,
      accounts: ws.accounts,
      values: ws.values,
    },
  ];
}

/** The registry entry the workspace's working copy mirrors. Falls back to the
 *  first entry when the stored id doesn't resolve (legacy '__current__'). */
function resolveActive(ws: ClientWorkspace, registry: Dataset[]): Dataset {
  return registry.find((d) => d.id === activeDatasetId(ws)) ?? registry[0]!;
}

/**
 * "Add July" — merge the incoming batch's NEW periods (and new accounts, with
 * their full history) into the ACTIVE dataset without touching any existing
 * value. The safe, non-destructive path for a YTD re-import.
 */
export function commitMergeNewPeriods(
  ws: ClientWorkspace,
  incoming: IncomingBatch
): DatasetCommitPatch {
  const merged = mergeNewPeriods(ws.accounts, ws.values, incoming.accounts, incoming.values);
  const registry = ensureDatasetRegistry(ws);
  const active = resolveActive(ws, registry);
  const datasets = registry.map((d) =>
    d.id === active.id ? { ...d, accounts: merged.accounts, values: merged.values } : d
  );
  return {
    accounts: merged.accounts,
    values: merged.values,
    datasets,
    activeDatasetId: active.id,
  };
}

/**
 * Keep the incoming batch as its OWN dataset and switch the working copy to
 * it. The outgoing active dataset first snapshots the current working
 * accounts/values (mirroring the dataset selector's switch behavior) so
 * mapping/classification edits made while it was active aren't lost.
 */
export function commitReplaceAsNewDataset(
  ws: ClientWorkspace,
  incoming: IncomingBatch,
  label: string
): DatasetCommitPatch {
  const activeId = activeDatasetId(ws);
  const registry = ensureDatasetRegistry(ws).map((d) =>
    d.id === activeId ? { ...d, accounts: ws.accounts, values: ws.values } : d
  );
  const newDs: Dataset = {
    id: `ds-${Date.now()}`,
    label,
    importedAt: new Date().toISOString(),
    accounts: incoming.accounts,
    values: incoming.values,
  };
  return {
    accounts: incoming.accounts,
    values: incoming.values,
    datasets: [...registry, newDs],
    activeDatasetId: newDs.id,
  };
}

/**
 * Restatement commit for authoritative re-syncs (QBO): overwrite overlapping
 * cells in the ACTIVE dataset with incoming values, add new periods and new
 * accounts, refresh account metadata (name/number/externalId) while
 * preserving the user's classifications, and leave existing accounts absent
 * from the batch untouched (a QBO report omits zero-activity accounts —
 * absence is not deletion). Pass `label` to (re)label the active dataset: a
 * first QBO sync renames "Original import" to "QuickBooks — <Company>".
 */
export function commitOverwriteMerge(
  ws: ClientWorkspace,
  incoming: IncomingBatch,
  label?: string
): DatasetCommitPatch {
  const merged = mergeOverwrite(ws.accounts, ws.values, incoming.accounts, incoming.values);
  const registry = ensureDatasetRegistry(ws);
  const active = resolveActive(ws, registry);
  const datasets = registry.map((d) =>
    d.id === active.id
      ? {
          ...d,
          accounts: merged.accounts,
          values: merged.values,
          ...(label !== undefined ? { label } : {}),
        }
      : d
  );
  return {
    accounts: merged.accounts,
    values: merged.values,
    datasets,
    activeDatasetId: active.id,
  };
}
