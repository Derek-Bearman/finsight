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
/** How often to re-resolve access while it is degraded (read_only/locked). */
const ACCESS_RECHECK_MS = 30_000;
/**
 * Refuse to put a save on the wire when the serialized workspace exceeds this.
 * Next's server-action body limit is 10mb (next.config.ts —
 * experimental.serverActions.bodySizeLimit; keep the two in step). ~9MB leaves
 * headroom for the action envelope around the JSON. Without this guard an
 * oversized workspace 413s on every attempt and the retry loop spins silently.
 */
const MAX_SAVE_BYTES = 9 * 1024 * 1024;

/** id -> the `updatedAt` we last successfully persisted. */
const syncedAt = new Map<string, string>();
/** ids with a save currently on the wire (never two at once per id). */
const inflight = new Set<string>();
/** ids that hit an optimistic-concurrency conflict — no further auto-saves. */
const conflicted = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryCounts = new Map<string, number>();
/** One-shot post-save callback plus the updatedAt watermark captured at
 *  registration (see onNextSuccessfulSave). Exported for the check suite. */
export interface NextSaveEntry {
  cb: () => void;
  /** The workspace's updatedAt when the callback was registered, or null when
   *  the workspace wasn't in the store. A save only satisfies this entry when
   *  its payload is at least this fresh. */
  notBefore: string | null;
}

/** id -> one-shot callbacks fired after the next successful save whose payload
 *  covers their watermark (see onNextSuccessfulSave). Discarded unfired if the
 *  workspace conflicts. */
const nextSaveCallbacks = new Map<string, NextSaveEntry[]>();

let unsubscribe: (() => void) | null = null;
let windowListenersInstalled = false;
/** Timer for the degraded-access re-resolve loop (at most one armed). */
let accessRecheckTimer: ReturnType<typeof setTimeout> | null = null;
let accessRecheckInflight = false;
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

/**
 * Degraded access (read_only/locked) must never permanently kill the sync
 * loop. The subscription gate skips all scheduling while accessLevel is not
 * 'full', and the only other path that re-resolves access — a refused save —
 * becomes unreachable once the editors go inert and the header chip swaps to
 * its read-only variant. Without this loop, a mid-session billing flip left
 * the tab read-only forever (with its refused edits unsavable) even after
 * the Stripe webhook restored the firm to 'active'.
 *
 * So: while access is degraded, keep re-resolving it on a timer (and
 * immediately when the tab regains visibility — the natural moment right
 * after the user fixes billing elsewhere). The moment it comes back 'full',
 * clear the stale refusal message and save everything still pending.
 * Idempotent — at most one timer is ever armed.
 */
function ensureAccessRecheck(delayMs: number = ACCESS_RECHECK_MS): void {
  if (accessRecheckTimer !== null) return;
  const state = useWorkspaceStore.getState();
  if (!state.cloudMode || state.accessLevel === 'full') return;
  accessRecheckTimer = setTimeout(() => {
    accessRecheckTimer = null;
    void recheckAccess();
  }, delayMs);
}

async function recheckAccess(): Promise<void> {
  if (accessRecheckInflight) return;
  const state = useWorkspaceStore.getState();
  if (!state.cloudMode) return;
  if (state.accessLevel !== 'full') {
    if (!accessRefresher) {
      ensureAccessRecheck(); // gate not registered yet — try again later
      return;
    }
    accessRecheckInflight = true;
    const level = await accessRefresher().catch(() => null);
    accessRecheckInflight = false;
    if (level !== 'full') {
      ensureAccessRecheck(); // still degraded — keep watching
      return;
    }
  }
  // Access is back. Same recovery as the manual Retry button: drop the stale
  // refusal message, reset backoff, and re-save everything still dirty.
  errorMessage = null;
  retryCounts.clear();
  for (const id of pendingIds()) {
    if (!conflicted.has(id)) scheduleSave(id, 0);
  }
  refreshStatus();
}

/**
 * Register a callback to run once, after the next save of `workspaceId` whose
 * PAYLOAD INCLUDES the store state as of registration is confirmed persisted.
 * Used for side effects that must not outrun the save — e.g. stamping qbo
 * last_synced_at only once the committed data actually exists in Postgres.
 *
 * The watermark matters: a debounced save can already be on the wire with a
 * snapshot captured BEFORE the registrant's mutation. That save's success must
 * not release the callback — the mutation rides the NEXT save, which can still
 * lose the optimistic-concurrency conflict. Each registration captures the
 * workspace's current updatedAt and only fires for a save at least that fresh.
 *
 * If the workspace instead enters the conflict state (a teammate's save won;
 * this data will never persist), the callback is discarded WITHOUT being
 * invoked. Multiple registrations all fire on the same successful save, in
 * registration order.
 */
export function onNextSuccessfulSave(workspaceId: string, cb: () => void): void {
  const list = nextSaveCallbacks.get(workspaceId) ?? [];
  list.push({ cb, notBefore: currentWorkspace(workspaceId)?.updatedAt ?? null });
  nextSaveCallbacks.set(workspaceId, list);
}

/**
 * True when a save whose payload carried `savedUpdatedAt` satisfies an entry
 * registered at watermark `notBefore` — i.e. the saved snapshot is at least as
 * fresh as the state the registrant was waiting on. Identical strings always
 * satisfy; otherwise the timestamps compare numerically, and an unparseable
 * side fails open (fire rather than strand the callback forever). Exported
 * for the check suite.
 */
