'use client';

/**
 * First-login import prompt (Phase 2b). When a user with pre-cloud workspaces
 * in this browser's localStorage signs into a firm for the first time, we offer
 * to bring them into the firm's cloud storage — per-workspace, opt-in (not
 * auto-import, per the locked product decision).
 *
 * `runImport` is idempotent on source_local_id, so a double submit (or a repeat
 * across a refresh) never duplicates. On success we re-hydrate the store from
 * the returned authoritative list so the imported clients appear immediately.
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ALL_PROFILES } from '@/lib/profiles';
import { useWorkspaceStore } from '@/store/workspace-store';
import { runImport } from '@/lib/data/workspace-actions';
import { noteHydrated } from '@/lib/data/cloud-sync';
import type { ClientWorkspace } from '@/types';

export function ImportPrompt({
  localWorkspaces,
  onDone,
}: {
  localWorkspaces: ClientWorkspace[];
  /** Called after import completes OR the user dismisses — marks it handled. */
  onDone: () => void;
}) {
  const hydrateFromCloud = useWorkspaceStore((s) => s.hydrateFromCloud);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(localWorkspaces.map((w) => w.id))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleImport = async () => {
    setError(null);
    const items = localWorkspaces
      .filter((w) => selected.has(w.id))
      .map((w) => ({ localId: w.id, workspace: w }));
    if (items.length === 0) {
      onDone();
      return;
    }
    setBusy(true);
    const res = await runImport(items);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    hydrateFromCloud(res.data.workspaces);
    noteHydrated(res.data.workspaces);
    onDone();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import workspaces from this browser?</DialogTitle>
          <DialogDescription>
            We found {localWorkspaces.length} workspace
            {localWorkspaces.length === 1 ? '' : 's'} saved in this browser. Choose which to bring
            into your firm&apos;s cloud storage — they&apos;ll then sync everywhere you sign in.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 overflow-y-auto flex flex-col gap-2 py-1">
          {localWorkspaces.map((w) => {
            const profile = ALL_PROFILES.find((p) => p.id === w.industryProfileId);
            return (
              <label
                key={w.id}
                className="flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer"
                style={{ borderColor: 'hsl(var(--border))' }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(w.id)}
                  onChange={() => toggle(w.id)}
                  data-testid={`import-check-${w.id}`}
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                    {w.name}
                  </span>
                  <span className="block text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {profile?.name ?? w.industryProfileId} · {w.accounts.length} accounts
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onDone} disabled={busy} data-testid="import-skip">
            Not now
          </Button>
          <Button onClick={handleImport} disabled={busy} data-testid="import-confirm">
            {busy ? 'Importing…' : `Import ${selected.size} selected`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
