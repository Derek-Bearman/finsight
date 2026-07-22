'use client';

/**
 * Traditional financial-statement view (QBO-style): Profit & Loss and Balance
 * Sheet as accountant-familiar spreadsheets — accounts down, periods across,
 * with subtotals and totals. Also the home for multi-dataset selection and
 * smart re-imports: uploading data that overlaps existing periods shows the
 * delta (matched ✓ / changed / new) before anything is committed.
 */

import { useMemo, useRef, useState } from 'react';
import type { Account, AccountValue, Period } from '@/types';
import { useWorkspaceStore } from '@/store/workspace-store';
import { getProfile } from '@/lib/profiles';
import { parseImportFile } from '@/lib/data/import-pipeline';
import {
  diffImport,
  isAdditiveStatementMerge,
  datasetOptions,
  activeDatasetId,
  periodKey,
  periodLabelShort,
  mergeOverwrite,
  type ImportDiff,
} from '@/lib/data/datasets';
import {
  commitMergeNewPeriods,
  commitOverwriteMerge,
  commitReplaceAsNewDataset,
} from '@/lib/data/dataset-commit';
import { completeQboSync } from '@/lib/data/qbo-actions';
import { QboControls, type QboSyncData } from '@/components/qbo/QboControls';
import { formatCurrency } from '@/lib/utils/format';

type Granularity = 'monthly' | 'quarterly' | 'annual';

// ── Period bucketing ──────────────────────────────────────────────────────────

interface Bucket {
  key: string;
  label: string;
  /** Period keys (YYYY-MM) that fall in this bucket, chronological. */
  members: string[];
}

function bucketPeriods(values: AccountValue[], gran: Granularity): Bucket[] {
  const uniq = new Map<string, Period>();
  for (const v of values) uniq.set(periodKey(v.period), v.period);
  const periods = Array.from(uniq.values()).sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));

  if (gran === 'monthly') {
    return periods.map((p) => ({ key: periodKey(p), label: periodLabelShort(p), members: [periodKey(p)] }));
  }
  const map = new Map<string, Bucket>();
  for (const p of periods) {
    let key: string;
    let label: string;
    if (gran === 'annual') {
      key = `${p.year}`;
      label = `FY${p.year}`;
    } else {
      const q = Math.ceil(p.month / 3);
      key = `${p.year}-Q${q}`;
      label = `Q${q} ${p.year}`;
    }
    const b = map.get(key) ?? { key, label, members: [] };
    b.members.push(periodKey(p));
    map.set(key, b);
  }
  return Array.from(map.values());
}

/** Sum an account's value across the bucket's member periods (P&L flow). */
function sumInBucket(amounts: Map<string, number>, bucket: Bucket): number {
  return bucket.members.reduce((s, pk) => s + (amounts.get(pk) ?? 0), 0);
}
/** Last member period's value in the bucket (Balance Sheet snapshot). */
function snapshotInBucket(amounts: Map<string, number>, bucket: Bucket): number | null {
  for (let i = bucket.members.length - 1; i >= 0; i--) {
    const v = amounts.get(bucket.members[i]!);
    if (v !== undefined) return v;
  }
  return null;
}

function amountsByAccount(values: AccountValue[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const v of values) {
    const inner = m.get(v.accountId) ?? new Map<string, number>();
    inner.set(periodKey(v.period), (inner.get(periodKey(v.period)) ?? 0) + v.amount);
    m.set(v.accountId, inner);
  }
  return m;
}

// ── Table primitives ───────────────────────────────────────────────────────────

const STICKY_BG = 'hsl(var(--card))';
const HEADER_BG = 'hsl(var(--muted))';

function stickyStyle(bg: string, weight = 400): React.CSSProperties {
  return {
    position: 'sticky',
    left: 0,
    background: bg,
    borderRight: '1px solid hsl(var(--border))',
    zIndex: 1,
    fontWeight: weight,
    minWidth: 220,
    maxWidth: 300,
  };
}

interface Row {
  label: string;
  amounts: (number | null)[];
  total: number | null;
  kind: 'account' | 'subtotal' | 'total' | 'header' | 'spacer';
}

