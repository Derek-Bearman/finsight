/**
 * Zustand workspace store with localStorage persistence.
 * Supabase persistence will be added in a later phase.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  ClientWorkspace,
  Account,
  AccountValue,
  MappingMemoryEntry,
  AuditEntry,
  Scenario,
  OperationalDataPoint,
} from '@/types';

interface WorkspaceState {
  workspaces: ClientWorkspace[];
  activeWorkspaceId: string | null;
  mappingMemory: MappingMemoryEntry[];
  activeScenarioId: string | null;
}

interface WorkspaceActions {
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
      name: 'finsight-workspaces',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
