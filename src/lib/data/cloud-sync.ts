'use client';

/**
 * Client-side cloud write-through engine (Phase 2b).
 *
 * The Zustand store stays the single in-memory source of truth for the app.
 * This engine subscribes to it and, in cloud mode, debounce-persists any
 * workspace whose `updatedAt` has moved since we last saved it — so every
 * existing mutation (mapping drags, value edits, scenario tweaks, audit
 * entries) flows to Postgres with no changes to the call sites.
 *
 * Create and delete are handled EXPLICITLY at their call sites (they need the
 * DB-assigned uuid / a row removal), which call `noteCreated` / `noteDeleted`
 * here so the subscription doesn't double-persist or resurrect them.
 *
 * Only ids already known to exist in the cloud (seeded on hydrate, or added via
 * noteCreated) are written. Unknown ids are ignored — a workspace is never
 * auto-created by the subscription, which keeps writes idempotent.
 */

import { useWorkspaceStore } from '@/store/workspace-store';
import { saveWorkspace } from '@/lib/data/workspace-actions';
import type { ClientWorkspace } from '@/types';

const DEBOUNCE_MS = 800;

/** id -> the `updatedAt` we last successfully persisted (or are persisting). */
const syncedAt = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let unsubscribe: (() => void) | null = null;

/** Seed the known-persisted set from the freshly hydrated cloud workspaces and
 *  start listening for changes. Idempotent — safe to call once per session. */
export function startCloudSync(): void {
  const { workspaces } = useWorkspaceStore.getState();
  for (const ws of workspaces) syncedAt.set(ws.id, ws.updatedAt);

  if (unsubscribe) return; // already listening
  unsubscribe = useWorkspaceStore.subscribe((state) => {
    if (!state.cloudMode || state.accessLevel !== 'full') return;
    for (const ws of state.workspaces) {
      if (!syncedAt.has(ws.id)) continue; // not a known cloud row → ignore
      if (syncedAt.get(ws.id) === ws.updatedAt) continue; // unchanged
      scheduleSave(ws.id);
    }
  });
}

function scheduleSave(id: string): void {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void flushSave(id);
    }, DEBOUNCE_MS)
  );
}

async function flushSave(id: string): Promise<void> {
  const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === id);
  if (!ws) return; // deleted before flush
  const sending = ws.updatedAt;
  // Optimistically mark so rapid follow-on changes coalesce against this value.
  syncedAt.set(id, sending);
  const res = await saveWorkspace(ws);
  if (!res.ok) {
    // Leave the marker stale so the next store change retries the save.
    syncedAt.set(id, '');
    // eslint-disable-next-line no-console
    console.warn(`[cloud-sync] failed to save workspace ${id}: ${res.error}`);
  }
}

/** Record a workspace as freshly created in the cloud (with its uuid). */
export function noteCreated(ws: ClientWorkspace): void {
  syncedAt.set(ws.id, ws.updatedAt);
}

/** Record a workspace as deleted so the subscription won't try to persist it. */
export function noteDeleted(id: string): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  syncedAt.delete(id);
}

/** Record several workspaces as present in the cloud (e.g. after an import). */
export function noteHydrated(workspaces: ClientWorkspace[]): void {
  for (const ws of workspaces) syncedAt.set(ws.id, ws.updatedAt);
}
