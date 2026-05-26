'use client';

/**
 * /workspace/[clientId]/print
 *
 * Print-friendly client report page. The workspace header's "Export PDF"
 * button opens this route in a new tab. On load, after Zustand has
 * hydrated and Recharts has had a beat to lay out, the page auto-fires
 * window.print() so the user lands directly in the print/Save-as-PDF dialog.
 *
 * If the user cancels the print dialog, the rendered report stays visible
 * on screen with a sticky "Generate PDF" button (no-print) to re-trigger.
 */

import React, { use, useEffect, useState } from 'react';
import { useWorkspaceStore } from '@/store/workspace-store';
import { PrintReport } from '@/components/print/PrintReport';

interface PageProps {
  params: Promise<{ clientId: string }>;
}

const AUTO_PRINT_DELAY_MS = 1500;

export default function WorkspacePrintPage({ params }: PageProps) {
  const { clientId } = use(params);
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === clientId));
  const [hydrated, setHydrated] = useState(false);
  const [autoTriggered, setAutoTriggered] = useState(false);

  // Wait for Zustand localStorage hydration before reading workspace
  useEffect(() => {
    if (useWorkspaceStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useWorkspaceStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);

  // Once hydrated AND workspace is found, fire window.print() after a settle delay
  // so Recharts SVGs have time to lay out before the snapshot.
  useEffect(() => {
    if (!hydrated || !workspace || autoTriggered) return;
    setAutoTriggered(true);
    const t = setTimeout(() => {
      window.print();
    }, AUTO_PRINT_DELAY_MS);
    return () => clearTimeout(t);
  }, [hydrated, workspace, autoTriggered]);

  if (!hydrated) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'hsl(var(--primary))' }}
        />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <div>
          <p style={{ fontSize: 24, fontWeight: 700, color: 'hsl(var(--foreground))' }}>404</p>
          <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: '0.5rem' }}>
            Workspace not found
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'hsl(var(--background))' }}>
      {/* Sticky print trigger (no-print so it doesn't appear in the PDF itself) */}
      <div
        className="no-print"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'hsl(var(--card))',
          borderBottom: '1px solid hsl(var(--border))',
          padding: '0.75rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'hsl(var(--foreground))', margin: 0 }}>
            Print preview · {workspace.name}
          </p>
          <p style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', margin: '0.125rem 0 0' }}>
            Use your browser&apos;s print dialog (or the button) to save as PDF.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => window.close()}
            style={{
              border: '1px solid hsl(var(--border))',
              borderRadius: 6,
              padding: '0.4rem 0.85rem',
              fontSize: 13,
              fontWeight: 500,
              background: 'hsl(var(--background))',
              color: 'hsl(var(--foreground))',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            data-testid="generate-pdf-btn"
            style={{
              border: '1px solid hsl(var(--primary))',
              borderRadius: 6,
              padding: '0.4rem 0.85rem',
              fontSize: 13,
              fontWeight: 600,
              background: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
              cursor: 'pointer',
            }}
          >
            ↓ Generate PDF
          </button>
        </div>
      </div>

      <PrintReport workspace={workspace} />
    </div>
  );
}
