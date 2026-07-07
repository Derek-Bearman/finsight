'use client';

/**
 * Client-side cloud write-through engine (Phase 2b, hardened by the 2026-07-07
 * audit fixes 3a-1/2/4).
 *
 * The Zustand store stays the single in-memory source of truth for the app.
 * This engine subscribes to it and, in cloud mode, debounce-persists any
 * workspace whose `updatedAt` has moved since we last saved it — so every
 * existing mutation (mapping drags, value edits, scenario tweaks, audit
 * entries) flows to Postgres with no changes to the call sites.
 *
 * Failure handling (nothing is silent):
 *  - every save publishes `syncStatus` to the store (header chip renders it);
 *  - transient failures retry with bounded exponential backoff;
 *  - optimistic-concurrency conflicts stop retrying and tell the user to
 *    reload (a teammate saved first — overwriting them would lose their work);
 *  - auth/billing refusals trigger an access re-resolve via the callback
 *    FirmAppGate registers, and surface a sign-in/billing message;
 *  - a beforeunload guard warns while anything is unsaved.
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
import { saveWorkspace, type SaveResult } from '@/lib/data/workspace-actions';
import type { AccessLevel } from '@/lib/billing/access';
import type { ClientWorkspace } from '@/types';

const DEBOUNCE_MS = 800;
const MAX_RETRIES = 5;
const BASE_RETRY_MS = 1000;

/** id -> the `updatedAt` we last successfully persisted. */
const syncedAt = new Map<string, string>();
/** ids with a save currently on the wire (never two at once per id). */
const inflight = new Set<string>();
/** ids that hit an optimistic-concurrency conflict — no further auto-saves. */
const conflicted = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryCounts = new Map<string, number>();

let unsubscribe: (() => void) | null = null;
let beforeUnloadInstalled = false;
let everSaved = false;
/** Sticky failure message shown until a success or manual retry. */
let errorMessage: string | null = null;

/** FirmAppGate registers this so a failed save can re-resolve the session's
 *  access level (billing flipped, session expired) without a full reload.
 *  Returns the fresh access level, or null if it couldn't be resolved. */
type AccessRefresher = () => Promise<AccessLevel | null>;
let accessRefresher: AccessRefresher | null = null;
export function registerAccessRefresher(fn: AccessRefresher): void {
  accessRefresher = fn;
}

function currentWorkspace(id: string): ClientWorkspace | undefined {
  return useWorkspaceStore.getState().workspaces.find((w) => w.id === id);
}

/** Workspaces whose latest change is not yet confirmed persisted. */
function pendingIds(): string[] {
  const { workspaces } = useWorkspaceStore.getState();
  return workspaces
    .filter((w) => syncedAt.has(w.id) && syncedAt.get(w.id) !== w.updatedAt)
    .map((w) => w.id);
}

export function hasUnsavedChanges(): boolean {
  return inflight.size > 0 || conflicted.size > 0 || pendingIds().length > 0;
}

function refreshStatus(): void {
  const store = useWorkspaceStore.getState();
  if (!store.cloudMode) return;
  const pendingCount = pendingIds().length;
  let phase: 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
  let message: string | null = null;
  // Error outranks conflict: a failing save on ANOTHER workspace must not be
  // masked by a conflicted one (Retry is the only way to reset its backoff).
  if (errorMessage) {
    phase = 'error';
    message = errorMessage;
  } else if (conflicted.size > 0) {
    phase = 'conflict';
    message = 'This client was changed by a teammate. Reload to see their changes — unsaved edits here will be lost.';
  } else if (inflight.size > 0 || timers.size > 0 || retryTimers.size > 0 || pendingCount > 0) {
    phase = 'saving';
  } else {
    phase = everSaved ? 'saved' : 'idle';
  }
  store.setSyncStatus({ phase, message, pendingCount });
}

/** Seed the known-persisted set from the freshly hydrated cloud workspaces and
 *  start listening for changes. Idempotent — safe to call once per session. */
export function startCloudSync(): void {
  const { workspaces } = useWorkspaceStore.getState();
  for (const ws of workspaces) syncedAt.set(ws.id, ws.updatedAt);

  if (typeof window !== 'undefined' && !beforeUnloadInstalled) {
    beforeUnloadInstalled = true;
    window.addEventListener('beforeunload', (e) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        // Chrome requires returnValue to be set; the text itself is ignored.
        e.returnValue = '';
      }
    });
  }

  if (unsubscribe) return; // already listening
  unsubscribe = useWorkspaceStore.subscribe((state) => {
    if (!state.cloudMode || state.accessLevel !== 'full') return;
    for (const ws of state.workspaces) {
      if (!syncedAt.has(ws.id)) continue; // not a known cloud row → ignore
      if (conflicted.has(ws.id)) continue; // stopped until the user reloads
      if (syncedAt.get(ws.id) === ws.updatedAt) continue; // unchanged
      scheduleSave(ws.id);
    }
  });
}

