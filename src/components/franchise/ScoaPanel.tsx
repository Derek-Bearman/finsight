'use client';

/**
 * Corporate SCOA panel (FRANCHISE_BENCHMARKS_PLAN.md §F4) — mounted per
 * franchise row inside FranchiseManager (canManage only), same expand pattern
 * as BenchmarkSetPanel. One standard chart of accounts per franchise, stored
 * in config.scoa; uploading again replaces it wholesale.
 *
 * Upload is CSV-only (number,name required; type, statement, parent optional;
 * statement accepts pnl/p&l/balance/bs). Rows with problems are listed with
 * their row numbers and skipped; duplicate account numbers are rejected
 * client-side because saveScoaAction hard-rejects them server-side too.
 *
 * Every successful mutation invalidates the module-level franchise cache so
 * open workspaces recompose against the new (or removed) SCOA.
 */

import { useState, useTransition, type ChangeEvent } from 'react';
import Papa from 'papaparse';
import type { FranchiseScoaAccount } from '@/types';
import type { Franchise } from '@/lib/data/franchises';
import { saveScoaAction, clearScoaAction } from '@/lib/data/franchise-actions';
import { invalidateFranchiseCache } from '@/lib/franchise/useEffectiveTargets';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type FranchiseWithLinks = Franchise & { linkedCount: number };

const PREVIEW_ROWS = 8;

// ─────────────────────────────────────────────
// CSV template + parsing
// ─────────────────────────────────────────────

