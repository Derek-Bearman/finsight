'use client';

/**
 * Franchise link control (FRANCHISE_BENCHMARKS_PLAN.md §F1) — small workspace
 * header affordance that designates this client as a franchisee of a
 * firm-level franchise. Linking just writes franchiseId + franchiseName onto
 * the workspace through the store's updateWorkspace path (same mechanism as
 * TargetsEditor's save), so the cloud-sync engine persists it automatically.
 *
 * Visibility is server-owned: getFranchiseState() decides canManage
 * (owner/admin, non-demo, full billing). Members and the demo user see the
 * chip when a link exists, never the manage actions. Fails closed — any load
 * error hides the control entirely.
 */

import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '@/store/workspace-store';
import { getFranchiseState, createFranchiseAction } from '@/lib/data/franchise-actions';
import type { Franchise } from '@/lib/data/franchises';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type FranchiseOption = Franchise & { linkedCount: number };

/** Sentinel select value for the inline "New franchise…" create path. */
const NEW_FRANCHISE = '__new__';

export function FranchiseLinkControl({ clientId }: { clientId: string }) {
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === clientId));
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);

  const [state, setState] = useState<{ canManage: boolean; franchises: FranchiseOption[] } | null>(
    null
  );
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    getFranchiseState()
      .then((res) => {
        if (!stale && res.ok) setState({ canManage: res.canManage, franchises: res.franchises });
      })
      .catch(() => {
        /* fail closed: no affordance */
      });
    return () => {
      stale = true;
    };
  }, []);

  if (!workspace || !state) return null;

  const linkedId = workspace.franchiseId;
  // Prefer the live name (renames land server-side); fall back to the cached one.
  const linkedName = linkedId
    ? state.franchises.find((f) => f.id === linkedId)?.name ?? workspace.franchiseName ?? 'Franchise'
    : null;

  // Members (and the demo user) only ever see the chip for an existing link.
  if (!linkedId && !state.canManage) return null;

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // Reseed from the saved link on every open so cancelled edits don't linger.
      setSelectedId(linkedId ?? (state.franchises.length === 0 ? NEW_FRANCHISE : ''));
      setNewName('');
      setError(null);
    }
    setOpen(next);
  };

  const unchanged = selectedId === (linkedId ?? '');
  const saveDisabled =
    busy ||
    unchanged ||
    (selectedId === NEW_FRANCHISE ? newName.trim() === '' : selectedId === '');

  const handleSave = async () => {
    if (!state.canManage || saveDisabled) return;
    setError(null);
    if (selectedId === NEW_FRANCHISE) {
      setBusy(true);
      // Default the new franchise's industry profile to this client's — the
      // natural fit for an inline create; editable later in the manager.
      const res = await createFranchiseAction({
        name: newName.trim(),
        industryProfileId: workspace.industryProfileId,
      });
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setState((s) =>
        s
          ? {
              ...s,
              franchises: [...s.franchises, res.data].sort((a, b) => a.name.localeCompare(b.name)),
            }
          : s
      );
      updateWorkspace(clientId, { franchiseId: res.data.id, franchiseName: res.data.name });
      setOpen(false);
      return;
    }
    const franchise = state.franchises.find((f) => f.id === selectedId);
    if (!franchise) return;
    updateWorkspace(clientId, { franchiseId: franchise.id, franchiseName: franchise.name });
    setOpen(false);
  };

  const handleUnlink = () => {
    updateWorkspace(clientId, { franchiseId: undefined, franchiseName: undefined });
    setOpen(false);
  };

  return (
    <>
      {linkedId ? (
        <button
          type="button"
          data-testid="franchise-chip"
          onClick={() => handleOpenChange(true)}
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted cursor-pointer"
          style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
          title={`Franchisee of ${linkedName}. Click to view the link.`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full flex-shrink-0"
            style={{ background: 'hsl(var(--primary))' }}
          />
          <span className="max-w-[10rem] truncate">{linkedName}</span>
        </button>
      ) : (
        <button
          type="button"
          data-testid="franchise-link-btn"
          onClick={() => handleOpenChange(true)}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted cursor-pointer"
          style={{ color: 'hsl(var(--muted-foreground))' }}
          title="Link this client to a firm-level franchise so corporate benchmarks apply"
        >
          Link franchise
        </button>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Franchise Link</DialogTitle>
            <DialogDescription>
              {state.canManage
                ? `Designate ${workspace.name} as a franchisee. Corporate benchmark sets and the corporate SCOA resolve through this link.`
                : 'Franchise links are managed by firm owners and admins.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {linkedId && (
              <p className="text-sm" style={{ color: 'hsl(var(--foreground))' }}>
                This client is a franchisee of{' '}
                <span className="font-semibold">{linkedName}</span>.
              </p>
            )}

            {state.canManage && (
              <>
                <div className="flex items-center gap-2">
                  <label
                    className="text-xs font-medium flex-shrink-0"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                    htmlFor="franchise-select"
                  >
                    {linkedId ? 'Change franchise:' : 'Franchise:'}
                  </label>
                  <select
                    id="franchise-select"
                    data-testid="franchise-select"
                    value={selectedId}
                    onChange={(e) => {
                      setSelectedId(e.target.value);
                      setError(null);
                    }}
                    className="flex-1 rounded-md border px-2 py-1 text-sm cursor-pointer"
                    style={{
                      borderColor: 'hsl(var(--border))',
                      background: 'hsl(var(--card))',
                      color: 'hsl(var(--foreground))',
                    }}
                  >
                    <option value="" disabled>
                      Select a franchise…
                    </option>
                    {state.franchises.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                    <option value={NEW_FRANCHISE}>New franchise…</option>
                  </select>
                </div>

                {selectedId === NEW_FRANCHISE && (
                  <input
                    type="text"
                    data-testid="franchise-new-name"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setError(null);
                    }}
                    placeholder="New franchise name"
                    maxLength={120}
                    autoFocus
                    className="rounded-md border px-2 py-1.5 text-sm"
                    style={{
                      borderColor: 'hsl(var(--border))',
                      background: 'hsl(var(--background))',
                      color: 'hsl(var(--foreground))',
                    }}
                  />
                )}

                {error && (
                  <p className="text-xs" role="alert" style={{ color: 'hsl(0 72% 45%)' }}>
                    {error}
                  </p>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            {state.canManage && linkedId && (
              <Button
                variant="outline"
                data-testid="franchise-unlink"
                disabled={busy}
                onClick={handleUnlink}
                className="mr-auto"
                style={{ color: 'hsl(var(--destructive))' }}
              >
                Unlink
              </Button>
            )}
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {state.canManage ? 'Cancel' : 'Close'}
            </Button>
            {state.canManage && (
              <Button data-testid="franchise-save" disabled={saveDisabled} onClick={handleSave}>
                {busy ? 'Saving…' : linkedId ? 'Save link' : 'Link'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
