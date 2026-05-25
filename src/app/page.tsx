'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TourOverlay, useTour, HelpButton, HOME_TOUR_STEPS } from '@/components/tutorial';
import { ALL_PROFILES, PROFILE_MAP } from '@/lib/profiles';
import { useWorkspaceStore } from '@/store/workspace-store';
import { FileDropzone } from '@/components/upload/FileDropzone';
import { ColumnMappingPreview } from '@/components/upload/ColumnMappingPreview';
import { ClassificationReview } from '@/components/upload/ClassificationReview';
import { ImportValidationBanner } from '@/components/upload/ImportValidationBanner';
import { ManualEntryForm } from '@/components/upload/ManualEntryForm';
import { Button } from '@/components/ui/button';
import type { Account, AccountType, AccountValue, ClientWorkspace, Scenario, ImportValidationWarning } from '@/types';
import type { ColumnMapping, ParsedRow } from '@/lib/parsers/csv-parser';
import type { ClassificationResult } from '@/lib/classifiers';
import { parseCSV } from '@/lib/parsers/csv-parser';
import { xlsxToCsvDetailed, isExcelFile, isExcelMimeType } from '@/lib/parsers/xlsx-converter';
import { classifyAll } from '@/lib/classifiers';
import { validateImport } from '@/lib/parsers/import-validator';

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
]);

// ── Wizard steps ────────────────────────────────────────────────────────────

type Step = 'profile' | 'pnl' | 'balance_sheet' | 'classify' | 'done';

