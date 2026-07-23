'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TourOverlay, useTour, HelpButton, HOME_TOUR_STEPS } from '@/components/tutorial';
import { ALL_PROFILES, PROFILE_MAP } from '@/lib/profiles';
import { useWorkspaceStore, isPrivacyMode, setPrivacyMode } from '@/store/workspace-store';
import { FileDropzone } from '@/components/upload/FileDropzone';
import { ColumnMappingPreview } from '@/components/upload/ColumnMappingPreview';
import { ClassificationReview } from '@/components/upload/ClassificationReview';
import { ImportValidationBanner } from '@/components/upload/ImportValidationBanner';
import { ManualEntryForm } from '@/components/upload/ManualEntryForm';
import { Button } from '@/components/ui/button';
import { ProfileIcon } from '@/components/ui/profile-icon';
import type { Account, AccountType, AccountValue, ClientWorkspace, Period, ImportValidationWarning } from '@/types';
import type { ColumnMapping, ParsedRow } from '@/lib/parsers/csv-parser';
import type { ClassificationResult } from '@/lib/classifiers';
import { parseCSV } from '@/lib/parsers/csv-parser';
import { xlsxToCsvDetailed, isExcelFile, isExcelMimeType } from '@/lib/parsers/xlsx-converter';
import { classifyAll } from '@/lib/classifiers';
import { buildDefaultScenarios } from '@/lib/scenarios';
import { validateImport } from '@/lib/parsers/import-validator';
import { parseWorkspaceJSON } from '@/lib/utils/workspace-io';
import { useFirmContext } from '@/components/app/firm-context';
import { canOfferQboConnect } from '@/lib/qbo/entry-gate';
import { AppNav } from '@/components/app/AppNav';
import { BillingBanner } from '@/components/billing/BillingBanner';
import { saveNewWorkspace, removeWorkspace } from '@/lib/data/workspace-actions';
import { noteCreated, noteDeleted } from '@/lib/data/cloud-sync';

// ── Auto-exclude summary line names ─────────────────────────────────────────

/**
 * Account names that are subtotals/summaries rather than individual GL lines.
 * QBO and other systems sometimes export these as data rows — including them
 * in calculations would double-count figures.
 */
const AUTO_EXCLUDE_NAMES = new Set([
  'net income',
  'net profit',
  'net loss',
  'gross profit',
  'gross margin',
  'operating income',
  'operating profit',
  'total income',
  'total revenue',
  'total expenses',
  'total cost of goods sold',
  'net operating income',
  'net other income',
  'net revenue',
  // Balance Sheet check rows — modeler artifacts, always zero
  'balance check',
  'balance check (ta - tle)',
  'balance check (ta-tle)',
  'check (ta - tle)',
  'audit check',
  'tie-out',
  'tie out',
]);

// ── Wizard steps ────────────────────────────────────────────────────────────

type Step = 'profile' | 'pnl' | 'balance_sheet' | 'classify' | 'done';

const STEPS: Step[] = ['profile', 'pnl', 'balance_sheet', 'classify', 'done'];
const STEP_LABELS: Record<Step, string> = {
  profile: 'Profile',
  pnl: 'P&L Upload',
  balance_sheet: 'Balance Sheet',
  classify: 'Classify',
  done: 'Done',
};

// ── Upload sub-state ─────────────────────────────────────────────────────────

interface UploadState {
  file: File | null;
  isLoading: boolean;
  headers: string[];
  mapping: ColumnMapping | null;
  rows: ParsedRow[];
  accounts: Account[];
  values: AccountValue[];
  warnings: ImportValidationWarning[];
  phase: 'idle' | 'mapping' | 'done';
}

const EMPTY_UPLOAD: UploadState = {
  file: null,
  isLoading: false,
  headers: [],
  mapping: null,
  rows: [],
  accounts: [],
  values: [],
  warnings: [],
  phase: 'idle',
};

// ── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const currentIdx = STEPS.indexOf(current);
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, idx) => {
        const isComplete = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center gap-1">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors"
                style={{
                  background: isComplete || isCurrent ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
                  color: isComplete || isCurrent ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                }}
              >
                {isComplete ? '✓' : idx + 1}
              </div>
              <span
                className="text-xs whitespace-nowrap hidden sm:block"
                style={{ color: isCurrent ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}
              >
                {STEP_LABELS[step]}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className="h-0.5 w-10 sm:w-16 mx-1 sm:mx-2 mb-5"
                style={{ background: idx < currentIdx ? 'hsl(var(--primary))' : 'hsl(var(--border))' }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Profile card ─────────────────────────────────────────────────────────────

function ProfileCard({
  profile,
  selected,
  onSelect,
}: {
  profile: (typeof ALL_PROFILES)[0];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`profile-card-${profile.id}`}
      className="text-left rounded-xl border-2 p-4 transition-colors cursor-pointer hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        borderColor: selected ? 'hsl(var(--primary))' : 'hsl(var(--border))',
        background: selected ? 'hsl(var(--accent))' : 'hsl(var(--card))',
      }}
    >
      <div className="mb-2" style={{ color: 'hsl(var(--foreground))' }}>
        <ProfileIcon profileId={profile.id} size={24} />
      </div>
      <div className="font-semibold text-sm" style={{ color: 'hsl(var(--foreground))' }}>
        {profile.name}
      </div>
      <div className="text-xs mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
        {profile.description}
      </div>
    </button>
  );
}

// ── Workspace card ───────────────────────────────────────────────────────────

