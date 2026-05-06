'use client';

import React, { useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Account, AccountType, AuditEntry, ClientWorkspace, MappingMemoryEntry } from '@/types';
import type { ClassificationHint, IndustryProfile } from '@/types';
import { getProfile } from '@/lib/profiles';
import { DropColumn } from './DropColumn';
import { AccountCard } from './AccountCard';
import { getLatestAmounts, columnTotal } from '@/lib/utils/accounts';

export interface MappingViewAProps {
  workspace: ClientWorkspace;
  onAccountsChange: (accounts: Account[]) => void;
  onAuditEntry: (entry: AuditEntry) => void;
  onRememberMapping: (entry: MappingMemoryEntry) => void;
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

/** Pure function: check if dragging an account to newType conflicts with profile hints */
function getConflictWarning(
  account: Account,
  newType: AccountType,
  hints: ClassificationHint[]
): string | undefined {
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
}: MappingViewAProps) {
  const [activeAccount, setActiveAccount] = useState<Account | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const profile = getProfile(workspace.industryProfileId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const latestAmounts = getLatestAmounts(workspace.accounts, workspace.values);

  // Build per-column account lists
  const columnAccounts = (type: AccountType) =>
    workspace.accounts.filter((a) => a.type === type);

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveAccount(null);

    if (!over) return;

    const newType = over.id as AccountType;
    const account = workspace.accounts.find((a) => a.id === active.id);
    if (!account) return;
    if (account.type === newType) return;

    handleTypeChange(account, newType);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {/* Search within this view */}
      <div className="mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter accounts in this view..."
          className="w-full max-w-sm rounded-lg border px-3 py-1.5 text-sm"
          style={{
            borderColor: 'hsl(var(--border))',
            background: 'hsl(var(--background))',
            color: 'hsl(var(--foreground))',
            outline: 'none',
          }}
        />
      </div>

      {/* Column grid — horizontal scroll on desktop */}
      <div
        className="flex gap-3 overflow-x-auto pb-4"
        style={{ alignItems: 'flex-start' }}
      >
        {COLUMNS.map((col) => {
          const accounts = columnAccounts(col.id);
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
              searchQuery={searchQuery}
              onCardClick={(account) => {
                // Clicking opens an inline type select — handled via a custom approach
                // We'll just let the TypeSelect render inside its own handler
              }}
            />
          );
        })}
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