function buildScoaTemplateCsv(): string {
  const lines = [
    '# FinSight corporate SCOA template',
    '# Columns: number,name,type,statement,parent',
    '# number and name are required; account numbers must be unique.',
    '# type is a free-text classification hint (e.g. Income, Expense, Asset).',
    '# statement marks the statement side: pnl or balance (p&l and bs also work).',
    '# parent is the account number of the parent account, for sub-accounts.',
    '# Lines starting with # and blank lines are skipped. Replace the example rows below with the corporate chart of accounts.',
    'number,name,type,statement,parent',
    '1000,Cash and Equivalents,Asset,balance,',
    '1200,Accounts Receivable,Asset,balance,',
    '2000,Accounts Payable,Liability,balance,',
    '4000,Sales Revenue,Income,pnl,',
    '5000,Cost of Goods Sold,COGS,pnl,',
    '5100,Freight In,COGS,pnl,5000',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** pnl/p&l → pnl, balance/bs → balance, anything else → null. */
function normalizeStatement(raw: string): 'pnl' | 'balance' | null {
  const v = raw.toLowerCase();
  if (v === 'pnl' || v === 'p&l') return 'pnl';
  if (v === 'balance' || v === 'bs') return 'balance';
  return null;
}

function sideLabel(statementType?: 'pnl' | 'balance'): string {
  if (statementType === 'pnl') return 'P&L';
  if (statementType === 'balance') return 'Balance';
  return '';
}

interface ScoaParseOutcome {
  accounts: FranchiseScoaAccount[];
  errors: string[];
}

function parseScoaCsv(text: string): ScoaParseOutcome {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    comments: '#',
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const errors: string[] = [];
  for (const err of parsed.errors) {
    errors.push(`Row ${typeof err.row === 'number' ? err.row + 2 : '?'}: ${err.message}`);
  }
  const fields = parsed.meta.fields ?? [];
  if (!fields.includes('number') || !fields.includes('name')) {
    return {
      accounts: [],
      errors: ['The header row must include number and name (type, statement, and parent are optional).'],
    };
  }
  const firstLineByNumber = new Map<string, number>();
  const accounts: FranchiseScoaAccount[] = [];
  parsed.data.forEach((row, i) => {
    // Data-row index + header row, 1-based. Comment/blank lines are not
    // counted by PapaParse, so this is approximate when they are interleaved.
    const line = i + 2;
    const number = (row.number ?? '').trim();
    const name = (row.name ?? '').trim();
    const type = (row.type ?? '').trim();
    const rawStatement = (row.statement ?? '').trim();
    const parent = (row.parent ?? '').trim();
    if (!number && !name && !type && !rawStatement && !parent) return; // effectively blank
    if (!number) {
      errors.push(`Row ${line}: missing account number.`);
      return;
    }
    if (!name) {
      errors.push(`Row ${line} (${number}): missing account name.`);
      return;
    }
    const firstLine = firstLineByNumber.get(number);
    if (firstLine !== undefined) {
      errors.push(
        `Row ${line}: duplicate account number "${number}" (already used on row ${firstLine}). This row is skipped.`
      );
      return;
    }
    let statementType: 'pnl' | 'balance' | undefined;
    if (rawStatement) {
      const normalized = normalizeStatement(rawStatement);
      if (!normalized) {
        errors.push(
          `Row ${line} (${number}): statement "${rawStatement}" must be pnl or balance (p&l and bs also work). This row is skipped.`
        );
        return;
      }
      statementType = normalized;
    }
    firstLineByNumber.set(number, line);
    accounts.push({
      number,
      name,
      ...(type ? { type } : {}),
      ...(statementType ? { statementType } : {}),
      ...(parent ? { parentNumber: parent } : {}),
    });
  });
  return { accounts, errors };
}

// ─────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────

export function ScoaPanel({
  franchise,
  onUpdated,
}: {
  franchise: FranchiseWithLinks;
  /** Receives the updated franchise (with linkedCount) after any mutation. */
  onUpdated: (franchise: FranchiseWithLinks) => void;
}) {
  const scoa = franchise.config.scoa ?? null;

  // Upload flow — always shown when no SCOA exists; behind "Replace SCOA" otherwise.
  const [replacing, setReplacing] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvAccounts, setCsvAccounts] = useState<FranchiseScoaAccount[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);

  const [removeOpen, setRemoveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const showUpload = !scoa || replacing;

  function resetUploadState() {
    setCsvFileName(null);
    setCsvAccounts([]);
    setCsvErrors([]);
  }

  function startReplace() {
    setError(null);
    resetUploadState();
    setReplacing(true);
  }

  function cancelReplace() {
    setError(null);
    resetUploadState();
    setReplacing(false);
  }

  function downloadTemplate() {
    const blob = new Blob([buildScoaTemplateCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'corporate-scoa-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    setError(null);
    try {
      const text = await file.text();
      const outcome = parseScoaCsv(text);
      setCsvAccounts(outcome.accounts);
      setCsvErrors(outcome.errors);
    } catch {
      setCsvAccounts([]);
      setCsvErrors(['Could not read that file. Save it as a plain .csv and try again.']);
    }
    // Allow re-selecting the same file after a fix.
    e.target.value = '';
  }

  function handleSave() {
    setError(null);
    if (csvAccounts.length === 0) {
      return setError('Upload a CSV with at least one valid account row first.');
    }
    startTransition(async () => {
      const res = await saveScoaAction({ franchiseId: franchise.id, accounts: csvAccounts });
      if (!res.ok) return setError(res.error);
      invalidateFranchiseCache();
      onUpdated(res.data);
      resetUploadState();
      setReplacing(false);
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const res = await clearScoaAction({ franchiseId: franchise.id });
      setRemoveOpen(false);
      if (!res.ok) return setError(res.error);
      invalidateFranchiseCache();
      onUpdated(res.data);
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3" data-testid="scoa-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">Corporate SCOA</h4>
          <p className="text-xs text-muted-foreground">
            The standard chart of accounts shared by every linked client. Powers COA audits and
            account-aligned comparison.
          </p>
        </div>
        {scoa && !replacing && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={startReplace}
              disabled={pending}
              data-testid="scoa-replace"
            >
              Replace SCOA
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setRemoveOpen(true)}
              disabled={pending}
              data-testid="scoa-remove"
            >
              Remove
            </Button>
          </div>
        )}
      </div>

      {scoa ? (
        <div className="space-y-2">
          <p className="text-sm" data-testid="scoa-summary">
            {scoa.accounts.length} account{scoa.accounts.length === 1 ? '' : 's'}
            {' · uploaded '}
            {new Date(scoa.uploadedAt).toLocaleDateString()}
            {scoa.uploadedBy ? ` by ${scoa.uploadedBy}` : ''}
          </p>
          <div className="overflow-x-auto rounded-md border border-border bg-background">
            <table className="w-full text-left text-xs" data-testid="scoa-preview-table">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Number</th>
                  <th className="px-2 py-1.5 font-medium">Name</th>
                  <th className="px-2 py-1.5 font-medium">Side</th>
                </tr>
              </thead>
              <tbody>
                {scoa.accounts.slice(0, PREVIEW_ROWS).map((a) => (
                  <tr key={a.number} className="border-b border-border last:border-b-0" data-testid="scoa-preview-row">
                    <td className="px-2 py-1.5 font-mono">{a.number}</td>
                    <td className="px-2 py-1.5">{a.name}</td>
                    <td className="px-2 py-1.5">{sideLabel(a.statementType)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {scoa.accounts.length > PREVIEW_ROWS && (
            <p className="text-xs text-muted-foreground">
              Showing the first {PREVIEW_ROWS} of {scoa.accounts.length} accounts.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="scoa-empty">
          No corporate SCOA yet. Upload the corporate chart of accounts to enable COA audits and
          account-aligned comparison for linked clients.
        </p>
      )}

      {showUpload && (
        <div className="space-y-2 rounded-md border border-border bg-background p-3" data-testid="scoa-upload-form">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="text-sm"
              aria-label="SCOA CSV file"
              data-testid="scoa-csv-input"
            />
            <Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="scoa-template-download">
              Download template
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Columns: number, name, type, statement (pnl or balance), parent. Only number and name
            are required. Lines starting with # are skipped.
            {scoa ? ' Saving replaces the current SCOA wholesale.' : ''}
          </p>
          {csvFileName && (
            <p className="text-sm" data-testid="scoa-csv-summary">
              {csvAccounts.length} account{csvAccounts.length === 1 ? '' : 's'} parsed from {csvFileName}
              {csvErrors.length > 0 ? ` · ${csvErrors.length} problem${csvErrors.length === 1 ? '' : 's'}` : ''}
            </p>
          )}
          {csvErrors.length > 0 && (
            <ul
              className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-destructive"
              data-testid="scoa-csv-errors"
            >
              {csvErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={pending} data-testid="scoa-save">
              {pending ? 'Saving…' : scoa ? 'Save replacement SCOA' : 'Save SCOA'}
            </Button>
            {scoa && (
              <Button variant="outline" onClick={cancelReplace} disabled={pending} data-testid="scoa-cancel">
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert" data-testid="scoa-error">
          {error}
        </p>
      )}

      {/* Remove confirmation — house dialog, destructive action */}
      <Dialog open={removeOpen} onOpenChange={(open) => !open && setRemoveOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove the corporate SCOA?</DialogTitle>
            <DialogDescription>
              This permanently removes the {scoa?.accounts.length ?? 0}-account standard chart of
              accounts from <strong>{franchise.name}</strong>. Client account mappings to SCOA
              numbers are kept, but COA audits and account-aligned comparison stop working until a
              new SCOA is uploaded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)} data-testid="scoa-remove-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={handleRemove}
              data-testid="scoa-remove-confirm"
            >
              {pending ? 'Removing…' : 'Remove SCOA'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
