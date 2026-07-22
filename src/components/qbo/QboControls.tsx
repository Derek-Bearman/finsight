'use client';

/**
 * Toolbar control for the QuickBooks Online connection on the Statements tab.
 * Renders the whole connection lifecycle in one compact spot:
 *
 *  - loading          → subtle skeleton chip
 *  - not connected    → "Connect QuickBooks" (owner/admin only; nothing for
 *                       members — connecting an external books feed is admin
 *                       surface, plan §2.11)
 *  - active           → green chip (company · last sync) + Sync / Disconnect
 *  - needs_reauth     → amber "Reconnect needed" chip + Reconnect
 *  - error            → red-tinted chip (title = last sync error) + Sync retry
 *  - mock mode        → "(mock)" marker so dev flows are unmistakable
 *
 * Connect/reconnect are FULL navigations to /api/qbo/connect (it 302s to
 * Intuit — fetch would eat the redirect). Disconnect confirms via the house
 * dialog, then calls the server action and refreshes status; failures toast,
 * never throw. Sync data flows up through onSyncData for the Statements
 * review flow to diff/commit.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Account, AccountValue } from '@/types';
import {
  disconnectQbo,
  getQboStatus,
  type QboStatusResult,
} from '@/lib/data/qbo-actions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { QboSyncDialog } from './QboSyncDialog';

export interface QboSyncData {
  companyName: string;
  accounts: Account[];
  values: AccountValue[];
  warnings: string[];
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" — chip-sized relative time. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function ChipDot({ color }: { color: string }) {
  return (
    <span aria-hidden className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: color }} />
  );
}

const SMALL_BTN =
  'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer';

export function QboControls({
  clientId,
  onSyncData,
  autoOpenSync = false,
  refreshKey = 0,
  onStatusChange,
}: {
  clientId: string;
  onSyncData: (r: QboSyncData) => void;
  /** First-connect UX: auto-open the sync dialog once when eligible
   *  (set by the workspace page on a ?qbo=connected landing). */
  autoOpenSync?: boolean;
  /** Bump to re-fetch status (e.g. after completeQboSync stamps the row). */
  refreshKey?: number;
  /** Lets the parent know connection state (Statements empty-state nicety). */
  onStatusChange?: (s: QboStatusResult) => void;
}) {
  const [status, setStatus] = useState<QboStatusResult | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null);
  // Event handlers bump this to re-run the status fetch (single fetch path).
  const [localRefresh, setLocalRefresh] = useState(0);
  const autoOpenedRef = useRef(false);
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const showToast = (msg: string, tone: 'success' | 'error') => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 3500);
  };

  const refresh = useCallback(() => setLocalRefresh((k) => k + 1), []);

  useEffect(() => {
    let stale = false;
    (async () => {
      let s: QboStatusResult;
      try {
        s = await getQboStatus(clientId);
      } catch {
        // Fail closed: render as disconnected with no manage affordances.
        s = {
          connected: false,
          companyName: null,
          status: null,
          lastSyncedAt: null,
          lastSyncError: null,
          canManage: false,
          mockMode: false,
        };
      }
      if (stale) return;
      setStatus(s);
      onStatusChangeRef.current?.(s);
      // First-connect UX: auto-open the sync dialog exactly once, and only
      // when the freshly-loaded status actually supports syncing.
      if (
        autoOpenSync &&
        !autoOpenedRef.current &&
        s.connected &&
        s.canManage &&
        s.status === 'active'
      ) {
        autoOpenedRef.current = true;
        setSyncOpen(true);
      }
    })();
    return () => {
      stale = true;
    };
  }, [clientId, refreshKey, localRefresh, autoOpenSync]);

  const goConnect = () => {
    // Full navigation — /api/qbo/connect 302s to Intuit's consent screen.
    window.location.assign('/api/qbo/connect?workspaceId=' + encodeURIComponent(clientId));
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await disconnectQbo(clientId);
      if (res.ok) {
        showToast('QuickBooks disconnected — imported data kept', 'success');
      } else {
        showToast(res.reason, 'error');
      }
    } catch {
      showToast('Failed to disconnect QuickBooks — try again.', 'error');
    }
    setDisconnecting(false);
    setDisconnectOpen(false);
    refresh();
  };

  // ── Render branches ────────────────────────────────────────────────────────

  if (status === null) {
    return (
      <span
        aria-hidden
        data-testid="qbo-chip-skeleton"
        className="inline-block h-7 w-36 animate-pulse rounded-full"
        style={{ background: 'hsl(var(--muted))' }}
      />
    );
  }

  if (!status.connected) {
    if (!status.canManage) return null;
    return (
      <button
        type="button"
        data-testid="qbo-connect-btn"
        onClick={goConnect}
        className={SMALL_BTN + ' hover:bg-muted'}
        style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
        title="Connect this workspace to a QuickBooks Online company"
      >
        Connect QuickBooks
      </button>
    );
  }

  const mockSuffix = status.mockMode ? ' (mock)' : '';
  const companyName = status.companyName ?? 'QuickBooks';
  const needsReauth = status.status === 'needs_reauth' || status.status === 'revoked';
  const hasError = status.status === 'error';

  let chip: React.ReactNode;
  if (needsReauth) {
    chip = (
      <span
        data-testid="qbo-chip"
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
        style={{
          borderColor: 'hsl(38 92% 50% / 0.4)',
          background: 'hsl(38 92% 50% / 0.08)',
          color: 'hsl(32 81% 29%)',
        }}
        title={`${companyName} — the QuickBooks connection expired and must be re-authorized`}
      >
        <ChipDot color="hsl(38 92% 50%)" />
        <span className="truncate" style={{ maxWidth: 180 }}>
          {companyName}
          {mockSuffix} · Reconnect needed
        </span>
      </span>
    );
  } else if (hasError) {
    chip = (
      <span
        data-testid="qbo-chip"
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
        style={{
          borderColor: 'hsl(0 72% 51% / 0.4)',
          background: 'hsl(0 72% 51% / 0.06)',
          color: 'hsl(0 72% 41%)',
        }}
        title={status.lastSyncError ?? 'The last QuickBooks sync failed'}
      >
        <ChipDot color="hsl(0 72% 51%)" />
        <span className="truncate" style={{ maxWidth: 180 }}>
          {companyName}
          {mockSuffix} · Sync failed
        </span>
      </span>
    );
  } else {
    const syncedText = status.lastSyncedAt
      ? `Synced ${relativeTime(status.lastSyncedAt)}`
      : 'Never synced';
    chip = (
      <span
        data-testid="qbo-chip"
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
        style={{
          borderColor: 'hsl(142 71% 45% / 0.4)',
          background: 'hsl(142 71% 45% / 0.08)',
          color: 'hsl(142 71% 28%)',
        }}
        title={`Connected to ${companyName}${status.lastSyncedAt ? ` — last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : ''}`}
      >
        <ChipDot color="hsl(142 71% 45%)" />
        <span className="truncate" style={{ maxWidth: 180 }}>
          {companyName}
          {mockSuffix}
        </span>
        <span style={{ color: 'hsl(142 71% 35%)' }}>· {syncedText}</span>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {chip}

      {status.canManage && needsReauth && (
        <button
          type="button"
          data-testid="qbo-reconnect-btn"
          onClick={goConnect}
          className={SMALL_BTN}
          style={{ borderColor: 'hsl(38 92% 50% / 0.5)', color: 'hsl(32 81% 29%)' }}
        >
          Reconnect
        </button>
      )}

      {status.canManage && !needsReauth && (
        <>
          <button
            type="button"
            data-testid="qbo-sync-btn"
            onClick={() => setSyncOpen(true)}
            className={SMALL_BTN + ' hover:bg-muted'}
            style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
            title={hasError ? 'Retry the QuickBooks sync' : 'Pull the latest data from QuickBooks'}
          >
            Sync
          </button>
          <button
            type="button"
            data-testid="qbo-disconnect-btn"
            onClick={() => setDisconnectOpen(true)}
            className={SMALL_BTN + ' hover:bg-red-50'}
            style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--destructive))' }}
            title="Disconnect this workspace from QuickBooks"
          >
            Disconnect
          </button>
        </>
      )}

      <QboSyncDialog
        clientId={clientId}
        open={syncOpen}
        onOpenChange={(o) => {
          setSyncOpen(o);
          if (!o) refresh();
        }}
        onComplete={onSyncData}
      />

      {/* Disconnect confirmation — house dialog, destructive action */}
      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect QuickBooks?</DialogTitle>
            <DialogDescription>
              FinSight will revoke and delete its QuickBooks tokens for{' '}
              <strong>{companyName}</strong>. Data already imported into this workspace stays
              exactly as it is — only the live connection is removed. You can reconnect at any
              time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDisconnectOpen(false)}
              data-testid="qbo-disconnect-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="qbo-disconnect-confirm"
              disabled={disconnecting}
              onClick={() => void handleDisconnect()}
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg border px-5 py-3 shadow-lg text-sm font-medium"
          style={
            toast.tone === 'success'
              ? {
                  background: 'hsl(var(--card))',
                  borderColor: 'hsl(142 76% 36% / 0.5)',
                  color: 'hsl(142 76% 28%)',
                }
              : {
                  background: 'hsl(var(--card))',
                  borderColor: 'hsl(0 72% 51% / 0.4)',
                  color: 'hsl(0 72% 41%)',
                }
          }
          role="status"
          aria-live="polite"
        >
          {toast.tone === 'success' ? '✓ ' : ''}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
