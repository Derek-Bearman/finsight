'use client';

import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Account } from '@/types';
import { formatCurrency } from '@/lib/utils/accounts';

export interface AccountCardProps {
  account: Account;
  latestAmount?: number;
  isDragging?: boolean;
  conflictWarning?: string;
  /**
   * Click handler. Receives the click event so the caller can inspect
   * modifier keys (shift for range select, cmd/ctrl for toggle).
   */
  onClick?: (e: React.MouseEvent) => void;
  /** When true, renders without the useDraggable hook (e.g. inside DragOverlay) */
  isOverlay?: boolean;
  /**
   * When true, renders the card with an amber "Review" badge.
   * An account needs review when it was auto-classified with low (or no) confidence
   * and has not yet been manually confirmed.
   */
  needsReview?: boolean;
  /** When true, renders with a primary-color ring indicating bulk-selection. */
  isSelected?: boolean;
  /** When true, the keyboard focus indicator is shown on this card. */
  isFocused?: boolean;
  /**
   * When provided AND the account's cost behavior is 'mixed', an inline
   * fixed/variable split slider renders on the card. Interacting with it does
   * not start a drag or toggle selection (pointer/click are isolated).
   */
  onMixedSplitUpdate?: (accountId: string, fixedPercent: number) => void;
}

/**
 * Returns true if an account needs user review:
 * - not manually classified AND
 * - confidence is 'low' OR confidence is undefined
 */
export function accountNeedsReview(account: Account): boolean {
  return (
    !account.isManuallyClassified &&
    (account.classificationConfidence === 'low' ||
      account.classificationConfidence === undefined)
  );
}

function ConfidenceBadge({ level }: { level: string | undefined }) {
  if (!level) return null;
  const colors: Record<string, { bg: string; text: string }> = {
    high: { bg: 'hsl(142 76% 36% / 0.12)', text: 'hsl(142 76% 28%)' },
    medium: { bg: 'hsl(38 92% 50% / 0.15)', text: 'hsl(38 80% 35%)' },
    low: { bg: 'hsl(0 72% 51% / 0.12)', text: 'hsl(0 72% 40%)' },
  };
  const c = colors[level] ?? { bg: 'hsl(var(--muted))', text: 'hsl(var(--muted-foreground))' };
  return (
    <span
      className="rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ background: c.bg, color: c.text }}
    >
      {level}
    </span>
  );
}

function AccountCardInner({
  account,
  latestAmount,
  isDragging,
  conflictWarning,
  onClick,
  needsReview,
  isSelected,
  isFocused,
  onMixedSplitUpdate,
  dragHandleProps,
}: AccountCardProps & { dragHandleProps?: Record<string, unknown> }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const showMixedSplit = account.costBehavior === 'mixed' && !!onMixedSplitUpdate;
  const fixedPct = Math.round((account.mixedFixedPercent ?? 0.5) * 100);

  // Visual treatment cascade: dragging > selected > focused > default
  const borderColor = isDragging
    ? 'hsl(var(--primary))'
    : isSelected
      ? 'hsl(var(--primary))'
      : isFocused
        ? 'hsl(217 91% 60%)'
        : 'hsl(var(--border))';
  const ringShadow = isDragging
    ? '0 0 0 2px hsl(var(--primary) / 0.3), 0 4px 12px hsl(0 0% 0% / 0.1)'
    : isSelected
      ? '0 0 0 2px hsl(var(--primary) / 0.5)'
      : isFocused
        ? '0 0 0 2px hsl(217 91% 60% / 0.4)'
        : undefined;

  return (
    <div
      data-testid={`account-card-${account.id}`}
      data-selected={isSelected ? 'true' : undefined}
      onClick={onClick}
      className="rounded-lg border cursor-grab select-none transition-shadow"
      style={{
        background: isSelected ? 'hsl(var(--primary) / 0.06)' : 'hsl(var(--card))',
        borderColor,
        opacity: isDragging ? 0.7 : 1,
        boxShadow: ringShadow,
        transform: isDragging ? 'scale(1.02)' : undefined,
        padding: '8px 10px',
        position: 'relative',
      }}
      {...dragHandleProps}
    >
      {/* Unreviewed amber dot indicator */}
      {needsReview && (
        <div
          className="absolute top-1.5 left-1.5 flex items-center gap-1"
          title="Needs review — low classification confidence"
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: 'hsl(38 92% 50%)' }}
          />
        </div>
      )}

      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: needsReview ? '14px' : undefined }}>
          {account.number && (
            <span
              className="font-mono text-xs shrink-0"
              style={{ color: 'hsl(var(--muted-foreground))' }}
            >
              {account.number}
            </span>
          )}
          <span
            className="text-sm font-semibold truncate"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            {account.name}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {needsReview && (
            <span
              className="rounded px-1 py-0.5 text-xs font-medium"
              style={{ background: 'hsl(38 92% 50% / 0.15)', color: 'hsl(38 80% 35%)' }}
            >
              Review
            </span>
          )}
          {conflictWarning && (
            <div className="relative">
              <button
                type="button"
                className="text-amber-500 text-sm leading-none"
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                aria-label="Conflict warning"
              >
                ⚠
              </button>
              {showTooltip && (
                <div
                  className="absolute right-0 z-50 rounded-md border p-2 text-xs shadow-lg w-52"
                  style={{
                    background: 'hsl(var(--card))',
                    borderColor: 'hsl(38 92% 50% / 0.5)',
                    color: 'hsl(38 80% 35%)',
                    top: '100%',
                    marginTop: 4,
                  }}
                >
                  {conflictWarning}
                </div>
              )}
            </div>
          )}
          {account.isManuallyClassified && (
            <span
              className="rounded px-1 py-0.5 text-xs font-medium"
              style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}
            >
              manual
            </span>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="flex items-center justify-between mt-1 gap-2">
        <span
          className="text-xs tabular-nums"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          {latestAmount !== undefined ? formatCurrency(latestAmount) : '—'}
        </span>
        <ConfidenceBadge level={account.classificationConfidence} />
      </div>

      {/* Inline fixed/variable split (mixed accounts only). Pointer + click are
          isolated so adjusting the slider does not start a drag or select the
          card. */}
      {showMixedSplit && (
        <div
          className="mt-2 pt-2 border-t"
          style={{ borderColor: 'hsl(var(--border))', cursor: 'default' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Fixed / Variable
            </span>
            <span
              className="text-[11px] tabular-nums font-medium"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              {fixedPct}% / {100 - fixedPct}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={fixedPct}
            onChange={(e) => onMixedSplitUpdate?.(account.id, parseInt(e.target.value, 10) / 100)}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              accentColor: 'hsl(var(--primary))',
              background: `linear-gradient(to right, hsl(38 92% 50%) ${fixedPct}%, hsl(217 91% 60%) ${fixedPct}%)`,
            }}
            aria-label={`Fixed and variable split for ${account.name}`}
            data-testid={`mixed-split-slider-${account.id}`}
          />
        </div>
      )}
    </div>
  );
}

/** Draggable version — used inside DndContext */
export function AccountCard(props: AccountCardProps) {
  const { account, isOverlay } = props;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: account.id,
    data: { account },
    disabled: isOverlay,
  });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  if (isOverlay) {
    return <AccountCardInner {...props} />;
  }

  return (
    <div ref={setNodeRef} style={style}>
      <AccountCardInner
        {...props}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners } as Record<string, unknown>}
      />
    </div>
  );
}
