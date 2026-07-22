'use client';

/**
 * QuickBooks backfill/sync runner. Two-phase flow:
 *
 *  1. Range step — pick how many years of history (1–10, default 3).
 *  2. Run step — planQboSync verifies the connection and returns calendar-year
 *     chunks; runQboSyncChunk is then called STRICTLY SERIALLY, one chunk at a
 *     time (Intuit throttles per realm — parallelize across companies,
 *     serialize within one; see QBO_INTEGRATION_PLAN.md §1). Raw report
 *     payloads accumulate client-side and the pure transform runs ONCE over
 *     everything at the end (plan §2.2 — transform.ts is client-importable by
 *     design; nothing else under src/lib/qbo may be imported here).
 *
 * Failure handling: needs_reauth shows an inline reconnect panel; errors show
 * the message with a Retry that resumes FROM THE FAILED CHUNK (already-fetched
 * chunks are kept). Cancel/close aborts cleanly between chunks — the in-flight
 * request resolves into the void.
 */

import { useRef, useState } from 'react';
import type { Account, AccountValue } from '@/types';
import type { QboAccount, QboReport } from '@/lib/qbo/qbo-types';
import {
  planQboSync,
  runQboSyncChunk,
  type QboPlanResult,
  type QboSyncChunk,
  type QboSyncChunkResult,
} from '@/lib/data/qbo-actions';
import { transformQboData } from '@/lib/qbo/transform';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

export interface QboSyncResult {
  companyName: string;
  accounts: Account[];
  values: AccountValue[];
  warnings: string[];
}

type Step =
  | { kind: 'range' }
  | { kind: 'planning' }
  | { kind: 'running'; chunkIndex: number; total: number; year: number }
  | { kind: 'reauth' }
  | { kind: 'error'; message: string };

// Mirrors QBO_SYNC_YEARS_BACK_{MIN,MAX,DEFAULT} in src/lib/qbo/sync.ts (the
// server action clamps to the same range regardless).
const YEARS_BACK_DEFAULT = 3;
const YEARS_BACK_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

const NETWORK_ERROR = 'Could not reach QuickBooks — check your connection and retry.';

