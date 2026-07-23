'use client';

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { Account } from '@/types';
import { AccountCard, accountNeedsReview } from './AccountCard';
import { formatCurrency } from '@/lib/utils/accounts';

export interface DropColumnProps {
  id: string;
  label: string;
  /** Hex or hsl accent color string for the header */
  accentColor: string;
  accounts: Account[];
  latestAmounts: Map<string, number>;
  total: number;
  conflictWarnings: Map<string, string>;
  searchQuery: string;
  /**
   * Card click handler. Receives the event so callers can inspect
   * modifier keys (shift, cmd/ctrl) for bulk-selection behavior.
   */
  onCardClick?: (account: Account, e: React.MouseEvent) => void;
  /** When true, cards that need review will show the amber Review badge. Default true. */
  showNeedsReview?: boolean;
  /** Set of account ids currently bulk-selected. Empty = nothing selected. */
  selectedIds?: Set<string>;
  /** Id of the keyboard-focused account, if any. */
  focusedId?: string | null;
  /** Forwarded to cards: renders the inline fixed/variable split slider on
   *  mixed-behavior accounts. */
  onMixedSplitUpdate?: (accountId: string, fixedPercent: number) => void;
}

export function DropColumn({
  id,
  label,
  accentColor,
  accounts,
  latestAmounts,
  total,
  conflictWarnings,
  searchQuery,
  onCardClick,
  showNeedsReview = true,
  selectedIds,
  focusedId,
  onMixedSplitUpdate,
}: DropColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  const filtered = searchQuery
    ? accounts.filter(
        (a) =>
          a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (a.number ?? '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : accounts;

  return (
    <div
      data-testid={`drop-column-${id}`}
      className="flex flex-col rounded-xl border overflow-hidden"
      style={{
        borderColor: isOver ? accentColor : 'hsl(var(--border))',
        background: 'hsl(var(--card))',
        minWidth: 220,
        flex: '1 1 220px',
        transition: 'border-color 0.15s',
        boxShadow: isOver ? `0 0 0 2px ${accentColor}33` : undefined,
      }}
    >
      {/* Accent bar */}
      <div style={{ height: 3, background: accentColor }} />

      {/* Header */}
      <div
        className="px-3 py-2.5 flex items-center justify-between gap-2 border-b"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted) / 0.4)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
            {label}
          </span>
          <span
            className="rounded-full px-1.5 py-0.5 text-xs font-medium"
            style={{ background: accentColor + '22', color: accentColor }}
          >
            {accounts.length}
          </span>
        </div>
        <span className="text-xs tabular-nums font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {formatCurrency(total)}
        </span>
      </div>

      {/* Drop zone body */}
      <div
        ref={setNodeRef}
        className="flex flex-col gap-1.5 p-2 overflow-y-auto"
        style={{
          minHeight: 200,
          maxHeight: '60vh',
          background: isOver ? `${accentColor}08` : undefined,
          transition: 'background 0.15s',
        }}
      >
        {filtered.length === 0 ? (
          <div
            className="flex-1 flex items-center justify-center rounded-lg border-2 border-dashed m-1"
            style={{
              borderColor: 'hsl(var(--border))',
              minHeight: 80,
              color: 'hsl(var(--muted-foreground))',
              fontSize: 12,
            }}
          >
            {searchQuery ? 'No matches' : 'Drag accounts here'}
          </div>
        ) : (
          filtered.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              latestAmount={latestAmounts.get(account.id)}
              conflictWarning={conflictWarnings.get(account.id)}
              onClick={(e) => onCardClick?.(account, e)}
              needsReview={showNeedsReview && accountNeedsReview(account)}
              isSelected={selectedIds?.has(account.id)}
              isFocused={focusedId === account.id}
              onMixedSplitUpdate={onMixedSplitUpdate}
            />
          ))
        )}
      </div>
    </div>
  );
}
