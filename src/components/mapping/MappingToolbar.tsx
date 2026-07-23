'use client';

import React, { useState } from 'react';
import { AuditLogSheet } from './AuditLogSheet';
import type { AuditEntry } from '@/types';

export type SourceFilter =
  | 'all'
  | 'manual'
  | 'profile'
  | 'account_number'
  | 'auto'
  | 'needs_review';

export interface MappingToolbarProps {
  view: 'type' | 'behavior';
  onViewChange: (v: 'type' | 'behavior') => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  /** Reset every account to fresh auto-classification (destroys manual overrides). */
  onReset: () => void;
  /** Re-run auto-classification only on accounts that aren't manually classified. Safe. */
  onRefreshAuto: () => void;
  totalAccounts: number;
  manualCount: number;
  auditEntries: AuditEntry[];
  sourceFilter: SourceFilter;
  onSourceFilterChange: (f: SourceFilter) => void;
  sourceCounts: Record<Exclude<SourceFilter, 'all'>, number>;
}

const SOURCE_FILTER_LABELS: Record<SourceFilter, string> = {
  all: 'All',
  needs_review: 'Needs Review',
  manual: 'Manual',
  profile: 'Profile hint',
  account_number: 'Account #',
  auto: 'Auto',
};

const SOURCE_FILTER_TOOLTIPS: Record<SourceFilter, string> = {
  all: 'Show all accounts.',
  needs_review: 'Accounts the classifier flagged as low-confidence — review these first.',
  manual: 'Accounts you reclassified manually.',
  profile: 'Accounts classified by an industry-profile keyword hint (e.g. "subcontractor" for Trades).',
  account_number: 'Accounts classified by their account-number range.',
  auto: 'Accounts classified by the generic keyword/section rules.',
};

