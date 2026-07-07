'use client';

/**
 * Disables an editing surface while the firm is in read-only billing grace.
 * Without this, mapping drags / sliders / data entry stayed fully interactive,
 * recomputed all derived reports as if saved, and the server quietly refused
 * the persistence — edits vanished on reload with no explanation.
 *
 * `inert` (React 19) blocks keyboard interaction too (tab/space drag-and-drop,
 * slider arrow keys), not just pointer events.
 */

import { useReadOnly } from '@/components/app/firm-context';

export function ReadOnlyGuard({ children }: { children: React.ReactNode }) {
  const readOnly = useReadOnly();
  if (!readOnly) return <>{children}</>;
  return (
    <div>
      <div
        className="rounded-lg border px-4 py-2 mb-4 text-sm"
        style={{
          borderColor: 'hsl(38 92% 50% / 0.4)',
          background: 'hsl(38 92% 50% / 0.06)',
          color: 'hsl(32 81% 29%)',
        }}
        data-testid="readonly-guard-notice"
      >
        Read-only while billing is resolved — editing is disabled and changes are not saved.
      </div>
      <div inert className="opacity-60 pointer-events-none select-none">
        {children}
      </div>
    </div>
  );
}
