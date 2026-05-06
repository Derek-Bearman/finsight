'use client';

import React from 'react';
import type { AuditEntry, AuditAction } from '@/types';

export interface AuditLogSheetProps {
  entries: AuditEntry[];
  isOpen: boolean;
  onClose: () => void;
}

function getRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function getActionColor(action: AuditAction): { bg: string; text: string; label: string } {
  switch (action) {
    case 'classify_type':
      return { bg: 'hsl(217 91% 60% / 0.12)', text: 'hsl(217 91% 40%)', label: 'Type changed' };
    case 'classify_behavior':
      return { bg: 'hsl(142 76% 36% / 0.12)', text: 'hsl(142 76% 28%)', label: 'Behavior changed' };
    case 'set_mixed_split':
      return { bg: 'hsl(38 92% 50% / 0.15)', text: 'hsl(38 80% 35%)', label: 'Split updated' };
    case 'reset_to_auto':
      return { bg: 'hsl(0 72% 51% / 0.1)', text: 'hsl(0 72% 40%)', label: 'Reset to auto' };
    default:
      return { bg: 'hsl(var(--muted))', text: 'hsl(var(--muted-foreground))', label: action };
  }
}

function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const color = getActionColor(entry.action);
  return (
    <div
      className="flex flex-col gap-1 py-3 border-b"
      style={{ borderColor: 'hsl(var(--border))' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="rounded px-1.5 py-0.5 text-xs font-medium shrink-0"
            style={{ background: color.bg, color: color.text }}
          >
            {color.label}
          </span>
          <span
            className="text-sm font-medium truncate"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            {entry.accountName}
          </span>
        </div>
        <span
          className="text-xs shrink-0"
          style={{ color: 'hsl(var(--muted-foreground))' }}
          title={entry.timestamp}
        >
          {getRelativeTime(entry.timestamp)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
        <span
          className="rounded px-1.5 py-0.5"
          style={{ background: 'hsl(var(--muted))', fontFamily: 'monospace' }}
        >
          {entry.previousValue}
        </span>
        <span>→</span>
        <span
          className="rounded px-1.5 py-0.5"
          style={{ background: color.bg, color: color.text, fontFamily: 'monospace' }}
        >
          {entry.newValue}
        </span>
        <span className="ml-1">· by {entry.performedBy}</span>
      </div>
    </div>
  );
}

export function AuditLogSheet({ entries, isOpen, onClose }: AuditLogSheetProps) {
  // Reverse so newest first
  const sorted = [...entries].reverse();

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'hsl(0 0% 0% / 0.3)' }}
          onClick={onClose}
          aria-hidden
        />
      )}

      {/* Sheet */}
      <div
        className="fixed top-0 right-0 z-50 h-full w-full max-w-md flex flex-col"
        style={{
          background: 'hsl(var(--background))',
          borderLeft: '1px solid hsl(var(--border))',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: isOpen ? '-8px 0 32px hsl(0 0% 0% / 0.12)' : 'none',
        }}
        role="dialog"
        aria-label="Audit log"
        aria-modal="true"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
              Audit Log
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {entries.length} change{entries.length !== 1 ? 's' : ''} recorded
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border w-8 h-8 flex items-center justify-center text-sm transition-colors"
            style={{
              borderColor: 'hsl(var(--border))',
              color: 'hsl(var(--foreground))',
              background: 'hsl(var(--background))',
            }}
            aria-label="Close audit log"
          >
            ×
          </button>
        </div>

        {/* Entries */}
        <div className="flex-1 overflow-y-auto px-5">
          {sorted.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-16 gap-2 text-center"
            >
              <span className="text-2xl">📋</span>
              <p className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                No changes yet
              </p>
              <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Drag accounts to reclassify them — all changes are recorded here.
              </p>
            </div>
          ) : (
            sorted.map((entry) => <AuditEntryRow key={entry.id} entry={entry} />)
          )}
        </div>
      </div>
    </>
  );
}
