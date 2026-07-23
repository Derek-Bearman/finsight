'use client';

/**
 * Firm-level franchise manager (FRANCHISE_BENCHMARKS_PLAN.md §F1) — lists the
 * firm's franchises with linked-client counts; owners/admins can create,
 * rename, and delete, and expand per-row panels for corporate benchmarks
 * (§F2) and the corporate SCOA (§F4). Members and the shared demo get a
 * read-only list. All mutations go through the franchise server actions,
 * which re-check role and demo gates on top of the database RLS policies.
 */

import { useEffect, useState, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ALL_PROFILES, PROFILE_MAP } from '@/lib/profiles';
import {
  getFranchiseState,
  createFranchiseAction,
  updateFranchiseAction,
  deleteFranchiseAction,
} from '@/lib/data/franchise-actions';
import type { Franchise } from '@/lib/data/franchises';
import { BenchmarkSetPanel } from '@/components/franchise/BenchmarkSetPanel';
import { ScoaPanel } from '@/components/franchise/ScoaPanel';

type FranchiseWithLinks = Franchise & { linkedCount: number };

/** Which per-row panel is expanded (one open at a time across all rows). */
type ExpandedPanel = { id: string; panel: 'benchmarks' | 'scoa' };

function profileLabel(industryProfileId: string | null): string {
  if (!industryProfileId) return 'No profile';
  return PROFILE_MAP[industryProfileId]?.name ?? industryProfileId;
}

/** "2 benchmark sets · active: FY2027 targets" — read-only row summary. */
function benchmarkSummary(f: FranchiseWithLinks): string {
  const sets = f.config.benchmarkSets ?? [];
  const active = sets.find((s) => s.active);
  const count = `${sets.length} benchmark set${sets.length === 1 ? '' : 's'}`;
  return active ? `${count} · active: ${active.label}` : count;
}

function byName(a: FranchiseWithLinks, b: FranchiseWithLinks) {
  return a.name.localeCompare(b.name);
}