export function QboSyncDialog({
  clientId,
  open,
  onOpenChange,
  onComplete,
}: {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (r: QboSyncResult) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'range' });
  const [yearsBack, setYearsBack] = useState(YEARS_BACK_DEFAULT);

  const planRef = useRef<{ companyName: string; chunks: QboSyncChunk[] } | null>(null);
  const collectedRef = useRef<{
    pnl: QboReport[];
    bs: QboReport[];
    coa: QboAccount[];
    nextChunk: number;
  }>({ pnl: [], bs: [], coa: [], nextChunk: 0 });
  const cancelRef = useRef(false);
  const busyRef = useRef(false);

  /** Every close path funnels here: flag cancellation so an in-flight loop
   *  stops between chunks, reset to a fresh range step for the next open,
   *  and close. (All closes go through our handlers, so no open-effect is
   *  needed — and the next open always starts clean.) */
  function closeAndReset(): void {
    cancelRef.current = true;
    planRef.current = null;
    collectedRef.current = { pnl: [], bs: [], coa: [], nextChunk: 0 };
    setStep({ kind: 'range' });
    setYearsBack(YEARS_BACK_DEFAULT);
    onOpenChange(false);
  }

  function finish(): void {
    const plan = planRef.current;
    if (!plan) return;
    const { pnl, bs, coa } = collectedRef.current;
    // Transform ONCE over all accumulated chunks (pure, client-side).
    const result = transformQboData({ coa, pnlReports: pnl, bsReports: bs });
    closeAndReset();
    onComplete({
      companyName: plan.companyName,
      accounts: result.accounts,
      values: result.values,
      warnings: result.warnings,
    });
  }

  async function runChunks(): Promise<void> {
    const plan = planRef.current;
    if (!plan) return;
    for (let i = collectedRef.current.nextChunk; i < plan.chunks.length; i++) {
      if (cancelRef.current) return;
      const chunk = plan.chunks[i]!;
      setStep({ kind: 'running', chunkIndex: i, total: plan.chunks.length, year: chunk.year });
      let res: QboSyncChunkResult;
      try {
        // SERIAL await on purpose — never parallelize chunks for one realm.
        res = await runQboSyncChunk(
          clientId,
          { year: chunk.year, startDate: chunk.startDate, endDate: chunk.endDate },
          { includeCoa: i === 0 }
        );
      } catch {
        res = { ok: false, reason: 'error', message: NETWORK_ERROR };
      }
      if (cancelRef.current) return;
      if (!res.ok) {
        collectedRef.current.nextChunk = i; // retry resumes here
        if (res.reason === 'needs_reauth') setStep({ kind: 'reauth' });
        else setStep({ kind: 'error', message: res.message });
        return;
      }
      collectedRef.current.pnl.push(res.pnl);
      collectedRef.current.bs.push(res.bs);
      if (res.coa) collectedRef.current.coa = res.coa;
      collectedRef.current.nextChunk = i + 1;
    }
    finish();
  }

  async function begin(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    cancelRef.current = false;
    try {
      if (!planRef.current) {
        setStep({ kind: 'planning' });
        let plan: QboPlanResult;
        try {
          plan = await planQboSync(clientId, { yearsBack });
        } catch {
          plan = { ok: false, reason: 'error', message: NETWORK_ERROR };
        }
        if (cancelRef.current) return;
        if (!plan.ok) {
          if (plan.reason === 'needs_reauth') setStep({ kind: 'reauth' });
          else setStep({ kind: 'error', message: plan.message });
          return;
        }
        planRef.current = { companyName: plan.companyName, chunks: plan.chunks };
      }
      await runChunks();
    } finally {
      busyRef.current = false;
    }
  }

  function handleCancel(): void {
    closeAndReset();
  }

  function handleReconnect(): void {
    // Full navigation, not fetch — the connect endpoint 302s to Intuit.
    window.location.assign('/api/qbo/connect?workspaceId=' + encodeURIComponent(clientId));
  }

  const running = step.kind === 'planning' || step.kind === 'running';
  const progressPct =
    step.kind === 'running' && step.total > 0
      ? Math.round((step.chunkIndex / step.total) * 100)
      : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Backdrop / Escape / X — treat exactly like Cancel.
        if (!o) closeAndReset();
        else onOpenChange(o);
      }}
    >
      <DialogContent data-testid="qbo-sync-dialog">
        <DialogHeader>
          <DialogTitle>Sync from QuickBooks</DialogTitle>
          {step.kind === 'range' && (
            <DialogDescription>
              Pull monthly history straight from QuickBooks into this workspace. You review every
              change before anything is saved.
            </DialogDescription>
          )}
        </DialogHeader>

        {step.kind === 'range' && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <label
                htmlFor="qbo-years-back"
                className="text-sm font-medium"
                style={{ color: 'hsl(var(--foreground))' }}
              >
                How much history?
              </label>
              <select
                id="qbo-years-back"
                data-testid="qbo-years-select"
                value={yearsBack}
                onChange={(e) => setYearsBack(Number(e.target.value))}
                className="rounded-md border px-2 py-1.5 text-sm cursor-pointer"
                style={{
                  borderColor: 'hsl(var(--border))',
                  background: 'hsl(var(--card))',
                  color: 'hsl(var(--foreground))',
                }}
              >
                {YEARS_BACK_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? 'Last year' : `Last ${n} years`}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Monthly P&amp;L + Balance Sheet, chunked one year per request.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancel} data-testid="qbo-sync-cancel">
                Cancel
              </Button>
              <Button onClick={() => void begin()} data-testid="qbo-sync-start">
                Start sync
              </Button>
            </DialogFooter>
          </>
        )}

        {running && (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-sm" style={{ color: 'hsl(var(--foreground))' }} aria-live="polite">
                {step.kind === 'planning'
                  ? 'Contacting QuickBooks…'
                  : `Fetching chunk ${step.chunkIndex + 1} of ${step.total} · ${step.year}`}
              </p>
              <Progress value={progressPct} />
              <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                One year per request, run one at a time — QuickBooks requires it.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancel} data-testid="qbo-sync-cancel">
                Cancel
              </Button>
            </DialogFooter>
          </>
        )}

        {step.kind === 'reauth' && (
          <>
            <div
              className="rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: 'hsl(38 92% 50% / 0.4)',
                background: 'hsl(38 92% 50% / 0.06)',
                color: 'hsl(32 81% 29%)',
              }}
              data-testid="qbo-reauth-panel"
            >
              QuickBooks needs to be reconnected before FinSight can sync.
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancel}>
                Close
              </Button>
              <Button onClick={handleReconnect} data-testid="qbo-reconnect-btn">
                Reconnect QuickBooks
              </Button>
            </DialogFooter>
          </>
        )}

        {step.kind === 'error' && (
          <>
            <div
              className="rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: 'hsl(0 72% 51% / 0.4)',
                background: 'hsl(0 72% 51% / 0.06)',
                color: 'hsl(0 72% 41%)',
              }}
              data-testid="qbo-error-panel"
            >
              {step.message}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button onClick={() => void begin()} data-testid="qbo-sync-retry">
                Retry
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