export function MappingToolbar({
  view,
  onViewChange,
  searchQuery,
  onSearchChange,
  onReset,
  onRefreshAuto,
  totalAccounts,
  manualCount,
  auditEntries,
  sourceFilter,
  onSourceFilterChange,
  sourceCounts,
}: MappingToolbarProps) {
  const [auditOpen, setAuditOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  function handleReset() {
    onReset();
    setConfirmReset(false);
  }

  return (
    <>
      <div
        data-testid="mapping-toolbar"
        className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
        style={{
          borderColor: 'hsl(var(--border))',
          background: 'hsl(var(--card))',
        }}
      >
        {/* Left: View toggle */}
        <div
          className="flex rounded-lg border overflow-hidden"
          style={{ borderColor: 'hsl(var(--border))' }}
          role="group"
          aria-label="Mapping view"
          data-tour="mapping-view-toggle"
        >
          <button
            type="button"
            onClick={() => onViewChange('type')}
            className="px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              background:
                view === 'type' ? 'hsl(var(--primary))' : 'hsl(var(--background))',
              color:
                view === 'type' ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
              borderRight: '1px solid hsl(var(--border))',
            }}
          >
            Account Types
          </button>
          <button
            type="button"
            onClick={() => onViewChange('behavior')}
            className="px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              background:
                view === 'behavior' ? 'hsl(var(--primary))' : 'hsl(var(--background))',
              color:
                view === 'behavior'
                  ? 'hsl(var(--primary-foreground))'
                  : 'hsl(var(--foreground))',
            }}
          >
            Cost Behavior
          </button>
        </div>

        {/* Center: Search */}
        <div className="flex-1 min-w-48">
          <div className="relative">
            <span
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm"
              style={{ color: 'hsl(var(--muted-foreground))' }}
              aria-hidden
            >
              🔍
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search accounts..."
              className="w-full rounded-lg border pl-8 pr-3 py-1.5 text-sm"
              style={{
                borderColor: 'hsl(var(--border))',
                background: 'hsl(var(--background))',
                color: 'hsl(var(--foreground))',
                outline: 'none',
              }}
              aria-label="Search accounts"
            />
          </div>
        </div>

        {/* Right: Stats & actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Manual overrides badge */}
          <span
            className="rounded-full border px-2.5 py-1 text-xs font-medium"
            style={{
              borderColor: manualCount > 0 ? 'hsl(var(--primary) / 0.4)' : 'hsl(var(--border))',
              color: manualCount > 0 ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
              background:
                manualCount > 0 ? 'hsl(var(--primary) / 0.08)' : 'hsl(var(--muted) / 0.5)',
            }}
          >
            Manual overrides: {manualCount}
          </span>

          {/* Audit log */}
          <button
            type="button"
            onClick={() => setAuditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            style={{
              borderColor: 'hsl(var(--border))',
              color: 'hsl(var(--foreground))',
              background: 'hsl(var(--background))',
            }}
            title="Open the audit log — every classification change is recorded with timestamp, source, and previous value."
          >
            <span>View audit log</span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
              style={{
                background: 'hsl(var(--muted))',
                color: 'hsl(var(--muted-foreground))',
              }}
              aria-label={`${auditEntries.length} entries`}
            >
              {auditEntries.length}
            </span>
          </button>

          {/* Refresh auto-classified — non-destructive */}
          <button
            type="button"
            onClick={onRefreshAuto}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              borderColor: 'hsl(var(--border))',
              color: 'hsl(var(--foreground))',
              background: 'hsl(var(--background))',
            }}
            title="Re-run classification on auto-classified accounts only. Manual overrides are preserved."
          >
            Refresh auto-classified
          </button>

          {/* Reset (destructive — wipes manual overrides) */}
          {!confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              disabled={manualCount === 0}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                borderColor: manualCount > 0 ? 'hsl(0 72% 51% / 0.5)' : 'hsl(var(--border))',
                color: manualCount > 0 ? 'hsl(0 72% 51%)' : 'hsl(var(--muted-foreground))',
                background: 'hsl(var(--background))',
                cursor: manualCount === 0 ? 'not-allowed' : 'pointer',
                opacity: manualCount === 0 ? 0.5 : 1,
              }}
              title={
                manualCount === 0
                  ? 'Nothing to reset — no manual overrides yet.'
                  : 'Reset every account — including manual overrides — to fresh auto-classification.'
              }
            >
              Reset all
            </button>
          ) : (
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
              style={{
                borderColor: 'hsl(0 72% 51% / 0.5)',
                background: 'hsl(0 72% 51% / 0.06)',
              }}
            >
              <span style={{ color: 'hsl(0 72% 40%)' }}>
                Revert {manualCount} manual override{manualCount !== 1 ? 's' : ''}?
              </span>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="text-xs font-medium underline underline-offset-2"
                style={{ color: 'hsl(var(--muted-foreground))' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="rounded px-2 py-0.5 text-xs font-semibold"
                style={{
                  background: 'hsl(0 72% 51%)',
                  color: 'white',
                }}
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Source filter row */}
      <div className="flex flex-wrap items-center gap-1.5 px-1 mt-2">
        <span
          className="text-xs font-medium mr-1"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          Filter:
        </span>
        {(['all', 'needs_review', 'manual', 'profile', 'account_number', 'auto'] as SourceFilter[]).map((f) => {
          const isActive = sourceFilter === f;
          const count = f === 'all' ? totalAccounts : sourceCounts[f];
          return (
            <button
              key={f}
              type="button"
              onClick={() => onSourceFilterChange(f)}
              data-testid={`source-filter-${f}`}
              title={SOURCE_FILTER_TOOLTIPS[f]}
              className="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors"
              style={{
                borderColor: isActive ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                background: isActive ? 'hsl(var(--primary) / 0.1)' : 'hsl(var(--background))',
                color: isActive ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
              }}
            >
              {SOURCE_FILTER_LABELS[f]} ({count})
            </button>
          );
        })}
      </div>

      {/* Audit log slide-over */}
      <AuditLogSheet
        entries={auditEntries}
        isOpen={auditOpen}
        onClose={() => setAuditOpen(false)}
      />
    </>
  );
}