export function FranchiseManager() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [franchises, setFranchises] = useState<FranchiseWithLinks[]>([]);

  // Create form
  const [name, setName] = useState('');
  const [profileId, setProfileId] = useState('');

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<FranchiseWithLinks | null>(null);

  // Per-row expanded panel: corporate benchmarks or SCOA (canManage only)
  const [expanded, setExpanded] = useState<ExpandedPanel | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getFranchiseState();
      if (cancelled) return;
      if (res.ok) {
        setCanManage(res.canManage);
        setIsDemo(res.isDemo);
        setFranchises([...res.franchises].sort(byName));
      } else {
        setLoadError(res.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const res = await createFranchiseAction({
        name,
        industryProfileId: profileId || null,
      });
      if (!res.ok) return setError(res.error);
      setFranchises((prev) => [...prev, res.data].sort(byName));
      setName('');
      setProfileId('');
    });
  }

  function startRename(f: FranchiseWithLinks) {
    setError(null);
    setRenamingId(f.id);
    setRenameValue(f.name);
  }

  function handleRename(f: FranchiseWithLinks) {
    setError(null);
    startTransition(async () => {
      const res = await updateFranchiseAction({ id: f.id, name: renameValue });
      if (!res.ok) return setError(res.error);
      setFranchises((prev) => prev.map((x) => (x.id === f.id ? res.data : x)).sort(byName));
      setRenamingId(null);
    });
  }

  function handleFranchiseUpdated(updated: FranchiseWithLinks) {
    setFranchises((prev) => prev.map((x) => (x.id === updated.id ? updated : x)).sort(byName));
  }

  function handleDelete() {
    const target = deleteTarget;
    if (!target) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteFranchiseAction({ id: target.id });
      setDeleteTarget(null);
      if (!res.ok) return setError(res.error);
      setFranchises((prev) => prev.filter((x) => x.id !== target.id));
    });
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="franchise-loading">
        Loading franchises…
      </p>
    );
  }

  if (loadError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {loadError}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {isDemo && (
        <p className="text-sm text-muted-foreground" data-testid="franchise-demo-note">
          Franchises are read-only in the shared demo.
        </p>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Create a franchise</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Franchise name"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                aria-label="Franchise name"
                data-testid="franchise-create-name"
              />
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                className="rounded-md border border-border bg-background px-2 text-sm"
                aria-label="Industry profile"
                data-testid="franchise-create-profile"
              >
                <option value="">No profile</option>
                {ALL_PROFILES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button
                onClick={handleCreate}
                disabled={pending || !name.trim()}
                data-testid="franchise-create-submit"
              >
                Create franchise
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The industry profile is optional. It sets the fallback benchmark family for clients
              linked to this franchise.
            </p>
          </CardContent>
        </Card>
      )}

      {franchises.length === 0 ? (
        <Card data-testid="franchise-empty-state">
          <CardHeader>
            <CardTitle>No franchises yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {canManage
                ? 'Create your first franchise above. Once created, you can link client workspaces to it and share corporate benchmark sets and a standard chart of accounts across them.'
                : 'A firm owner or admin can create franchises. Once created, they appear here with their benchmark sets and linked clients.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Franchises ({franchises.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {franchises.map((f) => {
              const isRenaming = renamingId === f.id;
              const openPanel = expanded && expanded.id === f.id ? expanded.panel : null;
              const benchmarksOpen = openPanel === 'benchmarks';
              const scoaOpen = openPanel === 'scoa';
              const scoaCount = f.config.scoa?.accounts.length ?? 0;
              return (
                <div
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  data-testid="franchise-row"
                >
                  {isRenaming ? (
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                        aria-label={`New name for ${f.name}`}
                        data-testid="franchise-rename-input"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={() => handleRename(f)}
                        disabled={pending || !renameValue.trim()}
                        data-testid="franchise-rename-save"
                      >
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRenamingId(null)}
                        disabled={pending}
                        data-testid="franchise-rename-cancel"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{f.name}</span>
                        <Badge variant={f.industryProfileId ? 'secondary' : 'outline'}>
                          {profileLabel(f.industryProfileId)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {f.linkedCount} linked client{f.linkedCount === 1 ? '' : 's'} ·{' '}
                          <span data-testid="franchise-benchmark-summary">{benchmarkSummary(f)}</span>
                          {f.config.scoa && (
                            <span data-testid="franchise-scoa-summary">
                              {' · SCOA: '}
                              {scoaCount} account{scoaCount === 1 ? '' : 's'}
                            </span>
                          )}
                          {' · Created '}
                          {new Date(f.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      {canManage && (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setExpanded(benchmarksOpen ? null : { id: f.id, panel: 'benchmarks' })
                            }
                            disabled={pending}
                            aria-expanded={benchmarksOpen}
                            data-testid="franchise-benchmarks-toggle"
                          >
                            {benchmarksOpen ? 'Hide benchmarks' : 'Benchmarks'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setExpanded(scoaOpen ? null : { id: f.id, panel: 'scoa' })}
                            disabled={pending}
                            aria-expanded={scoaOpen}
                            data-testid="franchise-scoa-toggle"
                          >
                            {scoaOpen ? 'Hide SCOA' : 'SCOA'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startRename(f)}
                            disabled={pending}
                            data-testid="franchise-rename"
                          >
                            Rename
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setDeleteTarget(f)}
                            disabled={pending}
                            data-testid="franchise-delete"
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                  {canManage && !isRenaming && openPanel && (
                    <div className="basis-full pt-1">
                      {openPanel === 'benchmarks' ? (
                        <BenchmarkSetPanel franchise={f} onUpdated={handleFranchiseUpdated} />
                      ) : (
                        <ScoaPanel franchise={f} onUpdated={handleFranchiseUpdated} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert" data-testid="franchise-error">
          {error}
        </p>
      )}

      {/* Delete confirmation — house dialog, destructive action */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this franchise?</DialogTitle>
            <DialogDescription>
              This permanently removes <strong>{deleteTarget?.name}</strong>, including its
              benchmark sets and corporate chart of accounts. Client workspaces are never
              deleted, and a franchise with linked clients cannot be removed until they are
              unlinked.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              data-testid="franchise-delete-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={handleDelete}
              data-testid="franchise-delete-confirm"
            >
              {pending ? 'Deleting…' : 'Delete franchise'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
