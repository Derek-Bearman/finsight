/**
 * Zustand workspace store with localStorage persistence.
 * Supabase persistence will be added in a later phase.
 *
 * Privacy mode: when enabled at runtime (via setPrivacyMode), writes are
 * suppressed and any existing persisted data is wiped from localStorage.
 * In-memory Zustand state continues to work — but nothing survives a tab
 * close or page refresh. Useful for shared/public computers or one-off
 * demos. The preference itself is intentionally NOT persisted: users opt
 * in fresh per session.
 */

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type {
  ClientWorkspace,
  Account,
  AccountValue,
  MappingMemoryEntry,
  AuditEntry,
  Scenario,
  OperationalDataPoint,
} from '@/types';
import type { AccessLevel } from '@/lib/billing/access';

// ─────────────────────────────────────────────
// Privacy mode + conditional storage adapter
// ─────────────────────────────────────────────

const PERSIST_KEY = 'finsight-workspaces';

/**
 * Module-level flag that the storage adapter checks on every write. When
 * true, writes are dropped silently. Reads still work (so if you toggle
 * privacy mode AFTER loading data, the data stays in memory until you
 * close the tab).
 */
let privacyModeEnabled = false;

/**
 * Module-level flag set once the app enters cloud (firm) mode. When true the
 * storage adapter drops writes to localStorage — the firm's workspaces live in
 * Postgres and must NOT be mirrored into the browser (that's the whole point of
 * the SaaS move + the privacy positioning). Reads still work, so the one-time
 * first-login import prompt can still see any pre-cloud `finsight-workspaces`
 * data until the user imports or dismisses it.
 */
let cloudModeEnabled = false;

/** Returns the current privacy-mode state. Cheap synchronous read. */
export function isPrivacyMode(): boolean {
  return privacyModeEnabled;
}

/** True once the app is firm-aware (cloud persistence active). */
export function isCloudMode(): boolean {
  return cloudModeEnabled;
}

/**
 * Enable / disable privacy mode at runtime.
 * Enabling wipes the persisted store from localStorage immediately so the
 * data trail is gone the moment the user opts in.
 */
export function setPrivacyMode(on: boolean): void {
  privacyModeEnabled = on;
  if (on && typeof window !== 'undefined') {
    try {
      localStorage.removeItem(PERSIST_KEY);
    } catch {
      // Ignore — localStorage may be unavailable (e.g. Safari private mode)
    }
  }
}

const conditionalStorage: StateStorage = {
  getItem: (name) => {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    if (typeof window === 'undefined') return;
    if (privacyModeEnabled) return; // privacy mode → swallow the write
    if (cloudModeEnabled) return; // cloud mode → Postgres is the source of truth
    try {
      localStorage.setItem(name, value);
    } catch {
      // Ignore quota errors etc. — better to lose persistence than crash
    }
  },
  removeItem: (name) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(name);
    } catch {
      // Ignore
    }
  },
};

interface WorkspaceState {
  workspaces: ClientWorkspace[];
  activeWorkspaceId: string | null;
  mappingMemory: MappingMemoryEntry[];
  activeScenarioId: string | null;

  // ── Cloud (firm) mode ──────────────────────────────────────────────────────
  /** True once the app has resolved an active firm and is persisting to Postgres. */
  cloudMode: boolean;
  /** True once the firm's workspaces have been loaded from Postgres. Both app
   *  pages gate their first render on this so they never flash empty/404. */
  cloudHydrated: boolean;
  /** Active firm + user for write-through, and the billing access level. */
  firmId: string | null;
  currentUserId: string | null;
  accessLevel: AccessLevel;
}

interface WorkspaceActions {
  // Cloud mode
  enterCloudMode: (opts: { firmId: string; userId: string; accessLevel: AccessLevel }) => void;
  hydrateFromCloud: (workspaces: ClientWorkspace[]) => void;