function WorkspaceCard({
  workspace,
  onClick,
  onDelete,
}: {
  workspace: ClientWorkspace;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const profile = ALL_PROFILES.find((p) => p.id === workspace.industryProfileId);
  return (
    <div
      className="relative group rounded-xl border transition-colors"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
    >
      <button
        type="button"
        onClick={onClick}
        data-testid={`workspace-card-${workspace.id}`}
        className="text-left w-full p-4 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      >
        <div className="flex items-center gap-2 mb-1" style={{ color: 'hsl(var(--foreground))' }}>
          <ProfileIcon profileId={profile?.id} size={18} />
          <span className="font-semibold text-sm">
            {workspace.name}
          </span>
        </div>
        <div className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {profile?.name} · {workspace.accounts.length} accounts
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {new Date(workspace.createdAt).toLocaleDateString()}
        </div>
      </button>
      {/* Delete button — visible on hover */}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete workspace"
        data-testid={`delete-workspace-${workspace.id}`}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-md w-6 h-6 flex items-center justify-center text-xs"
        style={{ background: 'hsl(var(--destructive) / 0.1)', color: 'hsl(var(--destructive))' }}
      >
        ✕
      </button>
    </div>
  );
}

// ── Upload step ──────────────────────────────────────────────────────────────

interface UploadStepProps {
  title: string;
  subtitle: string;
  state: UploadState;
  profileId: string;
  onFile: (file: File) => void;
  onMappingConfirm: (mapping: ColumnMapping) => void;
  onMappingCancel: () => void;
  onShowManual: () => void;
  showManual: boolean;
  /** Optional extra alternative rendered beside the manual-entry toggle
   *  (e.g. the P&L step's "Connect QuickBooks instead" link). */
  secondaryAction?: React.ReactNode;
  /** Called when the manual-entry form adds an account — must persist it into this step's upload state */
  onManualAdd: (account: Account, values: AccountValue[]) => void;
  /** Called when the user clicks "Done" in the manual-entry form — collapse the panel */
  onManualDone: () => void;
  /** Called when user clicks "Continue" from the done state */
  onContinue?: () => void;
  /** Called when user clicks "Replace file" from the done state */
  onReplace?: () => void;
}

function UploadStep({
  title,
  subtitle,
  state,
  profileId,
  onFile,
  onMappingConfirm,
  onMappingCancel,
  onShowManual,
  showManual,
  secondaryAction,
  onManualAdd,
  onManualDone,
  onContinue,
  onReplace,
}: UploadStepProps) {
  if (state.phase === 'mapping' && state.mapping) {
    return (
      <ColumnMappingPreview
        headers={state.headers}
        mapping={state.mapping}
        rows={state.rows}
        onConfirm={onMappingConfirm}
        onCancel={onMappingCancel}
      />
    );
  }

  if (state.phase === 'done') {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full text-2xl"
          style={{ background: 'hsl(142 76% 36% / 0.15)' }}
        >
          <span style={{ color: 'hsl(142 76% 36%)' }}>✓</span>
        </div>
        <div>
          <p className="font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
            <span style={{ color: 'hsl(142 76% 36%)' }}>✓</span>{' '}
            {state.file?.name} — {state.accounts.length} accounts imported
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
            File mapping confirmed. Ready to continue.
          </p>
        </div>
        {state.warnings.length > 0 && (
          <ImportValidationBanner warnings={state.warnings} />
        )}
        <div className="flex gap-3 mt-1">
          {onReplace && (
            <Button
              variant="outline"
              size="sm"
              onClick={onReplace}
              data-testid="replace-file"
            >
              Replace file
            </Button>
          )}
          {onContinue && (
            <Button onClick={onContinue} data-testid="upload-continue">
              Continue →
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-semibold text-base" style={{ color: 'hsl(var(--foreground))' }}>
          {title}
        </h3>
        <p className="text-sm mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {subtitle}
        </p>
      </div>

      <FileDropzone
        onFile={onFile}
        isLoading={state.isLoading}
        label="Drop CSV or Excel file here or click to browse"
        sublabel="Export from QuickBooks, Xero, or any accounting system"
      />

      <div className="flex flex-wrap items-center justify-start gap-x-5 gap-y-2">
        <button
          type="button"
          onClick={onShowManual}
          data-testid="show-manual-entry"
          className="text-sm underline underline-offset-2"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          {showManual ? 'Hide manual entry' : 'Enter accounts manually instead'}
        </button>
        {secondaryAction}
      </div>

      {showManual && (
        <div
          className="rounded-xl border p-5"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <ManualEntryForm
            profileId={profileId}
            existingAccounts={state.accounts}
            onAdd={onManualAdd}
            onDone={onManualDone}
          />
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts ParsedRow values (keyed by "YYYY-MM") into AccountValue[] for a given account ID.
 */
function buildAccountValues(accountId: string, row: ParsedRow): AccountValue[] {
  return Object.entries(row.values).map(([key, amount]) => {
    const [yearStr, monthStr] = key.split('-');
    return {
      accountId,
      period: {
        year: parseInt(yearStr ?? '2024', 10),
        month: parseInt(monthStr ?? '1', 10),
      },
      amount,
    };
  });
}

interface ClassifierInput {
  id: string;
  name: string;
  number?: string;
  /** Parser-detected section (asset/liability/equity/revenue/cogs/expense). */
  section?: AccountType;
}

/**
 * Converts ParseResult rows + mapping into Account[] and AccountValue[].
 * Also returns classifierInputs[] — the same accounts annotated with the
 * `section` info from the parser, used by the section-aware classifier.
 */
function buildAccountsFromParseResult(
  rows: ParsedRow[],
  _mapping: ColumnMapping
): {
  accounts: Account[];
  values: AccountValue[];
  classifierInputs: ClassifierInput[];
} {
  const accounts: Account[] = [];
  const values: AccountValue[] = [];
  const classifierInputs: ClassifierInput[] = [];

  for (const row of rows) {
    if (!row.accountName) continue;
    const id = `imported-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const account: Account = {
      id,
      name: row.accountName,
      number: row.accountNumber,
      type: 'expense', // will be overwritten by classifier
      isManuallyClassified: false,
    };
    // Persist parser-detected section so the classifier can be re-run on
    // existing workspaces AND the mapping UI can warn about contradictions.
    if (row.section !== undefined) {
      account.detectedSection = row.section as AccountType;
    }
    accounts.push(account);
    values.push(...buildAccountValues(id, row));

    const ci: ClassifierInput = { id, name: row.accountName };
    if (row.accountNumber !== undefined) ci.number = row.accountNumber;
    if (row.section !== undefined) ci.section = row.section as AccountType;
    classifierInputs.push(ci);
  }

  return { accounts, values, classifierInputs };
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const { workspaces, addWorkspace, setActiveWorkspace, deleteWorkspace } = useWorkspaceStore();
  const firm = useFirmContext();
  const readOnly = firm?.readOnly ?? false;
  // Whether to SHOW the wizard's "Connect QuickBooks instead" link — mirrors
  // the server gates (owner/admin, non-demo firm, billing 'full') purely for
  // visibility; /api/qbo/connect re-checks everything server-side.
  const canConnectQbo = canOfferQboConnect(firm);
  // Home tour auto-opens for brand-new users (own storage key — completing it
  // must not suppress the workspace tour, which keeps the legacy key).
  const tourHook = useTour({ storageKey: 'finsight-tour-home-seen' });

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>('profile');
  const [selectedProfileId, setSelectedProfileId] = useState(ALL_PROFILES[0]?.id ?? 'generic-smb');
  const [clientName, setClientName] = useState('');
  const [clientNameError, setClientNameError] = useState('');

  const [pnlUpload, setPnlUpload] = useState<UploadState>(EMPTY_UPLOAD);
  const [bsUpload, setBsUpload] = useState<UploadState>(EMPTY_UPLOAD);
  const [showPnlManual, setShowPnlManual] = useState(false);
  const [showBsManual, setShowBsManual] = useState(false);

  const [mergedAccounts, setMergedAccounts] = useState<Account[]>([]);
  const [mergedValues, setMergedValues] = useState<AccountValue[]>([]);
  const [classificationResults, setClassificationResults] = useState<Map<string, ClassificationResult>>(new Map());

  const [newWorkspaceId, setNewWorkspaceId] = useState('');

  // ── Privacy mode (don't save to this browser) ──────────────────────────────
  // Local mirror so the header button re-renders on toggle. The source of
  // truth lives in the storage adapter (module flag); we just re-read it
  // here and keep our React state in sync.
  const [privacyOn, setPrivacyOn] = useState(false);
  useEffect(() => {
    setPrivacyOn(isPrivacyMode());
  }, []);

  const togglePrivacyMode = () => {
    const turningOn = !privacyOn;
    if (turningOn) {
      const ok = window.confirm(
        'Privacy mode wipes all workspaces from this browser immediately and stops new data from being saved here.\n\n' +
        'Anything in memory stays usable for this session, but closing the tab or refreshing will lose everything.\n\n' +
        'This is meant for shared / public computers and one-off demos.\n\n' +
        'Continue?'
      );
      if (!ok) return;
    }
    setPrivacyMode(turningOn);
    setPrivacyOn(turningOn);
  };

  // ── Workspace JSON import (from another machine / backup) ───────────────────

  const workspaceImportRef = React.useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState<
    | { kind: 'success'; text: string }
    | { kind: 'error'; text: string }
    | null
  >(null);

  const handleWorkspaceImport = async (file: File) => {
    setImportMessage(null);
    if (readOnly) {
      setImportMessage({ kind: 'error', text: 'Your workspace is read-only right now — resolve billing to import.' });
      return;
    }
    try {
      const text = await file.text();
      const result = parseWorkspaceJSON(text);
      if (!result.ok) {
        setImportMessage({ kind: 'error', text: result.error });
        return;
      }
      // Persist to Postgres; the DB assigns the authoritative uuid, so no local
      // id-collision handling is needed anymore.
      const res = await saveNewWorkspace(result.workspace);
      if (!res.ok) {
        setImportMessage({ kind: 'error', text: res.error });
        return;
      }
      const stored = res.data;
      addWorkspace(stored);
      noteCreated(stored);
      setActiveWorkspace(stored.id);
      const warnSuffix =
        result.warnings.length > 0 ? ` (${result.warnings.length} note${result.warnings.length === 1 ? '' : 's'})` : '';
      setImportMessage({ kind: 'success', text: `Imported "${stored.name}"${warnSuffix}.` });
      // Navigate after a short delay so the user sees the confirmation
      setTimeout(() => router.push(`/workspace/${stored.id}`), 600);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error reading file.';
      setImportMessage({ kind: 'error', text: `Could not read file: ${msg}` });
    }
  };

  // ── Cloud-backed workspace delete ───────────────────────────────────────────
  const handleDeleteWorkspace = async (ws: ClientWorkspace) => {
    if (readOnly) {
      window.alert('Your workspace is read-only right now — resolve billing to delete.');
      return;
    }
    if (!window.confirm(`Delete "${ws.name}"? This cannot be undone.`)) return;
    const res = await removeWorkspace(ws.id);
    if (!res.ok) {
      window.alert(res.error);
      return;
    }
    noteDeleted(ws.id);
    deleteWorkspace(ws.id);
  };

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFile = async (
    file: File,
    setUpload: React.Dispatch<React.SetStateAction<UploadState>>,
    statementType: 'pnl' | 'balance_sheet'
  ) => {
    setUpload({ ...EMPTY_UPLOAD, file, isLoading: true, phase: 'idle' });
    try {
      // Support Excel files by converting to CSV first.
      // Multi-sheet workbooks: pick the sheet matching this upload type.
      let text: string;
      const xlsxNotices: ImportValidationWarning[] = [];
      if (isExcelFile(file.name) || isExcelMimeType(file.type)) {
        const buffer = await file.arrayBuffer();
        const conversion = xlsxToCsvDetailed(buffer, statementType);
        text = conversion.csv;
        if (conversion.pickedNonFirst && conversion.sheetName) {
          xlsxNotices.push({
            type: 'xlsx_sheet_picked',
            severity: 'info',
            message:
              `Workbook has ${conversion.allSheets.length} sheets ` +
              `(${conversion.allSheets.join(', ')}). ` +
              `Imported from the "${conversion.sheetName}" sheet — best match for ${statementType === 'pnl' ? 'P&L' : 'Balance Sheet'}.`,
          });
        }
      } else {
        text = await file.text();
      }
      const result = parseCSV(text);

      // Warn if no period columns were detected — the file is likely in a
      // transposed or unsupported format.
      if (result.columnMapping.periodColumns.length === 0) {
        setUpload({
          ...EMPTY_UPLOAD,
          file,
          isLoading: false,
          phase: 'idle',
          warnings: [
            ...xlsxNotices,
            {
              type: 'no_period_columns',
              severity: 'error',
              message:
                'No date columns detected in this file. FinSight expects a standard QuickBooks P&L export ' +
                'where months (Jan 2024, Feb 2024…) are columns and accounts are rows. ' +
                'Try exporting a “Profit and Loss by Month” report from QuickBooks, or check that your ' +
                'file is not in a transposed (pivot) format.',
            },
          ],
        });
        return;
      }

      // Warn if rows parsed but every value is $0 — likely a template file
      // or misaligned columns where values landed in fields that weren't
      // detected as periods.
      const totalAbsValue = result.rows.reduce((sum, row) => {
        for (const v of Object.values(row.values)) sum += Math.abs(v);
        return sum;
      }, 0);
      const isAllZero = result.rows.length > 0 && totalAbsValue === 0;

      setUpload({
        file,
        isLoading: false,
        headers: result.rawHeaders,
        mapping: result.columnMapping,
        rows: result.rows,
        accounts: [],
        values: [],
        warnings: [
          ...xlsxNotices,
          ...(isAllZero
            ? [{
                type: 'all_zero_values' as const,
                severity: 'warning' as const,
                message:
                  `Parsed ${result.rows.length} accounts from "${file.name}" but every value is $0. ` +
                  `Check the data preview — values may be in a column that wasn't detected as a period. ` +
                  `Use the Role dropdown to mark the correct column as "Period".`,
              }]
            : []),
        ],
        phase: 'mapping',
      });
    } catch {
      setUpload({
        ...EMPTY_UPLOAD,
        file,
        isLoading: false,
        phase: 'idle',
        warnings: [{
          type: 'parse_error',
          severity: 'error',
          message:
            `Could not read "${file.name}". The file may be corrupted or in an unsupported format. ` +
            `Supported formats: .csv, .xlsx, .xls, .xlsm exported from QuickBooks, Xero, or similar.`,
        }],
      });
    }
  };

  const processMappingConfirm = (
    mapping: ColumnMapping,
    statementType: 'pnl' | 'balance_sheet',
    file: File | null,
    rows: ParsedRow[],
    setUpload: React.Dispatch<React.SetStateAction<UploadState>>
  ) => {
    try {
      const profile = PROFILE_MAP[selectedProfileId];
      if (!profile) return;

      // Build accounts and values from parsed rows
      const { accounts: rawAccounts, values, classifierInputs } = buildAccountsFromParseResult(rows, mapping);

      // Classify accounts using the profile — pass statementType so the
      // classifier constrains output to that statement's account types
      // (revenue/cogs/expense for P&L, asset/liability/equity for BS) and
      // uses parser-detected section context to override keyword matches.
      const classifyResults = classifyAll(classifierInputs, profile, statementType);

      // Apply classification to accounts
      const classifiedAccounts: Account[] = rawAccounts.map((a) => {
        const cr = classifyResults.get(a.id);
        const base = !cr ? a : {
          ...a,
          type: cr.accountType ?? a.type,
          costBehavior: cr.costBehavior ?? undefined,
          classificationSource: cr.source,
          classificationConfidence: cr.confidence,
          classificationHintFired: cr.hintFired,
          isManuallyClassified: false,
        };
        // Auto-exclude summary/subtotal lines that would double-count in calculations
        const normalizedName = base.name.toLowerCase().trim();
        return AUTO_EXCLUDE_NAMES.has(normalizedName)
          ? { ...base, isExcluded: true }
          : base;
      });

      // Validate
      const importWarnings = validateImport(
        classifiedAccounts,
        values,
        statementType === 'pnl' ? 'pnl' : 'balance_sheet'
      );

      setUpload((prev) => ({
        ...prev,
        mapping,
        accounts: classifiedAccounts,
        values,
        warnings: importWarnings,
        phase: 'done',
      }));

      // Merge classification results into global map
      setClassificationResults((prev) => {
        const next = new Map(prev);
        for (const [accountId, cr] of classifyResults.entries()) {
          next.set(accountId, cr);
        }
        return next;
      });
    } catch {
      // Silently recover; user can retry
    }
  };

  // ── Manual entry ───────────────────────────────────────────────────────────

  /**
   * Appends a manually entered account (and its period values) into the given
   * step's upload state so it flows into the workspace exactly like an upload.
   * Manual accounts arrive pre-classified (isManuallyClassified: true), so the
   * classify step passes them through untouched.
   */
  const handleManualAdd = (
    setUpload: React.Dispatch<React.SetStateAction<UploadState>>,
    account: Account,
    values: AccountValue[]
  ) => {
    setUpload((prev) => ({
      ...prev,
      accounts: [...prev.accounts, account],
      values: [...prev.values, ...values],
    }));
  };

  // ── Step transitions ───────────────────────────────────────────────────────

  const goToStep = (s: Step) => setStep(s);

  const handleProfileNext = () => {
    if (!clientName.trim()) {
      setClientNameError('Client name is required');
      return;
    }
    setClientNameError('');
    goToStep('pnl');
  };

  const handlePnlMappingConfirm = (mapping: ColumnMapping) => {
    processMappingConfirm(mapping, 'pnl', pnlUpload.file, pnlUpload.rows, setPnlUpload);
  };

  const handleBsMappingConfirm = (mapping: ColumnMapping) => {
    processMappingConfirm(mapping, 'balance_sheet', bsUpload.file, bsUpload.rows, setBsUpload);
  };

  const handlePnlNext = () => {
    setMergedAccounts(pnlUpload.accounts);
    setMergedValues(pnlUpload.values);
    goToStep('balance_sheet');
  };

  const handleBsNext = () => {
    const existingIds = new Set(mergedAccounts.map((a) => a.id));
    const newAccounts = bsUpload.accounts.filter((a) => !existingIds.has(a.id));
    setMergedAccounts((prev) => [...prev, ...newAccounts]);
    setMergedValues((prev) => [...prev, ...bsUpload.values]);
    goToStep('classify');
  };

  /**
   * Build + persist a new workspace from the wizard state. Shared by the
   * classify-step confirm and the P&L-step "Connect QuickBooks instead" path
   * (which skips the remaining steps and creates the workspace immediately).
   * Returns the stored workspace (DB-assigned uuid) or null after surfacing
   * the failure via createError.
   */
  const createWorkspaceFromWizard = async (
    accounts: Account[],
    values: AccountValue[]
  ): Promise<ClientWorkspace | null> => {
    setCreateError(null);
    if (readOnly) {
      setCreateError('Your workspace is read-only right now — resolve billing to create clients.');
      return null;
    }
    const wsId = `ws-${Date.now()}`;
    const now = new Date().toISOString();
    // Seed the canonical default scenarios (real +15%/−20% adjustments) from
    // the earliest imported period — or the current month for an empty workspace.
    // Matches how the What-If views seed defaults for scenario-less workspaces.
    const appliesFrom: Period = (() => {
      if (values.length === 0) {
        const today = new Date();
        return { year: today.getFullYear(), month: today.getMonth() + 1 };
      }
      const sorted = [...values].sort(
        (a, b) => a.period.year * 12 + a.period.month - (b.period.year * 12 + b.period.month)
      );
      return sorted[0]!.period;
    })();
    const workspace: ClientWorkspace = {
      id: wsId,
      name: clientName.trim(),
      industryProfileId: selectedProfileId,
      accounts,
      values,
      fiscalYearStart: 1,
      scenarios: buildDefaultScenarios(appliesFrom),
      operationalData: [],
      customMetrics: [],
      auditLog: [],
      createdAt: now,
      updatedAt: now,
    };
    setCreating(true);
    const res = await saveNewWorkspace(workspace);
    if (!res.ok) {
      setCreating(false);
      setCreateError(res.error);
      return null;
    }
    // `creating` deliberately stays true on success: both callers leave this
    // screen (goToStep('done') / router.push), but the navigation isn't
    // instant — re-enabling the buttons here opened a window where a second
    // click during the route transition created a duplicate workspace. The
    // done step's "Create another workspace" reset clears it.
    const stored = res.data; // DB-assigned uuid id
    addWorkspace(stored);
    noteCreated(stored);
    setActiveWorkspace(stored.id);
    return stored;
  };

  const handleClassifyConfirm = async (finalAccounts: Account[]) => {
    if (creating) return; // guard against double-submit
    const stored = await createWorkspaceFromWizard(finalAccounts, mergedValues);
    if (!stored) return;
    setNewWorkspaceId(stored.id);
    goToStep('done');
  };

  /**
   * "Connect QuickBooks instead" on the P&L step: finish creating the
   * workspace now (including any accounts already entered manually on this
   * step — usually none) and land on it with ?qbo=start, which hands off to
   * /api/qbo/connect for the new workspace. The link is only SHOWN to
   * eligible callers (canOfferQboConnect); the connect route re-checks every
   * gate server-side and bounces ineligible callers back with ?qbo_error.
   */
  const handleQboConnectInstead = async () => {
    if (creating) return; // guard against double-submit
    const stored = await createWorkspaceFromWizard(pnlUpload.accounts, pnlUpload.values);
    if (!stored) return;
    router.push(`/workspace/${stored.id}?qbo=start`);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--background))' }}>
      {tourHook.isOpen && (
        <TourOverlay
          steps={HOME_TOUR_STEPS}
          onComplete={tourHook.completeTour}
          onSkip={tourHook.skipTour}
          startAtStep={tourHook.startStep}
          tourLabel="Home tour"
        />
      )}
      {/* Header */}
      <header
        className="sticky top-0 z-10 border-b px-6 py-3 flex flex-wrap items-center justify-between gap-y-2"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--background))' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight" style={{ color: 'hsl(var(--foreground))' }}>
            FinSight
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-xs font-medium"
            style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
          >
            Beta
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AppNav />
          {/* Privacy mode toggle — wipes localStorage and stops new writes. */}
          <button
            type="button"
            onClick={togglePrivacyMode}
            data-testid="privacy-mode-toggle"
            aria-pressed={privacyOn}
            title={
              privacyOn
                ? 'Privacy mode is ON — nothing is being saved to this browser. Click to turn off.'
                : 'Click to enter privacy mode — wipes local data and stops new writes. Use on shared computers.'
            }
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
            style={{
              borderColor: privacyOn ? 'hsl(0 72% 51%)' : 'hsl(var(--border))',
              // ON state: solid red fill + white text so it's unmistakeable.
              // OFF state: subtle, low-contrast so it doesn't compete for attention.
              background: privacyOn ? 'hsl(0 72% 51%)' : 'hsl(var(--background))',
              color: privacyOn ? '#fff' : 'hsl(var(--muted-foreground))',
            }}
          >
            <span aria-hidden>{privacyOn ? '🔒' : '🔓'}</span>
            <span>{privacyOn ? 'PRIVACY ON' : 'Privacy mode'}</span>
            {privacyOn && (
              <span
                className="ml-1 rounded-sm px-1 py-0.5 text-[9px] font-bold leading-none"
                style={{ background: 'rgba(255,255,255,0.25)', color: '#fff' }}
                aria-hidden
              >
                LIVE
              </span>
            )}
          </button>
          <HelpButton onOpen={() => tourHook.openTour(0)} />
          {/* Sign out — POST to /auth/signout so the proxy can clear the cookie
              and bounce back to /login. POST (not GET) so a malicious <img>
              tag can't trigger it. */}
          <form action="/auth/signout" method="post" style={{ display: 'inline' }}>
            <button
              type="submit"
              className="text-xs font-medium transition-colors rounded-md border px-2.5 py-1 hover:bg-muted"
              style={{
                borderColor: 'hsl(var(--border))',
                color: 'hsl(var(--muted-foreground))',
                background: 'hsl(var(--background))',
              }}
              title="Sign out of FinSight"
            >
              Sign out
            </button>
          </form>
          {process.env.NODE_ENV === 'development' && (
            <Link
              href="/dev"
              className="text-sm font-medium transition-colors"
              style={{ color: 'hsl(var(--muted-foreground))' }}
            >
              Dev Inspector →
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        {firm?.access.banner && (
          <div className="mb-6">
            <BillingBanner decision={firm.access} onManageBilling={() => router.push('/billing')} />
          </div>
        )}
        {/* Step indicator */}
        <div className="mb-10 flex justify-center">
          <StepIndicator current={step} />
        </div>

        {/* ── STEP 1: Profile ── */}
        {step === 'profile' && (
          <div className="flex flex-col gap-8">
            {/* Recent workspaces — shown FIRST when present so returning users
                see their clients before the new-workspace form. */}
            {workspaces.length > 0 && (
              <div>
                <div className="flex items-end justify-between mb-4">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'hsl(var(--foreground))' }}>
                      Your Workspaces
                    </h1>
                    <p className="mt-1 text-sm flex items-center gap-1.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                      <span aria-hidden>☁️</span>
                      <span className="font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                        {firm ? `Synced to ${firm.firmName}` : 'Synced to your firm'}
                      </span>
                      <span>· available on every device</span>
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const el = document.getElementById('new-workspace-wizard');
                      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    data-testid="new-workspace-jump"
                  >
                    + New Workspace
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {workspaces
                    .slice(-6)
                    .reverse()
                    .map((ws) => (
                      <WorkspaceCard
                        key={ws.id}
                        workspace={ws}
                        onClick={() => router.push(`/workspace/${ws.id}`)}
                        onDelete={(e) => {
                          e.stopPropagation();
                          void handleDeleteWorkspace(ws);
                        }}
                      />
                    ))}
                </div>
                <div className="my-8 border-t" style={{ borderColor: 'hsl(var(--border))' }} />
              </div>
            )}

            <div className="text-center" id="new-workspace-wizard">
              <h1
                className={
                  workspaces.length > 0
                    ? 'text-lg font-semibold tracking-tight'
                    : 'text-2xl font-bold tracking-tight'
                }
                style={{ color: 'hsl(var(--foreground))' }}
              >
                {workspaces.length > 0 ? 'Add another client' : 'New Client Workspace'}
              </h1>
              <p className="mt-1 text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Choose an industry profile and enter the client name to get started.
              </p>
            </div>

            {/* Client name */}
            <div>
              <label
                htmlFor="client-name"
                className="block text-sm font-medium mb-1"
                style={{ color: 'hsl(var(--foreground))' }}
              >
                Client Name <span className="text-red-500">*</span>
              </label>
              <input
                id="client-name"
                type="text"
                value={clientName}
                onChange={(e) => {
                  setClientName(e.target.value);
                  setClientNameError('');
                }}
                placeholder="e.g. Acme Plumbing LLC"
                data-testid="client-name-input"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
                style={{
                  borderColor: clientNameError ? 'hsl(var(--destructive))' : 'hsl(var(--border))',
                  background: 'hsl(var(--background))',
                  color: 'hsl(var(--foreground))',
                }}
              />
              {clientNameError && (
                <p className="mt-1 text-xs text-red-600">{clientNameError}</p>
              )}
            </div>

            {/* Profile cards */}
            <div>
              <p className="text-sm font-medium mb-3" style={{ color: 'hsl(var(--foreground))' }}>
                Industry Profile
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-tour="profile-grid">
                {ALL_PROFILES.map((p) => (
                  <ProfileCard
                    key={p.id}
                    profile={p}
                    selected={selectedProfileId === p.id}
                    onSelect={() => setSelectedProfileId(p.id)}
                  />
                ))}
              </div>
            </div>

            <Button onClick={handleProfileNext} data-testid="profile-next" className="self-end">
              Continue →
            </Button>

            {/* Workspace JSON import — restore from a .finsight.json file */}
            <div
              className="rounded-xl border border-dashed px-4 py-3 flex flex-wrap items-center justify-between gap-3"
              style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted) / 0.3)' }}
            >
              <div>
                <p className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                  Have a workspace from another machine?
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Import a <code className="font-mono text-[11px]">.finsight.json</code> file you exported from another browser or backup.
                </p>
              </div>
              <input
                ref={workspaceImportRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                data-testid="workspace-import-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleWorkspaceImport(file);
                  // Reset so re-selecting the same file works
                  if (e.target) e.target.value = '';
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => workspaceImportRef.current?.click()}
                data-testid="import-workspace-btn"
              >
                ↑ Import workspace
              </Button>
            </div>

            {importMessage && (
              <div
                role="status"
                aria-live="polite"
                data-testid="workspace-import-message"
                className="rounded-lg border px-4 py-3 text-sm"
                style={{
                  borderColor: importMessage.kind === 'success' ? 'hsl(142 76% 36%)' : 'hsl(0 84% 60%)',
                  background: importMessage.kind === 'success' ? 'hsl(142 76% 36% / 0.08)' : 'hsl(0 84% 60% / 0.08)',
                  color: importMessage.kind === 'success' ? 'hsl(142 76% 28%)' : 'hsl(0 84% 32%)',
                }}
              >
                {importMessage.text}
              </div>
            )}

          </div>
        )}

        {/* ── STEP 2: P&L Upload ── */}
        {step === 'pnl' && (
          <div className="flex flex-col gap-6">
            <div className="text-center">
              <h2 className="text-xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
                Upload Profit &amp; Loss <span style={{ color: 'hsl(var(--muted-foreground))' }} className="font-normal text-base">(Optional)</span>
              </h2>
              <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Import a P&amp;L (CSV or Excel) — the wizard auto-detects column headers. You can skip this and add data later by clicking Continue with no file.
              </p>
            </div>

            {pnlUpload.warnings.length > 0 && (
              <ImportValidationBanner warnings={pnlUpload.warnings} />
            )}

            {/* Surfaces a failed workspace create from the QBO path (the
                classify step renders its own copy of this banner). */}
            {createError && (
              <div
                role="alert"
                className="rounded-lg border px-4 py-3 text-sm"
                style={{ borderColor: 'hsl(0 84% 60%)', background: 'hsl(0 84% 60% / 0.08)', color: 'hsl(0 84% 32%)' }}
              >
                {createError}
              </div>
            )}

            <UploadStep
              title="P&L file"
              subtitle="Upload a P&L report — CSV or Excel (.xlsx) both work. Exports from QuickBooks, Xero, and most accounting platforms are supported."
              state={pnlUpload}
              profileId={selectedProfileId}
              onFile={(f) => handleFile(f, setPnlUpload, 'pnl')}
              onMappingConfirm={handlePnlMappingConfirm}
              onMappingCancel={() => setPnlUpload(EMPTY_UPLOAD)}
              onShowManual={() => setShowPnlManual((v) => !v)}
              showManual={showPnlManual}
              secondaryAction={
                canConnectQbo ? (
                  <button
                    type="button"
                    onClick={() => void handleQboConnectInstead()}
                    disabled={creating}
                    data-testid="wizard-qbo-connect"
                    className="text-sm font-medium underline underline-offset-2 disabled:opacity-60 disabled:no-underline"
                    style={{ color: 'hsl(var(--primary))' }}
                    title="Create this workspace now and connect it to a QuickBooks Online company — no file needed"
                  >
                    {creating ? 'Creating workspace…' : 'Connect QuickBooks instead'}
                  </button>
                ) : undefined
              }
              onManualAdd={(account, values) => handleManualAdd(setPnlUpload, account, values)}
              onManualDone={() => setShowPnlManual(false)}
              onContinue={handlePnlNext}
              onReplace={() => setPnlUpload(EMPTY_UPLOAD)}
            />

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => goToStep('profile')} data-testid="back-to-profile">
                ← Back
              </Button>
              {(pnlUpload.phase === 'done' || pnlUpload.phase === 'idle') && (
                <Button onClick={handlePnlNext} data-testid="pnl-next">
                  Continue →
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 3: Balance Sheet Upload ── */}
        {step === 'balance_sheet' && (
          <div className="flex flex-col gap-6">
            <div className="text-center">
              <h2 className="text-xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
                Upload Balance Sheet <span style={{ color: 'hsl(var(--muted-foreground))' }} className="font-normal text-base">(Optional)</span>
              </h2>
              <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Adding a balance sheet enables ratio analysis and BS-level metrics. Click Continue with no file to skip.
              </p>
            </div>

            {bsUpload.warnings.length > 0 && (
              <ImportValidationBanner warnings={bsUpload.warnings} />
            )}

            <UploadStep
              title="Balance Sheet file"
              subtitle="Upload a balance sheet export (CSV or Excel). Assets, liabilities, and equity accounts will be detected automatically."
              state={bsUpload}
              profileId={selectedProfileId}
              onFile={(f) => handleFile(f, setBsUpload, 'balance_sheet')}
              onMappingConfirm={handleBsMappingConfirm}
              onMappingCancel={() => setBsUpload(EMPTY_UPLOAD)}
              onShowManual={() => setShowBsManual((v) => !v)}
              showManual={showBsManual}
              onManualAdd={(account, values) => handleManualAdd(setBsUpload, account, values)}
              onManualDone={() => setShowBsManual(false)}
              onContinue={handleBsNext}
              onReplace={() => setBsUpload(EMPTY_UPLOAD)}
            />

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => goToStep('pnl')} data-testid="back-to-pnl">
                ← Back
              </Button>
              {(bsUpload.phase === 'done' || bsUpload.phase === 'idle') && (
                <Button onClick={handleBsNext} data-testid="bs-next">
                  Continue →
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 4: Classification Review ── */}
        {step === 'classify' && (
          <div className="flex flex-col gap-6">
            <div className="text-center">
              <h2 className="text-xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
                Review Classification
              </h2>
              <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Review auto-classified accounts. Override types or cost behaviors as needed.
              </p>
            </div>

{/* Derive the statement type for classification filtering.
               If only P&L was uploaded → restrict to P&L types.
               If only BS was uploaded → restrict to BS types.
               If both → show all (undefined). */}
            {createError && (
              <div
                role="alert"
                className="rounded-lg border px-4 py-3 text-sm"
                style={{ borderColor: 'hsl(0 84% 60%)', background: 'hsl(0 84% 60% / 0.08)', color: 'hsl(0 84% 32%)' }}
              >
                {createError}
              </div>
            )}
            {mergedAccounts.length === 0 ? (
              <div className="text-center py-8">
                <p style={{ color: 'hsl(var(--muted-foreground))' }} className="text-sm">
                  No accounts imported. You can create an empty workspace and add data later.
                </p>
                <div className="flex gap-3 justify-center mt-4">
                  <Button variant="outline" onClick={() => goToStep('pnl')} disabled={creating}>
                    Go back and upload
                  </Button>
                  <Button onClick={() => handleClassifyConfirm([])} disabled={creating}>
                    {creating ? 'Creating…' : 'Create empty workspace'}
                  </Button>
                </div>
              </div>
            ) : (
              <ClassificationReview
                accounts={mergedAccounts}
                classificationResults={classificationResults}
                profileId={selectedProfileId}
                onConfirm={handleClassifyConfirm}
                onBack={() => goToStep('balance_sheet')}
                statementType={
                  pnlUpload.phase === 'done' && bsUpload.phase !== 'done'
                    ? 'pnl'
                    : bsUpload.phase === 'done' && pnlUpload.phase !== 'done'
                    ? 'balance_sheet'
                    : undefined
                }
              />
            )}
          </div>
        )}

        {/* ── STEP 5: Done ── */}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-6 py-8 text-center">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full text-3xl"
              style={{ background: 'hsl(var(--accent))' }}
            >
              🎉
            </div>
            <div>
              <h2 className="text-2xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
                Workspace Created!
              </h2>
              <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
                <strong>{clientName}</strong> is ready for analysis.
              </p>
            </div>

            <div
              className="rounded-xl border w-full max-w-sm p-5 text-left"
              style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
            >
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt style={{ color: 'hsl(var(--muted-foreground))' }}>Client</dt>
                  <dd className="font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                    {clientName}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt style={{ color: 'hsl(var(--muted-foreground))' }}>Profile</dt>
                  <dd style={{ color: 'hsl(var(--foreground))' }}>
                    {ALL_PROFILES.find((p) => p.id === selectedProfileId)?.name}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt style={{ color: 'hsl(var(--muted-foreground))' }}>Accounts</dt>
                  <dd style={{ color: 'hsl(var(--foreground))' }}>{mergedAccounts.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt style={{ color: 'hsl(var(--muted-foreground))' }}>Scenarios</dt>
                  <dd style={{ color: 'hsl(var(--foreground))' }}>3 (Base, Best, Worst)</dd>
                </div>
              </dl>
            </div>

            <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {mergedAccounts.length > 0
                ? 'Mapping complete. Your workspace is ready for analysis.'
                : 'Workspace created without data — import a P&L or balance sheet anytime to start analyzing.'}
            </p>

            <Button
              onClick={() => router.push(`/workspace/${newWorkspaceId}`)}
              data-testid="open-workspace"
              size="lg"
            >
              Open Workspace →
            </Button>

            <button
              type="button"
              onClick={() => {
                setStep('profile');
                setClientName('');
                setPnlUpload(EMPTY_UPLOAD);
                setBsUpload(EMPTY_UPLOAD);
                setMergedAccounts([]);
                setMergedValues([]);
                setClassificationResults(new Map());
                setNewWorkspaceId('');
                setCreating(false); // stays true after a successful create (double-submit guard)
              }}
              className="text-sm underline underline-offset-2"
              style={{ color: 'hsl(var(--muted-foreground))' }}
              data-testid="create-another"
            >
              Create another workspace
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