const STEPS: Step[] = ['profile', 'pnl', 'balance_sheet', 'classify', 'done'];
const STEP_LABELS: Record<Step, string> = {
  profile: 'Profile',
  pnl: 'P&L Upload',
  balance_sheet: 'Balance Sheet',
  classify: 'Classification',
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

// ── Default scenarios ────────────────────────────────────────────────────────

function buildDefaultScenarios(): Scenario[] {
  const now = new Date().toISOString();
  return [
    {
      id: `sc-base-${Date.now()}`,
      name: 'Base Case',
      description: 'No adjustments — actuals as imported',
      adjustments: [],
      createdAt: now,
      isBaseline: true,
    },
    {
      id: `sc-best-${Date.now() + 1}`,
      name: 'Best Case',
      description: '+15% revenue, −5% costs',
      adjustments: [],
      createdAt: now,
    },
    {
      id: `sc-worst-${Date.now() + 2}`,
      name: 'Worst Case',
      description: '−20% revenue, +10% costs',
      adjustments: [],
      createdAt: now,
    },
  ];
}

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
      className="text-left rounded-xl border-2 p-4 transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        borderColor: selected ? 'hsl(var(--primary))' : 'hsl(var(--border))',
        background: selected ? 'hsl(var(--accent))' : 'hsl(var(--card))',
      }}
    >
      <div className="text-2xl mb-2">{profile.icon ?? '🏢'}</div>
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
        className="text-left w-full p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">{profile?.icon ?? '🏢'}</span>
          <span className="font-semibold text-sm" style={{ color: 'hsl(var(--foreground))' }}>
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
  onSkip: () => void;
  onShowManual: () => void;
  showManual: boolean;
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
  onSkip,
  onShowManual,
  showManual,
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
        label="Drop CSV file here or click to browse"
        sublabel="Export from QuickBooks, Xero, or any accounting system"
      />

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onShowManual}
          data-testid="show-manual-entry"
          className="text-sm underline underline-offset-2"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          {showManual ? 'Hide manual entry' : 'Enter accounts manually instead'}
        </button>
        <button
          type="button"
          onClick={onSkip}
          data-testid="skip-upload"
          className="text-sm underline underline-offset-2"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          Skip for now →
        </button>
      </div>

      {showManual && (
        <div
          className="rounded-xl border p-5"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <ManualEntryForm
            profileId={profileId}
            existingAccounts={[]}
            onAdd={() => {}}
            onDone={() => {}}
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
  const tourHook = useTour();

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

  const handleClassifyConfirm = (finalAccounts: Account[]) => {
    const wsId = `ws-${Date.now()}`;
    const now = new Date().toISOString();
    const workspace: ClientWorkspace = {
      id: wsId,
      name: clientName.trim(),
      industryProfileId: selectedProfileId,
      accounts: finalAccounts,
      values: mergedValues,
      fiscalYearStart: 1,
      scenarios: buildDefaultScenarios(),
      operationalData: [],
      customMetrics: [],
      auditLog: [],
      createdAt: now,
      updatedAt: now,
    };
    addWorkspace(workspace);
    setActiveWorkspace(wsId);
    setNewWorkspaceId(wsId);
    goToStep('done');
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
        />
      )}
      {/* Header */}
      <header
        className="sticky top-0 z-10 border-b px-6 py-3 flex items-center justify-between"
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
        <div className="flex items-center gap-3">
          <HelpButton onOpen={() => tourHook.openTour(0)} />
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
        {/* Step indicator */}
        <div className="mb-10 flex justify-center">
          <StepIndicator current={step} />
        </div>

        {/* ── STEP 1: Profile ── */}
        {step === 'profile' && (
          <div className="flex flex-col gap-8">
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'hsl(var(--foreground))' }}>
                New Client Workspace
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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

            {/* Recent workspaces */}
            {workspaces.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p
                    className="text-xs font-medium uppercase tracking-wide"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    Recent Workspaces
                  </p>
                  <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    Saved in this browser only
                  </span>
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
                          if (window.confirm(`Delete "${ws.name}"? This cannot be undone.`)) {
                            deleteWorkspace(ws.id);
                          }
                        }}
                      />
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: P&L Upload ── */}
        {step === 'pnl' && (
          <div className="flex flex-col gap-6">
            <div className="text-center">
              <h2 className="text-xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
                Upload Profit &amp; Loss
              </h2>
              <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Import your P&amp;L CSV. The wizard will detect column headers automatically.
              </p>
            </div>

            {pnlUpload.warnings.length > 0 && (
              <ImportValidationBanner warnings={pnlUpload.warnings} />
            )}

            <UploadStep
              title="P&L CSV"
              subtitle="Upload a P&L report — CSV or Excel (.xlsx) both work. Exports from QuickBooks, Xero, and most accounting platforms are supported."
              state={pnlUpload}
              profileId={selectedProfileId}
              onFile={(f) => handleFile(f, setPnlUpload, 'pnl')}
              onMappingConfirm={handlePnlMappingConfirm}
              onMappingCancel={() => setPnlUpload(EMPTY_UPLOAD)}
              onSkip={handlePnlNext}
              onShowManual={() => setShowPnlManual((v) => !v)}
              showManual={showPnlManual}
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
                Upload Balance Sheet
              </h2>
              <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Optional. Enables ratio analysis and balance-sheet-level metrics.
              </p>
            </div>

            {bsUpload.warnings.length > 0 && (
              <ImportValidationBanner warnings={bsUpload.warnings} />
            )}

            <UploadStep
              title="Balance Sheet CSV"
              subtitle="Upload a balance sheet export. Assets, liabilities, and equity accounts will be detected automatically."
              state={bsUpload}
              profileId={selectedProfileId}
              onFile={(f) => handleFile(f, setBsUpload, 'balance_sheet')}
              onMappingConfirm={handleBsMappingConfirm}
              onMappingCancel={() => setBsUpload(EMPTY_UPLOAD)}
              onSkip={handleBsNext}
              onShowManual={() => setShowBsManual((v) => !v)}
              showManual={showBsManual}
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
            {mergedAccounts.length === 0 ? (
              <div className="text-center py-8">
                <p style={{ color: 'hsl(var(--muted-foreground))' }} className="text-sm">
                  No accounts imported. You can create an empty workspace and add data later.
                </p>
                <div className="flex gap-3 justify-center mt-4">
                  <Button variant="outline" onClick={() => goToStep('pnl')}>
                    Go back and upload
                  </Button>
                  <Button onClick={() => handleClassifyConfirm([])}>
                    Create empty workspace
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
              Mapping complete. Your workspace is ready for analysis.
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
