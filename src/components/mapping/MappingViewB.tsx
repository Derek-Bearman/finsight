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
import type {
  Account,
  AuditEntry,
  ClientWorkspace,
  CostBehavior,
  MappingMemoryEntry,
} from '@/types';
import { DropColumn } from './DropColumn';
import { AccountCard } from './AccountCard';
import { MixedSplitSlider } from './MixedSplitSlider';
import { getLatestAmounts, columnTotal } from '@/lib/utils/accounts';

export interface MappingViewBProps {
  workspace: ClientWorkspace;
  onAccountsChange: (accounts: Account[]) => void;
  onAuditEntry: (entry: AuditEntry) => void;
  onRememberMapping: (entry: MappingMemoryEntry) => void;
}

interface BehaviorColumnDef {
  id: CostBehavior;
  label: string;
  accentColor: string;
}

const BEHAVIOR_COLUMNS: BehaviorColumnDef[] = [
  { id: 'variable', label: 'Variable', accentColor: 'hsl(217 91% 60%)' },
  { id: 'fixed', label: 'Fixed', accentColor: 'hsl(271 81% 56%)' },
  { id: 'mixed', label: 'Mixed', accentColor: 'hsl(38 92% 50%)' },
  { id: 'unclassified', label: 'Unclassified', accentColor: 'hsl(var(--muted-foreground))' },
];

function makeAuditId(): string {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function MappingViewB({
  workspace,
  onAccountsChange,
  onAuditEntry,
  onRememberMapping,
}: MappingViewBProps) {
  const [activeAccount, setActiveAccount] = useState<Account | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const latestAmounts = getLatestAmounts(workspace.accounts, workspace.values);

  // Only COGS and expense accounts are eligible for cost behavior classification.
  // Revenue accounts have no cost behavior (they ARE the revenue).
  // Asset, liability, and equity are balance sheet accounts — cost behavior
  // (fixed/variable/mixed) is a P&L concept and is meaningless for them.
  // Excluded accounts (isExcluded=true) are also omitted since they don't participate
  // in any calculations.
  const eligible = workspace.accounts.filter(
    (a) => (a.type === 'cogs' || a.type === 'expense') && !a.isExcluded
  );

  const columnAccounts = (behavior: CostBehavior) =>
    eligible.filter((a) => (a.costBehavior ?? 'unclassified') === behavior);

  const mixedAccounts = columnAccounts('mixed');

  function handleBehaviorChange(account: Account, newBehavior: CostBehavior) {
    const prev = account.costBehavior ?? 'unclassified';
    if (prev === newBehavior) return;

    const updatedAccount: Account = {
      ...account,
      costBehavior: newBehavior,
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
      action: 'classify_behavior',
      previousValue: prev,
      newValue: newBehavior,
      performedBy: 'user',
    };

    const memEntry: MappingMemoryEntry = {
      accountNameNormalized: account.name.toLowerCase().trim(),
      profileId: workspace.industryProfileId,
      type: account.type,
      costBehavior: newBehavior,
    };

    onAccountsChange(updatedAccounts);
    onAuditEntry(entry);
    onRememberMapping(memEntry);
  }

  function handleMixedSplitUpdate(accountId: string, fixedPercent: number) {
    const account = workspace.accounts.find((a) => a.id === accountId);
    if (!account) return;

    const prev = account.mixedFixedPercent ?? 0.5;
    const updatedAccount: Account = { ...account, mixedFixedPercent: fixedPercent };
    const updatedAccounts = workspace.accounts.map((a) =>
      a.id === accountId ? updatedAccount : a
    );

    const entry: AuditEntry = {
      id: makeAuditId(),
      timestamp: new Date().toISOString(),
      accountId: account.id,
      accountName: account.name,
      action: 'set_mixed_split',
      previousValue: `${Math.round(prev * 100)}% fixed`,
      newValue: `${Math.round(fixedPercent * 100)}% fixed`,
      performedBy: 'user',
    };

    onAccountsChange(updatedAccounts);
    onAuditEntry(entry);
  }

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    const account = eligible.find((a) => a.id === active.id);
    setActiveAccount(account ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveAccount(null);
    if (!over) return;

    const newBehavior = over.id as CostBehavior;
    const account = eligible.find((a) => a.id === active.id);
    if (!account) return;

    handleBehaviorChange(account, newBehavior);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {/* Filter hint */}
      <div
        className="mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
        style={{
          borderColor: 'hsl(var(--border))',
          color: 'hsl(var(--muted-foreground))',
          background: 'hsl(var(--muted) / 0.4)',
        }}
      >
        <span>ℹ</span>
        <span>
          Showing {eligible.length} COGS & expense accounts. Drag them into Variable, Fixed, or Mixed buckets.
        </span>
      </div>

      {/* Search filter */}
      <div className="mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter accounts..."
          className="w-full max-w-sm rounded-lg border px-3 py-1.5 text-sm"
          style={{
            borderColor: 'hsl(var(--border))',
            background: 'hsl(var(--background))',
            color: 'hsl(var(--foreground))',
            outline: 'none',
          }}
        />
      </div>

      {/* Columns */}
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ alignItems: 'flex-start' }}>
        {BEHAVIOR_COLUMNS.map((col) => {
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
              conflictWarnings={new Map()}
              searchQuery={searchQuery}
            />
          );
        })}
      </div>

      {/* Mixed splits section */}
      {mixedAccounts.length > 0 && (
        <div className="mt-6">
          <h3
            className="text-sm font-semibold mb-3"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Mixed Cost Splits
          </h3>
          <p className="text-xs mb-3" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Set the fixed vs. variable split for each mixed-behavior account.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {mixedAccounts.map((account) => (
              <MixedSplitSlider
                key={account.id}
                account={account}
                onUpdate={handleMixedSplitUpdate}
              />
            ))}
          </div>
        </div>
      )}

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