function StatementTable({ title, buckets, rows, totalLabel = 'Total' }: { title: string; buckets: Bucket[]; rows: Row[]; totalLabel?: string }) {
  return (
    <div className="mb-8">
      <div
        className="px-3 py-2 text-xs font-semibold uppercase tracking-wider rounded-t"
        style={{ background: HEADER_BG, color: 'hsl(var(--muted-foreground))', borderBottom: '1px solid hsl(var(--border))' }}
      >
        {title}
      </div>
      <div
        className="overflow-x-auto"
        style={{
          border: '1px solid hsl(var(--border))',
          borderTop: 'none',
          borderRadius: '0 0 0.375rem 0.375rem',
          background: 'hsl(var(--card))',
        }}
      >
        <table className="w-full border-collapse text-sm" style={{ minWidth: `${260 + buckets.length * 110 + 120}px` }}>
          <thead>
            <tr style={{ borderBottom: '1px solid hsl(var(--border))' }}>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide"
                style={{ ...stickyStyle(HEADER_BG), color: 'hsl(var(--muted-foreground))', zIndex: 2 }}>
                Account
              </th>
              {buckets.map((b) => (
                <th key={b.key} className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide whitespace-nowrap"
                  style={{ background: HEADER_BG, color: 'hsl(var(--muted-foreground))' }}>
                  {b.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide whitespace-nowrap"
                style={{ background: HEADER_BG, color: 'hsl(var(--muted-foreground))' }}>
                {totalLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              if (row.kind === 'spacer') {
                return (
                  <tr key={i}>
                    <td colSpan={buckets.length + 2} style={{ height: 8 }} />
                  </tr>
                );
              }
              const isTotal = row.kind === 'total';
              const isSub = row.kind === 'subtotal';
              const isHeader = row.kind === 'header';
              const weight = isTotal ? 700 : isSub ? 600 : 400;
              const rowBg = isTotal ? 'hsl(var(--muted) / 0.4)' : 'transparent';
              const stickyBg = isTotal
                ? 'linear-gradient(hsl(var(--muted) / 0.4), hsl(var(--muted) / 0.4)), hsl(var(--card))'
                : STICKY_BG;
              const color = isHeader ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))';
              const borderTop = isTotal || isSub ? '1px solid hsl(var(--border))' : undefined;
              return (
                <tr key={i} style={{ background: rowBg }}>
                  <td className="px-3 py-1.5"
                    style={{
                      ...stickyStyle(stickyBg, weight),
                      color,
                      paddingLeft: row.kind === 'account' ? '1.5rem' : '0.75rem',
                      textTransform: isHeader ? 'uppercase' : undefined,
                      fontSize: isHeader ? 11 : undefined,
                      letterSpacing: isHeader ? '0.05em' : undefined,
                      borderTop,
                    }}>
                    {row.label}
                  </td>
                  {row.amounts.map((a, j) => (
                    <td key={j} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap"
                      style={{ fontWeight: weight, color, borderTop }}>
                      {isHeader || a === null ? '' : formatCurrency(a)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap"
                    style={{ fontWeight: isHeader ? 400 : 700, color, borderTop }}>
                    {isHeader || row.total === null ? '' : formatCurrency(row.total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Statement builders ─────────────────────────────────────────────────────────

function buildPnLRows(accounts: Account[], values: AccountValue[], buckets: Bucket[]): Row[] {
  const byAcct = amountsByAccount(values);
  const active = accounts.filter((a) => !a.isExcluded);

  const section = (label: string, types: Account['type'][], subtotalLabel: string): { rows: Row[]; totals: number[] } => {
    const accts = active.filter((a) => types.includes(a.type));
    const rows: Row[] = [{ label, amounts: buckets.map(() => null), total: null, kind: 'header' }];
    const totals = buckets.map(() => 0);
    for (const a of accts) {
      const amts = byAcct.get(a.id) ?? new Map();
      const perBucket = buckets.map((b) => sumInBucket(amts, b));
      perBucket.forEach((v, i) => (totals[i]! += v));
      rows.push({ label: a.name, amounts: perBucket, total: perBucket.reduce((s, v) => s + v, 0), kind: 'account' });
    }
    rows.push({ label: subtotalLabel, amounts: totals.slice(), total: totals.reduce((s, v) => s + v, 0), kind: 'subtotal' });
    return { rows, totals };
  };

  const income = section('Income', ['revenue'], 'Total Income');
  const cogs = section('Cost of Goods Sold', ['cogs'], 'Total COGS');
  const grossProfit = buckets.map((_, i) => (income.totals[i] ?? 0) - (cogs.totals[i] ?? 0));
  const expenses = section('Expenses', ['expense'], 'Total Expenses');
  const netIncome = buckets.map((_, i) => (grossProfit[i] ?? 0) - (expenses.totals[i] ?? 0));

  const rows: Row[] = [...income.rows];
  if (cogs.rows.length > 1) {
    rows.push({ label: '', amounts: [], total: null, kind: 'spacer' });
    rows.push(...cogs.rows);
    rows.push({ label: 'Gross Profit', amounts: grossProfit, total: grossProfit.reduce((s, v) => s + v, 0), kind: 'total' });
  }
  rows.push({ label: '', amounts: [], total: null, kind: 'spacer' });
  rows.push(...expenses.rows);
  rows.push({ label: '', amounts: [], total: null, kind: 'spacer' });
  rows.push({ label: 'Net Income', amounts: netIncome, total: netIncome.reduce((s, v) => s + v, 0), kind: 'total' });
  return rows;
}

function buildBalanceSheetRows(accounts: Account[], values: AccountValue[], buckets: Bucket[]): Row[] {
  const byAcct = amountsByAccount(values);
  const active = accounts.filter((a) => !a.isExcluded);

  const section = (label: string, type: Account['type'], subtotalLabel: string): { rows: Row[]; totals: (number | null)[] } => {
    const accts = active.filter((a) => a.type === type);
    if (accts.length === 0) return { rows: [], totals: buckets.map(() => null) };
    const rows: Row[] = [{ label, amounts: buckets.map(() => null), total: null, kind: 'header' }];
    const totals = buckets.map(() => 0);
    for (const a of accts) {
      const amts = byAcct.get(a.id) ?? new Map();
      const perBucket = buckets.map((b) => snapshotInBucket(amts, b) ?? 0);
      perBucket.forEach((v, i) => (totals[i]! += v));
      // BS "Total" column = latest period balance, not a sum.
      rows.push({ label: a.name, amounts: perBucket, total: perBucket[perBucket.length - 1] ?? null, kind: 'account' });
    }
    rows.push({ label: subtotalLabel, amounts: totals.slice(), total: totals[totals.length - 1] ?? null, kind: 'subtotal' });
    return { rows, totals };
  };

  const assets = section('Assets', 'asset', 'Total Assets');
  const liab = section('Liabilities', 'liability', 'Total Liabilities');
  const equity = section('Equity', 'equity', 'Total Equity');

  const rows: Row[] = [...assets.rows];
  if (liab.rows.length > 0) {
    rows.push({ label: '', amounts: [], total: null, kind: 'spacer' });
    rows.push(...liab.rows);
  }
  if (equity.rows.length > 0) {
    rows.push({ label: '', amounts: [], total: null, kind: 'spacer' });
    rows.push(...equity.rows);
  }
  // Liabilities + Equity total row for the balance check.
  const lPlusE = buckets.map((_, i) => (liab.totals[i] ?? 0) + (equity.totals[i] ?? 0));
  rows.push({ label: '', amounts: [], total: null, kind: 'spacer' });
  rows.push({ label: 'Total Liabilities + Equity', amounts: lPlusE, total: lPlusE[lPlusE.length - 1] ?? null, kind: 'total' });
  return rows;
}

// ── Import panel ─────────────────────────────────────────────────────────────

interface PendingImport {
  fileName: string;
  /** File imports carry the picked type; a QBO sync is a combined P&L +
   *  Balance Sheet batch and has none. */
  statementType?: 'pnl' | 'balance_sheet';
  /** undefined ⇒ file import (legacy behavior, byte-identical);
   *  'qbo' ⇒ QuickBooks sync review with QBO-specific commit actions. */
  source?: 'file' | 'qbo';
  /** QBO company name (source === 'qbo' only). */
  companyName?: string;
  accounts: Account[];
  values: AccountValue[];
  diff: ImportDiff;
  warnings: string[];
}

function StatusBadge({ status, matchedCells }: { status: ImportDiff['status']; matchedCells: number }) {
  const map: Record<ImportDiff['status'], { text: string; color: string; bg: string }> = {
    identical: { text: '✓ Matches existing data', color: 'hsl(142 71% 30%)', bg: 'hsl(142 71% 45% / 0.1)' },
    extends: { text: '✓ Historical matches · new data to add', color: 'hsl(142 71% 30%)', bg: 'hsl(142 71% 45% / 0.1)' },
    conflicts: { text: '⚠ Some existing values differ', color: 'hsl(32 81% 29%)', bg: 'hsl(38 92% 50% / 0.12)' },
    disjoint: { text: 'New periods (no overlap with existing)', color: 'hsl(217 60% 35%)', bg: 'hsl(217 91% 55% / 0.1)' },
  };
  // 'extends' with zero compared cells (e.g. a Balance Sheet into a P&L-only
  // set) verified nothing — don't claim the history matched.
  const s = status === 'extends' && matchedCells === 0
    ? { text: 'New data to add (no overlapping accounts to compare)', color: 'hsl(217 60% 35%)', bg: 'hsl(217 91% 55% / 0.1)' }
    : map[status];
  return (
    <span className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold" style={{ color: s.color, background: s.bg }}>
      {s.text}
    </span>
  );
}

/** "2 new periods + 5 new accounts" — what an additive merge would bring in. */
function mergeAdditionsLabel(diff: ImportDiff): string {
  const parts: string[] = [];
  if (diff.newPeriods.length > 0) parts.push(`${diff.newPeriods.length} new period${diff.newPeriods.length === 1 ? '' : 's'}`);
  if (diff.newAccounts.length > 0) parts.push(`${diff.newAccounts.length} new account${diff.newAccounts.length === 1 ? '' : 's'}`);
  return parts.join(' + ');
}

// ── Main view ────────────────────────────────────────────────────────────────

export function StatementsView({
  clientId,
  embedded = false,
  qboAutoSync = false,
}: {
  clientId: string;
  embedded?: boolean;
  /** Set once by the workspace page on a ?qbo=connected landing so the sync
   *  dialog auto-opens right after the first connect. */
  qboAutoSync?: boolean;
}) {
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === clientId));
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);

  const [gran, setGran] = useState<Granularity>('monthly');
  const [importing, setImporting] = useState(false);
  const [importType, setImportType] = useState<'pnl' | 'balance_sheet'>('pnl');
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [qboConnected, setQboConnected] = useState(false);
  const [qboRefreshKey, setQboRefreshKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const buckets = useMemo(() => (workspace ? bucketPeriods(workspace.values, gran) : []), [workspace?.values, gran]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasPnL = useMemo(
    () => !!workspace && workspace.accounts.some((a) => !a.isExcluded && ['revenue', 'cogs', 'expense'].includes(a.type)),
    [workspace?.accounts]
  );
  const hasBS = useMemo(
    () => !!workspace && workspace.accounts.some((a) => !a.isExcluded && ['asset', 'liability', 'equity'].includes(a.type)),
    [workspace?.accounts]
  );

  const pnlRows = useMemo(() => (workspace && hasPnL ? buildPnLRows(workspace.accounts, workspace.values, buckets) : []), [workspace?.accounts, workspace?.values, buckets, hasPnL]); // eslint-disable-line react-hooks/exhaustive-deps
  const bsRows = useMemo(() => (workspace && hasBS ? buildBalanceSheetRows(workspace.accounts, workspace.values, buckets) : []), [workspace?.accounts, workspace?.values, buckets, hasBS]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!workspace) return null;

  const options = datasetOptions(workspace);
  const activeId = activeDatasetId(workspace);

  // An additive merge is offered when the reviewed file brings new periods or
  // new accounts AND no incoming account would attach to an existing account
  // on the other statement side — this is what lets a same-period Balance
  // Sheet merge into a P&L-only working set instead of forcing a replace.
  const canAdditiveMerge =
    !!pending &&
    (pending.diff.newPeriods.length > 0 || pending.diff.newAccounts.length > 0) &&
    isAdditiveStatementMerge(workspace.accounts, pending.accounts);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  function handleSelectDataset(id: string) {
    if (!workspace || id === activeId) return;
    const ds = workspace.datasets?.find((d) => d.id === id);
    if (!ds || !workspace.datasets) return;
    // An in-flight import review was diffed against the OUTGOING dataset —
    // committing it after the switch would merge into data the review never
    // described, so discard it (re-upload to diff against the new dataset).
    const droppedReview = pending !== null;
    setPending(null);
    setParseError(null);
    // Snapshot the current working set back into the outgoing dataset first, so
    // any mapping/operational edits made while it was active are preserved.
    const preserved = workspace.datasets.map((d) =>
      d.id === activeId ? { ...d, accounts: workspace.accounts, values: workspace.values } : d
    );
    updateWorkspace(clientId, {
      datasets: preserved,
      accounts: ds.accounts,
      values: ds.values,
      activeDatasetId: id,
    });
    showToast(droppedReview ? `Now analyzing "${ds.label}" — pending import review discarded` : `Now analyzing "${ds.label}"`);
  }

  async function handleFile(file: File) {
    if (!workspace) return;
    setBusy(true);
    setParseError(null);
    try {
      const profile = getProfile(workspace.industryProfileId);
      const res = await parseImportFile(file, importType, profile);
      const hardError = res.warnings.find((w) => w.severity === 'error');
      if (hardError || res.accounts.length === 0) {
        setParseError(hardError?.message ?? 'No accounts could be read from this file.');
        setBusy(false);
        return;
      }
      const diff = diffImport(workspace.accounts, workspace.values, res.accounts, res.values);
      setPending({
        fileName: file.name,
        statementType: importType,
        accounts: res.accounts,
        values: res.values,
        diff,
        warnings: res.warnings.filter((w) => w.severity !== 'error').map((w) => w.message),
      });
    } catch {
      setParseError('Could not read this file. Supported: .csv, .xlsx, .xls exported from QuickBooks, Xero, or similar.');
    }
    setBusy(false);
  }

  // The dataset bookkeeping (registry snapshot, merge, active-dataset update)
  // lives in lib/data/dataset-commit — shared with the QBO sync flow. These
  // handlers only wire the pure patch to the store and drive the UI/toasts.

  /** Fire-and-forget after ANY QBO commit: stamps last_synced_at server-side,
   *  then bumps the chip so "Synced just now" shows. Never throws. */
  function stampQboSyncComplete() {
    void completeQboSync(clientId)
      .catch(() => undefined)
      .then(() => setQboRefreshKey((k) => k + 1));
  }

  /** Sync dialog finished — diff the combined batch against the working set
   *  and hand it to the SAME review surface the file import uses. */
  function handleQboData(r: QboSyncData) {
    if (!workspace) return;
    setImporting(false);
    setParseError(null);
    const diff = diffImport(workspace.accounts, workspace.values, r.accounts, r.values);
    setPending({
      fileName: `QuickBooks — ${r.companyName}`,
      source: 'qbo',
      companyName: r.companyName,
      accounts: r.accounts,
      values: r.values,
      diff,
      warnings: r.warnings,
    });
  }

  /** 'identical' verdict: nothing to commit — record the sync and close. */
  function handleQboUpToDate() {
    setPending(null);
    stampQboSyncComplete();
  }

  /** 'conflicts' primary action: restatement-capable overwrite merge into the
   *  active dataset (changed cells + new periods + new accounts), preserving
   *  user classifications. The commit patch carries no counts, so the same
   *  pure mergeOverwrite runs once more on identical inputs purely to report
   *  honestly what the commit did. */
  function handleApplyQboUpdates() {
    if (!workspace || !pending || pending.source !== 'qbo') return;
    const incoming = { accounts: pending.accounts, values: pending.values };
    const counts = mergeOverwrite(
      workspace.accounts,
      workspace.values,
      incoming.accounts,
      incoming.values
    );
    const patch = commitOverwriteMerge(workspace, incoming, pending.fileName);
    updateWorkspace(clientId, patch);
    setPending(null);
    stampQboSyncComplete();
    const cells = `${counts.changedCells} cell${counts.changedCells === 1 ? '' : 's'}`;
    const periods = `${counts.addedPeriods} period${counts.addedPeriods === 1 ? '' : 's'}`;
    const accts = `${counts.addedAccounts} account${counts.addedAccounts === 1 ? '' : 's'}`;
    showToast(`Updated ${cells} · added ${periods} · ${accts}`);
  }

  function handleMergeNewPeriods() {
    if (!workspace || !pending) return;
    const wasQbo = pending.source === 'qbo';
    const patch = commitMergeNewPeriods(workspace, { accounts: pending.accounts, values: pending.values });
    updateWorkspace(clientId, patch);
    setPending(null);
    setImporting(false);
    if (wasQbo) stampQboSyncComplete();
    // Report what the merge actually added (not the reviewed diff's counts),
    // so the toast can never overstate the commit.
    const activeLabel = patch.datasets.find((d) => d.id === patch.activeDatasetId)!.label;
    const periodsBefore = new Set(workspace.values.map((v) => periodKey(v.period)));
    const periodsAdded = new Set(
      patch.values.filter((v) => !periodsBefore.has(periodKey(v.period))).map((v) => periodKey(v.period))
    ).size;
    const accountsAdded = patch.accounts.length - workspace.accounts.length;
    const parts: string[] = [];
    if (periodsAdded > 0) parts.push(`${periodsAdded} new period${periodsAdded === 1 ? '' : 's'}`);
    if (accountsAdded > 0) parts.push(`${accountsAdded} new account${accountsAdded === 1 ? '' : 's'}`);
    showToast(parts.length > 0 ? `Added ${parts.join(' + ')} to "${activeLabel}"` : `Nothing new to add to "${activeLabel}"`);
  }

  function handleReplaceAsNewDataset() {
    if (!workspace || !pending) return;
    const wasQbo = pending.source === 'qbo';
    // QBO batches combine P&L + BS, so the dataset is labeled by source
    // company ("QuickBooks — <Company>"), not by statement type.
    const label = wasQbo
      ? pending.fileName
      : `${pending.statementType === 'pnl' ? 'P&L' : 'Balance Sheet'} · ${pending.fileName}`;
    const patch = commitReplaceAsNewDataset(
      workspace,
      { accounts: pending.accounts, values: pending.values },
      label
    );
    updateWorkspace(clientId, patch);
    setPending(null);
    setImporting(false);
    if (wasQbo) stampQboSyncComplete();
    showToast(`Imported "${label}" as a new dataset`);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Dataset selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>Dataset</label>
            <select
              value={activeId}
              onChange={(e) => handleSelectDataset(e.target.value)}
              disabled={options.length <= 1}
              className="rounded-md border px-2 py-1 text-sm disabled:opacity-60"
              style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }}
              data-testid="dataset-selector"
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
          {/* Granularity */}
          <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'hsl(var(--muted))' }}>
            {(['monthly', 'quarterly', 'annual'] as Granularity[]).map((g) => (
              <button key={g} onClick={() => setGran(g)}
                className="px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors"
                style={{
                  background: gran === g ? 'hsl(var(--primary))' : 'transparent',
                  color: gran === g ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                }}>
                {g}
              </button>
            ))}
          </div>
        </div>
        <QboControls
          clientId={clientId}
          onSyncData={handleQboData}
          autoOpenSync={qboAutoSync}
          refreshKey={qboRefreshKey}
          onStatusChange={(s) => setQboConnected(s.connected)}
        />
        <button
          onClick={() => { setImporting((v) => !v); setPending(null); setParseError(null); }}
          className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          style={{ borderColor: 'hsl(var(--primary))', color: 'hsl(var(--primary))' }}
          data-testid="statements-import-btn"
        >
          {importing ? 'Close import' : '↑ Import data'}
        </button>
      </div>

      {/* Import panel — file upload flow, or the review of a completed QBO sync */}
      {(importing || pending?.source === 'qbo') && (
        <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ borderColor: 'hsl(var(--primary) / 0.4)', background: 'hsl(var(--card))' }}>
          {pending?.source === 'qbo' ? (
            /* QBO review header — combined P&L + BS batch, no statement-type label */
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                QuickBooks — {pending.companyName}
              </span>
              <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Combined P&amp;L + Balance Sheet · nothing saves until you choose below
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>Import a statement</span>
                <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'hsl(var(--muted))' }}>
                  {([['pnl', 'P&L'], ['balance_sheet', 'Balance Sheet']] as const).map(([t, l]) => (
                    <button key={t} onClick={() => setImportType(t)}
                      className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
                      style={{
                        background: importType === t ? 'hsl(var(--primary))' : 'transparent',
                        color: importType === t ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                      }}>
                      {l}
                    </button>
                  ))}
                </div>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.xlsm" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }} />
                <button onClick={() => fileRef.current?.click()} disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                  style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
                  {busy ? 'Reading…' : 'Choose file'}
                </button>
              </div>
              <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Upload a QuickBooks-style {importType === 'pnl' ? 'Profit &amp; Loss' : 'Balance Sheet'} by month. FinSight compares it to the
                current dataset and shows you exactly what matches and what&apos;s new before saving.
              </p>
            </>
          )}

          {parseError && (
            <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'hsl(0 72% 51% / 0.4)', background: 'hsl(0 72% 51% / 0.06)', color: 'hsl(0 72% 41%)' }}>
              {parseError}
            </div>
          )}

          {/* Delta review */}
          {pending && (
            <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: 'hsl(var(--border))' }}>
              <div className="flex items-center gap-3 flex-wrap">
                <StatusBadge status={pending.diff.status} matchedCells={pending.diff.matchedCells} />
                {pending.source !== 'qbo' && (
                  <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{pending.fileName}</span>
                )}
              </div>

              {pending.source === 'qbo' && pending.warnings.length > 0 && (
                <details className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  <summary className="cursor-pointer select-none">
                    {pending.warnings.length} sync note{pending.warnings.length === 1 ? '' : 's'} from QuickBooks
                  </summary>
                  <ul className="mt-1 list-disc pl-4 max-h-32 overflow-y-auto">
                    {pending.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Matched cells</p>
                  <p className="font-semibold" style={{ color: 'hsl(142 71% 35%)' }}>{pending.diff.matchedCells} ✓</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Changed cells</p>
                  <p className="font-semibold" style={{ color: pending.diff.changedCells.length ? 'hsl(0 72% 45%)' : 'hsl(var(--foreground))' }}>
                    {pending.diff.changedCells.length}
                  </p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>New periods</p>
                  <p className="font-semibold" style={{ color: 'hsl(var(--foreground))' }}>{pending.diff.newPeriods.length}</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>New accounts</p>
                  <p className="font-semibold" style={{ color: 'hsl(var(--foreground))' }}>{pending.diff.newAccounts.length}</p>
                </div>
              </div>

              {pending.diff.newPeriods.length > 0 && (
                <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  New periods to add: <span style={{ color: 'hsl(var(--foreground))' }}>{pending.diff.newPeriods.map(periodLabelShort).join(', ')}</span>
                </p>
              )}

              {pending.diff.changedCells.length > 0 && (
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'hsl(38 92% 50% / 0.4)' }}>
                  <div className="px-3 py-1.5 text-xs font-semibold" style={{ background: 'hsl(38 92% 50% / 0.1)', color: 'hsl(32 81% 29%)' }}>
                    Existing values that differ in the new file
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ color: 'hsl(var(--muted-foreground))' }}>
                          <th className="text-left px-3 py-1 font-medium">Account</th>
                          <th className="text-left px-3 py-1 font-medium">Period</th>
                          <th className="text-right px-3 py-1 font-medium">Current</th>
                          <th className="text-right px-3 py-1 font-medium">New</th>
                          <th className="text-right px-3 py-1 font-medium">Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pending.diff.changedCells.slice(0, 100).map((c, i) => (
                          <tr key={i} style={{ borderTop: '1px solid hsl(var(--border))' }}>
                            <td className="px-3 py-1" style={{ color: 'hsl(var(--foreground))' }}>{c.accountName}</td>
                            <td className="px-3 py-1" style={{ color: 'hsl(var(--muted-foreground))' }}>{periodLabelShort(c.period)}</td>
                            <td className="px-3 py-1 text-right tabular-nums" style={{ color: 'hsl(var(--muted-foreground))' }}>{formatCurrency(c.oldValue)}</td>
                            <td className="px-3 py-1 text-right tabular-nums" style={{ color: 'hsl(var(--foreground))' }}>{formatCurrency(c.newValue)}</td>
                            <td className="px-3 py-1 text-right tabular-nums" style={{ color: c.delta >= 0 ? 'hsl(142 71% 35%)' : 'hsl(0 72% 45%)' }}>
                              {c.delta >= 0 ? '+' : ''}{formatCurrency(c.delta)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {pending.diff.changedCells.length > 100 && (
                    <p className="px-3 py-1 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                      + {pending.diff.changedCells.length - 100} more changed cells
                    </p>
                  )}
                </div>
              )}

              {/* Actions */}
              {pending.source === 'qbo' ? (
                /* QBO review actions — branch on the diff verdict. Every
                 * commit path also stamps last_synced_at via completeQboSync. */
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  {pending.diff.status === 'identical' ? (
                    <>
                      <span className="text-xs font-medium" style={{ color: 'hsl(142 71% 35%)' }}>
                        Already up to date
                      </span>
                      <button onClick={handleQboUpToDate} data-testid="qbo-review-close-btn"
                        className="rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors hover:bg-muted"
                        style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
                        Close
                      </button>
                    </>
                  ) : (
                    <>
                      {pending.diff.status === 'conflicts' && (
                        <button onClick={handleApplyQboUpdates} data-testid="qbo-apply-updates-btn"
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer"
                          style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
                          Apply QuickBooks updates
                        </button>
                      )}
                      {canAdditiveMerge && (
                        <button onClick={handleMergeNewPeriods} data-testid="import-merge-btn"
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer"
                          style={
                            pending.diff.status === 'conflicts'
                              ? { background: 'transparent', border: '1px solid hsl(142 71% 40% / 0.5)', color: 'hsl(142 71% 30%)' }
                              : { background: 'hsl(142 71% 40%)', color: '#fff' }
                          }>
                          {pending.diff.status === 'conflicts'
                            ? `Add ${mergeAdditionsLabel(pending.diff)} only (keep existing values)`
                            : `Add ${mergeAdditionsLabel(pending.diff)} to current data`}
                        </button>
                      )}
                      <button onClick={handleReplaceAsNewDataset} data-testid="import-replace-btn"
                        className="rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors hover:bg-muted"
                        style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
                        Import as new dataset
                      </button>
                      <button onClick={() => setPending(null)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer"
                        style={{ color: 'hsl(var(--muted-foreground))' }}>
                        Discard
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  {canAdditiveMerge && pending.diff.changedCells.length === 0 && (
                    <button onClick={handleMergeNewPeriods} data-testid="import-merge-btn"
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                      style={{ background: 'hsl(142 71% 40%)', color: '#fff' }}>
                      Add {mergeAdditionsLabel(pending.diff)} to current data
                    </button>
                  )}
                  {canAdditiveMerge && pending.diff.changedCells.length > 0 && (
                    <button onClick={handleMergeNewPeriods}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                      style={{ background: 'hsl(142 71% 40%)', color: '#fff' }}>
                      Add {mergeAdditionsLabel(pending.diff)} only (keep existing values)
                    </button>
                  )}
                  <button onClick={handleReplaceAsNewDataset} data-testid="import-replace-btn"
                    className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                    style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
                    Import as a new dataset
                  </button>
                  <button onClick={() => setPending(null)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium"
                    style={{ color: 'hsl(var(--muted-foreground))' }}>
                    Discard
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Statements */}
      {!hasPnL && !hasBS ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'hsl(var(--border))' }}>
          <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
            No financial data yet — import a P&amp;L or balance sheet to see the statements.
          </p>
          {qboConnected && workspace.accounts.length === 0 && (
            <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
              …or use <span style={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}>Sync</span> from
              QuickBooks in the toolbar above to pull the books in directly.
            </p>
          )}
        </div>
      ) : (
        <>
          {hasPnL && <StatementTable title={`Profit & Loss${embedded ? '' : ' — ' + workspace.name}`} buckets={buckets} rows={pnlRows} />}
          {hasBS && <StatementTable title="Balance Sheet" buckets={buckets} rows={bsRows} totalLabel="Ending" />}
        </>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg border px-5 py-3 shadow-lg text-sm font-medium"
          style={{ background: 'hsl(var(--card))', borderColor: 'hsl(142 76% 36% / 0.5)', color: 'hsl(142 76% 28%)' }}
          role="status" aria-live="polite">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