export function saveCoversWatermark(savedUpdatedAt: string, notBefore: string | null): boolean {
  if (notBefore === null || savedUpdatedAt === notBefore) return true;
  const saved = Date.parse(savedUpdatedAt);
  const min = Date.parse(notBefore);
  if (Number.isNaN(saved) || Number.isNaN(min)) return true;
  return saved >= min;
}

/** Split entries into those a save with `savedUpdatedAt` releases and those
 *  still waiting on a fresher save. Pure — exported for the check suite. */
export function partitionNextSaveEntries(
  entries: NextSaveEntry[],
  savedUpdatedAt: string
): { ready: NextSaveEntry[]; waiting: NextSaveEntry[] } {
  const ready: NextSaveEntry[] = [];
  const waiting: NextSaveEntry[] = [];
  for (const e of entries) {
    (saveCoversWatermark(savedUpdatedAt, e.notBefore) ? ready : waiting).push(e);
  }
  return { ready, waiting };
}

/** Invoke the one-shot save callbacks the save with `savedUpdatedAt` releases
 *  (success path only); entries with a fresher watermark stay registered. */
function fireNextSaveCallbacks(id: string, savedUpdatedAt: string): void {
  const entries = nextSaveCallbacks.get(id);
  if (!entries) return;
  const { ready, waiting } = partitionNextSaveEntries(entries, savedUpdatedAt);
  if (waiting.length > 0) nextSaveCallbacks.set(id, waiting);
  else nextSaveCallbacks.delete(id);
  for (const e of ready) {
    try {
      e.cb();
    } catch {
      // A callback must never be able to break the save pipeline.
    }
  }
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

  if (typeof window !== 'undefined' && !windowListenersInstalled) {
    windowListenersInstalled = true;
    window.addEventListener('beforeunload', (e) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        // Chrome requires returnValue to be set; the text itself is ignored.
        e.returnValue = '';
      }
    });
    // Returning to the tab is the natural moment right after billing/auth was
    // fixed elsewhere — re-resolve degraded access immediately instead of
    // waiting out the poll timer.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const state = useWorkspaceStore.getState();
      if (!state.cloudMode || state.accessLevel === 'full') return;
      if (accessRecheckTimer !== null) {
        clearTimeout(accessRecheckTimer);
        accessRecheckTimer = null;
      }
      void recheckAccess();
    });
  }

  // A session can bootstrap already degraded (e.g. past_due grace) — start
  // watching for recovery right away.
  ensureAccessRecheck();

  if (unsubscribe) return; // already listening
  unsubscribe = useWorkspaceStore.subscribe((state) => {
    if (!state.cloudMode) return;
    if (state.accessLevel !== 'full') {
      // Never a permanent teardown: keep re-evaluating access so sync
      // resumes the moment billing/auth recovers.
      ensureAccessRecheck();
      return;
    }
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

  // Oversized payloads would 413 at the server-action boundary on EVERY
  // attempt — never a transient failure, so don't feed it to the retry loop.
  // Fail loudly through the same sticky-error path the chip already renders.
  const payloadBytes = new TextEncoder().encode(JSON.stringify(ws)).byteLength;
  if (payloadBytes > MAX_SAVE_BYTES) {
    console.warn(
      `[cloud-sync] Workspace ${id} serializes to ${(payloadBytes / 1024 / 1024).toFixed(1)}MB, ` +
        `over the ${Math.floor(MAX_SAVE_BYTES / 1024 / 1024)}MB save limit ` +
        `(server-action bodySizeLimit is 10mb in next.config.ts). Save refused.`
    );
    errorMessage =
      'This client’s data is too large to save. Remove unused datasets (Statements → Dataset) to shrink it, then press Retry.';
    refreshStatus();
    return;
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
    // The save is confirmed in Postgres — release the one-shot side effects
    // whose watermark this payload covers (e.g. the QBO last_synced_at
    // stamp). Entries registered after this payload was captured keep
    // waiting for the follow-up save scheduled below.
    fireNextSaveCallbacks(id, sending);
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
      // This data will never persist — waiting side effects must not fire
      // (stamping "synced" for a commit that was lost would be a lie).
      nextSaveCallbacks.delete(id);
      break;

    case 'read_only':
    case 'locked':
    case 'unauthenticated': {
      errorMessage = res.error;
      // Re-resolve access: billing may have flipped mid-session, or the user
      // may have signed in again in another tab. If we're back to full
      // access, retry the save; otherwise leave the message standing and
      // keep re-checking in the background — the subscription gate blocks
      // all scheduling while access is degraded, so without the recheck loop
      // this session (and its refused edits) would be stuck read-only
      // forever, even after billing recovers.
      const level = accessRefresher ? await accessRefresher().catch(() => null) : null;
      if (level === 'full') {
        errorMessage = null;
        scheduleSave(id, BASE_RETRY_MS);
      } else {
        ensureAccessRecheck();
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
  nextSaveCallbacks.delete(id);
  refreshStatus();
}

/** Record several workspaces as present in the cloud (e.g. after an import). */
export function noteHydrated(workspaces: ClientWorkspace[]): void {
  for (const ws of workspaces) syncedAt.set(ws.id, ws.updatedAt);
  refreshStatus();
}
