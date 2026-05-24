'use client';

import React, { use, useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useWorkspaceStore } from '@/store/workspace-store';
import { getProfile } from '@/lib/profiles';
import { classifyAll, applyClassification } from '@/lib/classifiers';
import {
  MappingToolbar,
  MappingViewA,
  MappingViewB,
} from '@/components/mapping';
import type { Account, AuditEntry, MappingMemoryEntry } from '@/types';

interface PageProps {
  params: Promise<{ clientId: string }>;
}

export default function MappingPage({ params }: PageProps) {
  const { clientId } = use(params);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useWorkspaceStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useWorkspaceStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);

  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === clientId));
  const batchUpdateAccounts = useWorkspaceStore((s) => s.batchUpdateAccounts);
  const appendAuditEntry = useWorkspaceStore((s) => s.appendAuditEntry);
  const rememberMapping = useWorkspaceStore((s) => s.rememberMapping);

  const [view, setView] = useState<'type' | 'behavior'>('type');
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleAccountsChange = useCallback(
    (accounts: Account[]) => {
      batchUpdateAccounts(clientId, accounts);
    },
    [clientId, batchUpdateAccounts]
  );

  const handleAuditEntry = useCallback(
    (entry: AuditEntry) => {
      appendAuditEntry(clientId, entry);
    },
    [clientId, appendAuditEntry]
  );

  const handleRememberMapping = useCallback(
    (entry: MappingMemoryEntry) => {
      rememberMapping(entry);
    },
    [rememberMapping]
  );

  const handleReset = useCallback(() => {
    if (!workspace) return;
    const profile = getProfile(workspace.industryProfileId);
    const results = classifyAll(workspace.accounts, profile);
    const updatedAccounts = workspace.accounts.map((account) => {
      if (!account.isManuallyClassified) return account;
      const result = results.get(account.id);
      if (!result) return { ...account, isManuallyClassified: false };
      // Clear manual flag so applyClassification runs
      const cleared: Account = { ...account, isManuallyClassified: false };
      return applyClassification(cleared, result);
    });

    const manualCount = workspace.accounts.filter((a) => a.isManuallyClassified).length;

    // Audit entry for reset
    const resetEntry: AuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date().toISOString(),
      accountId: 'batch',
      accountName: `${manualCount} accounts`,
      action: 'reset_to_auto',
      previousValue: 'manual',
      newValue: 'auto',
      performedBy: 'user',
    };

    batchUpdateAccounts(clientId, updatedAccounts);
    appendAuditEntry(clientId, resetEntry);
    showToast(`${manualCount} account${manualCount !== 1 ? 's' : ''} reclassified`);
  }, [workspace, clientId, batchUpdateAccounts, appendAuditEntry]);

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'hsl(var(--background))' }}>
        <div className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'hsl(var(--primary))' }} />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'hsl(var(--background))' }}
      >
        <div className="text-center space-y-4">
          <p className="text-4xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
            404
          </p>
          <p className="text-lg" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Workspace not found
          </p>
          <Link
            href="/"
            className="inline-flex text-sm font-medium underline underline-offset-2"
            style={{ color: 'hsl(var(--primary))' }}
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const profile = getProfile(workspace.industryProfileId);
  const manualCount = workspace.accounts.filter((a) => a.isManuallyClassified).length;

  // An account is "reviewed" if it was manually classified OR has high/medium confidence.
  // Once all accounts are reviewed, show the "Ready to analyze" banner.
  const unreviewedCount = workspace.accounts.filter(
    (a) =>
      !a.isManuallyClassified &&
      (a.classificationConfidence === 'low' || a.classificationConfidence === undefined)
  ).length;
  const allReviewed = unreviewedCount === 0 && workspace.accounts.length > 0;

  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--background))' }}>
      {/* Header */}
      <header
        className="border-b px-6 py-4"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/workspace/${clientId}`}
              className="text-sm font-medium transition-colors"
              style={{ color: 'hsl(var(--muted-foreground))' }}
            >
              ← {workspace.name}
            </Link>
            <span style={{ color: 'hsl(var(--border))' }}>/</span>
            <div className="flex items-center gap-2">
              <span className="text-lg">{profile.icon ?? '🗂️'}</span>
              <div>
                <h1 className="text-base font-bold" style={{ color: 'hsl(var(--foreground))' }}>
                  Account Mapping
                </h1>
                <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  {workspace.accounts.length} accounts · {profile.name}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="px-6 py-6">
        <div className="flex flex-col gap-4">
          <MappingToolbar
            view={view}
            onViewChange={setView}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onReset={handleReset}
            totalAccounts={workspace.accounts.length}
            manualCount={manualCount}
            auditEntries={workspace.auditLog}
          />

          {view === 'type' ? (
            <MappingViewA
              workspace={workspace}
              onAccountsChange={handleAccountsChange}
              onAuditEntry={handleAuditEntry}
              onRememberMapping={handleRememberMapping}
            />
          ) : (
            <MappingViewB
              workspace={workspace}
              onAccountsChange={handleAccountsChange}
              onAuditEntry={handleAuditEntry}
              onRememberMapping={handleRememberMapping}
            />
          )}

          {/* Ready-to-analyze banner — appears once all accounts have been reviewed */}
          {allReviewed && (
            <div
              className="mt-4 flex items-center justify-between rounded-xl border px-5 py-4"
              style={{
                borderColor: 'hsl(142 76% 36% / 0.4)',
                background: 'hsl(142 76% 36% / 0.06)',
              }}
            >
              <div>
                <p className="text-sm font-semibold" style={{ color: 'hsl(142 76% 28%)' }}>
                  ✓ All accounts reviewed
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'hsl(142 76% 34%)' }}>
                  Your account mapping is complete and ready for financial analysis.
                </p>
              </div>
              <Link
                href={`/workspace/${clientId}/reports`}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
                style={{
                  background: 'hsl(142 76% 36%)',
                  color: '#fff',
                }}
              >
                View Reports →
              </Link>
            </div>
          )}
        </div>
      </main>

      {/* Toast notification */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg border px-5 py-3 shadow-lg text-sm font-medium"
          style={{
            background: 'hsl(var(--card))',
            borderColor: 'hsl(142 76% 36% / 0.5)',
            color: 'hsl(142 76% 28%)',
            animation: 'fadeInUp 0.2s ease',
          }}
          role="status"
          aria-live="polite"
        >
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