  // Workspace CRUD
  addWorkspace: (workspace: ClientWorkspace) => void;
  updateWorkspace: (id: string, patch: Partial<ClientWorkspace>) => void;
  deleteWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string | null) => void;

  // Account management
  updateAccount: (workspaceId: string, account: Account) => void;
  batchUpdateAccounts: (workspaceId: string, accounts: Account[]) => void;

  // Values
  setValues: (workspaceId: string, values: AccountValue[]) => void;

  // Scenarios
  addScenario: (workspaceId: string, scenario: Scenario) => void;
  updateScenario: (workspaceId: string, scenario: Scenario) => void;
  deleteScenario: (workspaceId: string, scenarioId: string) => void;
  setActiveScenario: (id: string | null) => void;

  // Operational data
  setOperationalData: (workspaceId: string, data: OperationalDataPoint[]) => void;
  upsertOperationalDataPoint: (workspaceId: string, point: OperationalDataPoint) => void;

  // Audit log
  appendAuditEntry: (workspaceId: string, entry: AuditEntry) => void;

  // Mapping memory (cross-client classification memory, scoped per profile)
  rememberMapping: (entry: MappingMemoryEntry) => void;
  recallMapping: (accountNameNormalized: string, profileId: string) => MappingMemoryEntry | undefined;

  // Switch industry profile (preserves manual overrides)
  switchProfile: (workspaceId: string, newProfileId: string) => void;

  // Getters
  getWorkspace: (id: string) => ClientWorkspace | undefined;
  getActiveWorkspace: () => ClientWorkspace | undefined;
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions;

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      // ── Initial state ──────────────────────────────────────────────────────
      workspaces: [],
      activeWorkspaceId: null,
      mappingMemory: [],
      activeScenarioId: null,

      cloudMode: false,
      cloudHydrated: false,
      firmId: null,
      currentUserId: null,
      accessLevel: 'full',

      // ── Cloud mode ─────────────────────────────────────────────────────────
      enterCloudMode: ({ firmId, userId, accessLevel }) => {
        // Flip the module flag FIRST so the persist middleware's write for this
        // very state change is dropped — the pre-cloud localStorage data stays
        // intact for the one-time import prompt to read.
        cloudModeEnabled = true;
        set({ cloudMode: true, firmId, currentUserId: userId, accessLevel });
      },

      // Replace the (possibly stale localStorage-hydrated) workspace list with
      // the firm's authoritative rows from Postgres.
      hydrateFromCloud: (workspaces) =>
        set({ workspaces, cloudHydrated: true }),

      // ── Workspace CRUD ─────────────────────────────────────────────────────
      addWorkspace: (workspace) =>
        set((s) => ({ workspaces: [...s.workspaces, workspace] })),

      updateWorkspace: (id, patch) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === id ? { ...w, ...patch, updatedAt: new Date().toISOString() } : w
          ),
        })),

      deleteWorkspace: (id) =>
        set((s) => ({
          workspaces: s.workspaces.filter((w) => w.id !== id),
          activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
        })),

      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

      // ── Account management ─────────────────────────────────────────────────
      updateAccount: (workspaceId, account) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === workspaceId
              ? {
                  ...w,
                  updatedAt: new Date().toISOString(),
                  accounts: w.accounts.map((a) => (a.id === account.id ? account : a)),
                }
              : w
          ),
        })),

      batchUpdateAccounts: (workspaceId, accounts) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === workspaceId
              ? { ...w, accounts, updatedAt: new Date().toISOString() }
              : w
          ),
        })),

      // ── Values ─────────────────────────────────────────────────────────────
      setValues: (workspaceId, values) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === workspaceId
              ? { ...w, values, updatedAt: new Date().toISOString() }
              : w
          ),
        })),

      // ── Scenarios ──────────────────────────────────────────────────────────
      addScenario: (workspaceId, scenario) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === workspaceId
              ? { ...w, scenarios: [...w.scenarios, scenario], updatedAt: new Date().toISOString() }
              : w
          ),
        })),

      updateScenario: (workspaceId, scenario) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === workspaceId
              ? {
                  ...w,
                  scenarios: w.scenarios.map((sc) => (sc.id === scenario.id ? scenario : sc)),
                  updatedAt: new Date().toISOString(),
                }
              : w
          ),
        })),

      deleteScenario: (workspaceId, scenarioId) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === workspaceId
              ? {
                  ...w,
                  scenarios: w.scenarios.filter((sc) => sc.id !== scenarioId),
                  updatedAt: new Date().toISOString(),
                }
              : w
          ),
        })),

      setActiveScenario: (id) => set({ activeScenarioId: id }),

      // ── Operational data ───────────────────────────────────────────────────
      setOperationalData: (workspaceId, data) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === workspaceId
              ? { ...w, operationalData: data, updatedAt: new Date().toISOString() }
              : w
          ),
        })),

      upsertOperationalDataPoint: (workspaceId, point) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => {
            if (w.id !== workspaceId) return w;
            const idx = w.operationalData.findIndex(
              (d) =>
                d.metricDefId === point.metricDefId &&
                d.period.year === point.period.year &&
                d.period.month === point.period.month
            );
            const newData =
              idx >= 0
                ? w.operationalData.map((d, i) => (i === idx ? point : d))
                : [...w.operationalData, point];
            return { ...w, operationalData: newData, updatedAt: new Date().toISOString() };
          }),
        })),

      // ── Audit log ──────────────────────────────────────────────────────────
      appendAuditEntry: (workspaceId, entry) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === workspaceId
              ? { ...w, auditLog: [...w.auditLog, entry], updatedAt: new Date().toISOString() }
              : w
          ),
        })),

      // ── Mapping memory ─────────────────────────────────────────────────────
      rememberMapping: (entry) =>
        set((s) => {
          const existing = s.mappingMemory.findIndex(
            (m) =>
              m.accountNameNormalized === entry.accountNameNormalized &&
              m.profileId === entry.profileId
          );
          const newMemory =
            existing >= 0
              ? s.mappingMemory.map((m, i) => (i === existing ? entry : m))
              : [...s.mappingMemory, entry];
          return { mappingMemory: newMemory };
        }),

      recallMapping: (accountNameNormalized, profileId) =>
        get().mappingMemory.find(
          (m) =>
            m.accountNameNormalized === accountNameNormalized && m.profileId === profileId
        ),

      // ── Profile switch ─────────────────────────────────────────────────────
      switchProfile: (workspaceId, newProfileId) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => {
            if (w.id !== workspaceId) return w;
            // Reset auto-classified accounts; preserve manual overrides
            const accounts = w.accounts.map((a) =>
              a.isManuallyClassified
                ? a
                : { ...a, classificationSource: undefined as never, classificationConfidence: undefined }
            );
            return {
              ...w,
              industryProfileId: newProfileId,
              accounts,
              updatedAt: new Date().toISOString(),
            };
          }),
        })),

      // ── Getters ────────────────────────────────────────────────────────────
      getWorkspace: (id) => get().workspaces.find((w) => w.id === id),

      getActiveWorkspace: () => {
        const { activeWorkspaceId, workspaces } = get();
        return workspaces.find((w) => w.id === activeWorkspaceId);
      },
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => conditionalStorage),
    }
  )
);
