'use client';

/**
 * Header chip that makes cloud persistence visible: Saving… / All changes
 * saved / Not saved (with Retry) / teammate-conflict (with Reload). Renders
 * nothing outside cloud mode. Companion to lib/data/cloud-sync.ts — before
 * this chip existed, failed saves only console.warn'd and users lost work.
 */

import { useWorkspaceStore } from '@/store/workspace-store';
import { retryUnsaved } from '@/lib/data/cloud-sync';
import { useFirmContext } from '@/components/app/firm-context';

export function SyncStatusChip() {
  const cloudMode = useWorkspaceStore((s) => s.cloudMode);
  const status = useWorkspaceStore((s) => s.syncStatus);
  const firm = useFirmContext();

  if (!cloudMode) return null;

  const base =
    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap';

  if (firm?.readOnly) {
    return (
      <span
        className={base}
        style={{ borderColor: 'hsl(38 92% 50% / 0.4)', color: 'hsl(32 81% 29%)', background: 'hsl(38 92% 50% / 0.08)' }}
        title="Billing is past due — the workspace is read-only and edits are not saved."
        data-testid="sync-chip-readonly"
      >
        Read-only
      </span>
    );
  }

  switch (status.phase) {
    case 'saving':
      return (
        <span
          className={base}
          style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
          data-testid="sync-chip-saving"
        >
          <span
            className="h-2.5 w-2.5 rounded-full border border-t-transparent animate-spin"
            style={{ borderColor: 'hsl(var(--muted-foreground))', borderTopColor: 'transparent' }}
            aria-hidden
          />
          Saving…
        </span>
      );

    case 'saved':
      return (
        <span
          className={base}
          style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
          title="Every change is stored in your firm's cloud workspace."
          data-testid="sync-chip-saved"
        >
          ✓ All changes saved
        </span>
      );

    case 'error':
      return (
        <span
          className={base}
          style={{ borderColor: 'hsl(0 72% 51% / 0.45)', color: 'hsl(0 72% 41%)', background: 'hsl(0 72% 51% / 0.06)' }}
          title={status.message ?? 'Your latest changes have not been saved.'}
          data-testid="sync-chip-error"
        >
          Not saved
          <button
            type="button"
            onClick={retryUnsaved}
            className="font-semibold underline underline-offset-2 hover:no-underline cursor-pointer"
          >
            Retry
          </button>
        </span>
      );

    case 'conflict':
      return (
        <span
          className={base}
          style={{ borderColor: 'hsl(0 72% 51% / 0.45)', color: 'hsl(0 72% 41%)', background: 'hsl(0 72% 51% / 0.06)' }}
          title={status.message ?? 'A teammate changed this client. Reload to see their changes.'}
          data-testid="sync-chip-conflict"
        >
          Changed by a teammate
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="font-semibold underline underline-offset-2 hover:no-underline cursor-pointer"
          >
            Reload
          </button>
        </span>
      );

    default:
      return null; // idle — nothing to report yet
  }
}
