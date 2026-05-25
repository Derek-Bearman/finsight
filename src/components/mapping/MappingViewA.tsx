'use client';

import React, { useState, useMemo } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import type { Account, AccountType, AuditEntry, ClientWorkspace, MappingMemoryEntry } from '@/types';
import type { ClassificationHint, IndustryProfile } from '@/types';
import { getProfile } from '@/lib/profiles';
import { DropColumn } from './DropColumn';
import { AccountCard, accountNeedsReview } from './AccountCard';
import { getLatestAmounts, columnTotal } from '@/lib/utils/accounts';
import type { SourceFilter } from './MappingToolbar';
import { matchesSourceFilter } from './sourceFilter';

export interface MappingViewAProps {
  workspace: ClientWorkspace;
  onAccountsChange: (accounts: Account[]) => void;
  onAuditEntry: (entry: AuditEntry) => void;
  onRememberMapping: (entry: MappingMemoryEntry) => void;
  /** Search query lifted to the toolbar */
  searchQuery: string;
  /** Source-of-classification filter lifted to the toolbar */
  sourceFilter: SourceFilter;
}

interface ColumnDef {
  id: AccountType;
  label: string;
  accentColor: string;
}

const COLUMNS: ColumnDef[] = [
  { id: 'revenue', label: 'Revenue', accentColor: 'hsl(142 76% 36%)' },
  { id: 'cogs', label: 'COGS', accentColor: 'hsl(38 92% 50%)' },
  { id: 'expense', label: 'Expense', accentColor: 'hsl(0 72% 51%)' },
  { id: 'asset', label: 'Asset', accentColor: 'hsl(217 91% 60%)' },
  { id: 'liability', label: 'Liability', accentColor: 'hsl(271 81% 56%)' },
  { id: 'equity', label: 'Equity', accentColor: 'hsl(196 94% 48%)' },
];

/**
 * Pure function: return a warning string if `newType` contradicts what the
 * source-document section, profile hints, or account number range imply.
 * Source-document section wins because it's literal evidence from the file.
 */
function getConflictWarning(
  account: Account,
  newType: AccountType,
  hints: ClassificationHint[]
): string | undefined {
  // 1) Section context (the strongest signal — it's where the row literally sat in the file)
  if (account.detectedSection && account.detectedSection !== newType) {
    return `Source file placed this under the ${account.detectedSection.toUpperCase()} section`;
  }

  // 2) Profile hints
  const lower = account.name.toLowerCase();
  for (const hint of hints) {
    if (hint.accountType && hint.accountType !== newType) {
      const matches = hint.keywords.some((kw) => lower.includes(kw.toLowerCase()));
      if (matches) {
        return hint.note
          ? `Profile suggests "${hint.accountType}": ${hint.note}`
          : `Profile hint suggests this account should be "${hint.accountType}"`;
      }
    }
  }
  return undefined;
}

function buildConflictWarnings(
  accounts: Account[],
  profile: IndustryProfile
): Map<string, string> {
  const map = new Map<string, string>();
  for (const account of accounts) {
    const warning = getConflictWarning(account, account.type, profile.classificationHints);
    if (warning) map.set(account.id, warning);
  }
  return map;
}