function scheduleSave(id: string, delayMs: number = DEBOUNCE_MS): void {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void flushSave(id);
    }, delayMs)
  );
  refreshStatus();
}

async function flushSave(id: string): Promise<void> {
  const ws = currentWorkspace(id);
  if (!ws) return; // deleted before flush
  if (conflicted.has(id)) return;
  if (inflight.has(id)) {
    // A save for this id is already on the wire; try again after it settles.
    scheduleSave(id);
    return;
  }
  if (syncedAt.get(id) === ws.updatedAt) {
    refreshStatus();
    return; // nothing new (an earlier flush already covered this change)
  }

  const sending = ws.updatedAt;
  inflight.add(id);
  refreshStatus();

  let res: SaveResult;
  try {
    res = await saveWorkspace(ws);
  } catch (err) {
    // Server action threw (network drop, worker restart) — treat as transient.
    res = {
      ok: false,
      error: err instanceof Error ? err.message : 'Save failed.',
      code: 'error',
    };
  }
  inflight.delete(id);

  // Deleted while the save was on the wire (noteDeleted cleared the id):
  // the row is gone, so a zero-row "conflict" here is just the delete —
  // don't resurrect the id or pin a false conflict banner.
  if (!syncedAt.has(id)) {
    refreshStatus();
    return;
  }

  if (res.ok) {
    syncedAt.set(id, sending);
    retryCounts.delete(id);
    errorMessage = null;
    everSaved = true;
    // Record the server-confirmed optimistic-concurrency version. Must not
    // touch updatedAt (that would re-trigger this engine in a loop).
    if (typeof res.data.cloudVersion === 'number') {
      useWorkspaceStore.getState().bumpCloudVersion(id, res.data.cloudVersion);
    }
    // If the user kept editing while the save was on the wire, chase the tail.
    const now = currentWorkspace(id);
    if (now && now.updatedAt !== sending) scheduleSave(id);
    refreshStatus();
    return;
  }

  switch (res.code) {
    case 'conflict':
      // A teammate's save won. Do NOT retry (that would clobber their work);
      // the chip offers a reload, which re-hydrates from Postgres.
      conflicted.add(id);
      break;

    case 'read_only':
    case 'locked':
    case 'unauthenticated': {
      errorMessage = res.error;
      // Re-resolve access: billing may have flipped mid-session, or the user
      // may have signed in again in another tab. If we're back to full
      // access, retry the save; otherwise leave the message standing.
      if (accessRefresher) {
        const level = await accessRefresher().catch(() => null);
        if (level === 'full') {
          errorMessage = null;
          scheduleSave(id, BASE_RETRY_MS);
        }
      }
      break;
    }

    default: {
      // Transient — bounded exponential backoff.
      const attempt = (retryCounts.get(id) ?? 0) + 1;
      retryCounts.set(id, attempt);
      if (attempt <= MAX_RETRIES) {
        const delay = BASE_RETRY_MS * 2 ** (attempt - 1);
        const t = setTimeout(() => {
          retryTimers.delete(id);
          void flushSave(id);
        }, delay);
        retryTimers.set(id, t);
      } else {
        errorMessage =
          'We can’t reach the server, so your latest changes are not saved. Check your connection, then press Retry.';
      }
    }
  }
  refreshStatus();
}

/** Manual retry (sync chip button): reset backoff and re-save everything dirty. */
export function retryUnsaved(): void {
  errorMessage = null;
  retryCounts.clear();
  for (const id of pendingIds()) {
    if (!conflicted.has(id)) scheduleSave(id, 0);
  }
  refreshStatus();
}

/** Record a workspace as freshly created in the cloud (with its uuid). */
export function noteCreated(ws: ClientWorkspace): void {
  syncedAt.set(ws.id, ws.updatedAt);
  refreshStatus();
}

/** Record a workspace as deleted so the subscription won't try to persist it. */
export function noteDeleted(id: string): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  const rt = retryTimers.get(id);
  if (rt) clearTimeout(rt);
  retryTimers.delete(id);
  retryCounts.delete(id);
  conflicted.delete(id);
  inflight.delete(id);
  syncedAt.delete(id);
  refreshStatus();
}

/** Record several workspaces as present in the cloud (e.g. after an import). */
export function noteHydrated(workspaces: ClientWorkspace[]): void {
  for (const ws of workspaces) syncedAt.set(ws.id, ws.updatedAt);
  refreshStatus();
}