function makeAuditId(): string {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Excluded column — a special drop target for summary/subtotal rows.
 * Accounts dropped here get isExcluded=true and are kept out of all calculations.
 * Drag an excluded account back to a type column to restore it.
 */
function ExcludedColumn({
  accounts,
  latestAmounts,
  searchQuery,
  onUnexclude,
}: {
  accounts: Account[];
  latestAmounts: Map<string, number>;
  searchQuery: string;
  onUnexclude: (account: Account) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: '__excluded__' });

  const filtered = searchQuery
    ? accounts.filter(
        (a) =>
          a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (a.number ?? '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : accounts;

  return (
    <div
      data-testid="drop-column-excluded"
      className="flex flex-col rounded-xl border overflow-hidden"
      style={{
        borderColor: isOver ? 'hsl(var(--muted-foreground))' : 'hsl(var(--border))',
        borderStyle: 'dashed',
        background: 'hsl(var(--card))',
        minWidth: 220,
        flex: '1 1 220px',
        transition: 'border-color 0.15s',
        opacity: 0.85,
      }}
    >
      {/* Accent bar */}
      <div style={{ height: 3, background: 'hsl(var(--muted-foreground) / 0.4)' }} />

      {/* Header */}
      <div
        className="px-3 py-2.5 flex items-center justify-between gap-2 border-b"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted) / 0.4)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Excluded
          </span>
          <span
            className="rounded-full px-1.5 py-0.5 text-xs font-medium"
            style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
          >
            {accounts.length}
          </span>
        </div>
        <span
          className="text-xs"
          style={{ color: 'hsl(var(--muted-foreground))' }}
          title="Summary rows excluded from all calculations"
        >
          ⊘
        </span>
      </div>

      {/* Drop zone body */}
      <div
        ref={setNodeRef}
        className="flex flex-col gap-1.5 p-2 overflow-y-auto"
        style={{
          minHeight: 200,
          maxHeight: '60vh',
          background: isOver ? 'hsl(var(--muted) / 0.5)' : undefined,
          transition: 'background 0.15s',
        }}
      >
        {/* Hint text when empty */}
        {filtered.length === 0 && (
          <div
            className="flex-1 flex flex-col items-center justify-center rounded-lg border-2 border-dashed m-1 gap-1"
            style={{
              borderColor: 'hsl(var(--border))',
              minHeight: 80,
              color: 'hsl(var(--muted-foreground))',
              fontSize: 12,
              padding: '8px',
              textAlign: 'center',
            }}
          >
            {searchQuery ? 'No matches' : (
              <>
                <span>Drag summary rows here</span>
                <span style={{ fontSize: 10 }}>e.g. Net Income, Gross Profit</span>
              </>
            )}
          </div>
        )}

        {filtered.map((account) => (
          <div key={account.id} className="relative">
            <AccountCard
              account={account}
              latestAmount={latestAmounts.get(account.id)}
            />
            {/* Un-exclude button */}
            <button
              type="button"
              onClick={() => onUnexclude(account)}
              title="Move back to its type column"
              className="absolute top-1 right-1 rounded text-xs px-1 py-0.5 leading-none"
              style={{
                background: 'hsl(var(--muted))',
                color: 'hsl(var(--muted-foreground))',
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Inline select for keyboard/accessibility fallback */
function TypeSelect({
  account,
  onTypeChange,
}: {
  account: Account;
  onTypeChange: (a: Account, newType: AccountType) => void;
}) {
  return (
    <select
      value={account.type}
      onChange={(e) => onTypeChange(account, e.target.value as AccountType)}
      onClick={(e) => e.stopPropagation()}
      className="ml-1 text-xs rounded border px-1 py-0.5"
      style={{
        borderColor: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        color: 'hsl(var(--foreground))',
      }}
      aria-label={`Change type for ${account.name}`}
    >
      {COLUMNS.map((col) => (
        <option key={col.id} value={col.id}>
          {col.label}
        </option>
      ))}
    </select>
  );
}

export function MappingViewA({
  workspace,
  onAccountsChange,
  onAuditEntry,
  onRememberMapping,
  searchQuery,
  sourceFilter,
}: MappingViewAProps) {
  const [activeAccount, setActiveAccount] = useState<Account | null>(null);
  const profile = getProfile(workspace.industryProfileId);

  /**
   * One predicate that combines the toolbar's Source filter + the (lifted)
   * search query. Applied inside every column so the filter applies
   * uniformly without duplicating logic in DropColumn.
   */
  const visibleInColumn = (account: Account): boolean => {
    if (!matchesSourceFilter(account, sourceFilter)) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      account.name.toLowerCase().includes(q) ||
      (account.number ?? '').toLowerCase().includes(q)
    );
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const latestAmounts = getLatestAmounts(workspace.accounts, workspace.values);

  const conflictWarnings = buildConflictWarnings(workspace.accounts, profile);

  function handleTypeChange(account: Account, newType: AccountType) {
    if (account.type === newType) return;
    const previousType = account.type;
    const updatedAccount: Account = {
      ...account,
      type: newType,
      isManuallyClassified: true,
      classificationSource: 'manual',
    };

    const updatedAccounts = workspace.accounts.map((a) =>
      a.id === account.id ? updatedAccount : a
    );

    const entry: AuditEntry = {
      id: makeAuditId(),
      timestamp: new Date().toISOString(),
      accountId: account.id,
      accountName: account.name,
      action: 'classify_type',
      previousValue: previousType,
      newValue: newType,
      performedBy: 'user',
    };

    const memEntry: MappingMemoryEntry = {
      accountNameNormalized: account.name.toLowerCase().trim(),
      profileId: workspace.industryProfileId,
      type: newType,
      costBehavior: account.costBehavior,
    };

    onAccountsChange(updatedAccounts);
    onAuditEntry(entry);
    onRememberMapping(memEntry);
  }

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    const account = workspace.accounts.find((a) => a.id === active.id);
    setActiveAccount(account ?? null);
  }

  /**
   * Mark an account as excluded (for summary/subtotal rows).
   * isExcluded=true keeps the account's existing type but prevents it from
   * being included in any calculations.
   */
  function handleExcludeAccount(account: Account) {
    if (account.isExcluded) return; // already excluded
    const updatedAccount: Account = {
      ...account,
      isExcluded: true,
      isManuallyClassified: true,
      classificationSource: 'manual',
    };
    const updatedAccounts = workspace.accounts.map((a) =>
      a.id === account.id ? updatedAccount : a
    );
    const entry: AuditEntry = {
      id: makeAuditId(),
      timestamp: new Date().toISOString(),
      accountId: account.id,
      accountName: account.name,
      action: 'classify_type',
      previousValue: account.type,
      newValue: 'excluded',
      performedBy: 'user',
    };
    onAccountsChange(updatedAccounts);
    onAuditEntry(entry);
  }

  /**
   * Remove the excluded flag from an account, restoring it to its type column.
   */
  function handleUnexcludeAccount(account: Account) {
    const updatedAccount: Account = {
      ...account,
      isExcluded: false,
      isManuallyClassified: true,
      classificationSource: 'manual',
    };
    const updatedAccounts = workspace.accounts.map((a) =>
      a.id === account.id ? updatedAccount : a
    );
    const entry: AuditEntry = {
      id: makeAuditId(),
      timestamp: new Date().toISOString(),
      accountId: account.id,
      accountName: account.name,
      action: 'classify_type',
      previousValue: 'excluded',
      newValue: account.type,
      performedBy: 'user',
    };
    onAccountsChange(updatedAccounts);
    onAuditEntry(entry);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveAccount(null);

    if (!over) return;

    const overId = over.id as string;
    const account = workspace.accounts.find((a) => a.id === active.id);
    if (!account) return;

    // Special handling: dragging to the Excluded column
    if (overId === '__excluded__') {
      handleExcludeAccount(account);
      return;
    }

    // Dragging an excluded account to a type column un-excludes it and changes its type
    if (account.isExcluded) {
      const newType = overId as AccountType;
      const updatedAccount: Account = {
        ...account,
        type: newType,
        isExcluded: false,
        isManuallyClassified: true,
        classificationSource: 'manual',
      };
      const updatedAccounts = workspace.accounts.map((a) =>
        a.id === account.id ? updatedAccount : a
      );
      const entry: AuditEntry = {
        id: makeAuditId(),
        timestamp: new Date().toISOString(),
        accountId: account.id,
        accountName: account.name,
        action: 'classify_type',
        previousValue: 'excluded',
        newValue: newType,
        performedBy: 'user',
      };
      onAccountsChange(updatedAccounts);
      onAuditEntry(entry);
      return;
    }

    const newType = overId as AccountType;
    if (account.type === newType) return;
    handleTypeChange(account, newType);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {/* Column grid — horizontal scroll on desktop. Search & source-filter
          state lives in the toolbar above; we just consume it here. */}
      <div
        className="flex gap-3 overflow-x-auto pb-4"
        style={{ alignItems: 'flex-start' }}
      >
        {/* Regular account type columns — exclude accounts marked isExcluded from their type column */}
        {COLUMNS.map((col) => {
          const accounts = workspace.accounts.filter(
            (a) => a.type === col.id && !a.isExcluded && visibleInColumn(a)
          );
          const total = columnTotal(accounts.map((a) => a.id), latestAmounts);
          return (
            <DropColumn
              key={col.id}
              id={col.id}
              label={col.label}
              accentColor={col.accentColor}
              accounts={accounts}
              latestAmounts={latestAmounts}
              total={total}
              conflictWarnings={conflictWarnings}
              searchQuery=""
              onCardClick={() => {
                // Clicking opens an inline type select — handled by TypeSelect
              }}
            />
          );
        })}

        {/* Excluded column — for summary/subtotal rows that would double-count */}
        <ExcludedColumn
          accounts={workspace.accounts.filter((a) => !!a.isExcluded && visibleInColumn(a))}
          latestAmounts={latestAmounts}
          searchQuery=""
          onUnexclude={handleUnexcludeAccount}
        />
      </div>

      {/* Inline type-select accessibility panel */}
      <details className="mt-2">
        <summary
          className="text-xs cursor-pointer"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          Keyboard: change account types without drag
        </summary>
        <div
          className="mt-2 rounded-lg border p-3 max-h-64 overflow-y-auto flex flex-col gap-1"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          {workspace.accounts
            .filter((a) =>
              searchQuery
                ? a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  (a.number ?? '').includes(searchQuery)
                : true
            )
            .map((account) => (
              <div key={account.id} className="flex items-center gap-2 text-sm">
                <span style={{ color: 'hsl(var(--foreground))' }}>{account.name}</span>
                <TypeSelect account={account} onTypeChange={handleTypeChange} />
              </div>
            ))}
        </div>
      </details>

      {/* Drag overlay */}
      <DragOverlay>
        {activeAccount && (
          <div style={{ transform: 'scale(1.04)', opacity: 0.95 }}>
            <AccountCard
              account={activeAccount}
              latestAmount={latestAmounts.get(activeAccount.id)}
              isOverlay
              isDragging
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
