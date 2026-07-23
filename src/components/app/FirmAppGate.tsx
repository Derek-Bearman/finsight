'use client';

/**
 * Firm app gate (Phase 2b bootstrap). Wraps the whole app in the root layout,
 * but only takes over the two firm app routes — `/` and `/workspace/*`. On
 * those it resolves the user's firm once, routes accordingly, hydrates the
 * Zustand store from Postgres, starts cloud write-through, and provides the
 * firm/billing context to the page headers.
 *
 *   unauthenticated -> /login       (middleware also enforces this)
 *   onboarding      -> /onboarding
 *   active          -> hydrate + render (or a locked screen if billing locked)
 *
 * All other routes (/login, /onboarding, /team, /billing, /admin, /invite,
 * /auth/*) render untouched — they self-guard as server components.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWorkspaceStore } from '@/store/workspace-store';
import { loadFirmApp } from '@/lib/data/workspace-actions';
import { startCloudSync, registerAccessRefresher } from '@/lib/data/cloud-sync';
import { FirmProvider, type FirmContextValue } from '@/components/app/firm-context';
import { ImportPrompt } from '@/components/app/ImportPrompt';
import { BillingBanner } from '@/components/billing/BillingBanner';
import type { ClientWorkspace } from '@/types';

function isAppRoute(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/workspace');
}

const IMPORT_DISMISSED_PREFIX = 'finsight-import-dismissed:';

/** Read pre-cloud workspaces straight out of the Zustand-persist blob so the
 *  import prompt can offer them. Must run BEFORE enterCloudMode (which stops
 *  localStorage writes and keeps this data from being clobbered). */
function readLocalWorkspaces(): ClientWorkspace[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('finsight-workspaces');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { state?: { workspaces?: unknown } };
    const list = parsed?.state?.workspaces;
    return Array.isArray(list) ? (list as ClientWorkspace[]) : [];
  } catch {
    return [];
  }
}

function FullscreenSpinner() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'hsl(var(--background))' }}
    >
      <div
        className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: 'hsl(var(--primary))' }}
      />
    </div>
  );
}

export function FirmAppGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const appRoute = isAppRoute(pathname);

  const enterCloudMode = useWorkspaceStore((s) => s.enterCloudMode);
  const hydrateFromCloud = useWorkspaceStore((s) => s.hydrateFromCloud);

  const bootstrapped = useRef(false);
  const [firm, setFirm] = useState<FirmContextValue | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<ClientWorkspace[]>([]);

  useEffect(() => {
    if (!appRoute || bootstrapped.current) return;
    bootstrapped.current = true;

    (async () => {
      const app = await loadFirmApp();

      if (app.state === 'unauthenticated') {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      if (app.state === 'onboarding') {
        router.replace('/onboarding');
        return;
      }

      // Capture the browser's pre-cloud workspaces before we switch off local
      // persistence, so the one-time import prompt still has them.
      const local = readLocalWorkspaces();

      enterCloudMode({ firmId: app.firmId, userId: app.userId, accessLevel: app.access.level });
      hydrateFromCloud(app.workspaces);
      startCloudSync();

      // Let the sync engine re-resolve access when a save is refused (billing
      // flipped mid-session, session expired then renewed in another tab).
      // Updates access/banner state only — NEVER re-hydrates workspaces, which
      // would clobber the very unsaved edits the failed save is protecting.
      registerAccessRefresher(async () => {
        const fresh = await loadFirmApp();
        if (fresh.state !== 'active') return null;
        useWorkspaceStore.setState({ accessLevel: fresh.access.level });
        setFirm((prev) =>
          prev
            ? { ...prev, access: fresh.access, readOnly: fresh.access.level === 'read_only' }
            : prev
        );
        return fresh.access.level;
      });

      setFirm({
        firmId: app.firmId,
        firmName: app.firmName,
        userId: app.userId,
        email: app.email,
        role: app.role,
        access: app.access,
        isSuperAdmin: app.isSuperAdmin,
        isDemoFirm: app.isDemoFirm,
        readOnly: app.access.level === 'read_only',
      });

      const dismissed =
        typeof window !== 'undefined' &&
        localStorage.getItem(IMPORT_DISMISSED_PREFIX + app.firmId) === '1';
      if (local.length > 0 && !dismissed) setPendingImport(local);

      setLocked(app.access.level === 'locked');
    })().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[firm-gate] bootstrap failed', e);
      setError('We could not load your workspace. Check your connection and try again.');
    });
  }, [appRoute, pathname, router, enterCloudMode, hydrateFromCloud]);

  const dismissImport = () => {
    if (firm && typeof window !== 'undefined') {
      try {
        localStorage.setItem(IMPORT_DISMISSED_PREFIX + firm.firmId, '1');
      } catch {
        /* ignore */
      }
    }
    setPendingImport([]);
  };

  // Non-app routes render untouched — no firm chrome, no gating.
  if (!appRoute) return <>{children}</>;

  if (error) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{ background: 'hsl(var(--background))' }}
      >
        <div className="text-center space-y-4 max-w-sm">
          <p className="text-lg font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
            Something went wrong
          </p>
          <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {error}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  // Billing-locked: show the banner + a billing link, block the app content.
  if (locked && firm) {
    return (
      <FirmProvider value={firm}>
        <div
          className="min-h-screen flex items-center justify-center px-4"
          style={{ background: 'hsl(var(--background))' }}
        >
          <div className="w-full max-w-md space-y-4">
            <BillingBanner decision={firm.access} />
            <div className="text-center">
              <Link
                href="/billing"
                className="inline-flex rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
                style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
              >
                Go to Billing
              </Link>
            </div>
          </div>
        </div>
      </FirmProvider>
    );
  }

  // Still resolving / redirecting.
  if (!firm) return <FullscreenSpinner />;

  return (
    <FirmProvider value={firm}>
      {children}
      {pendingImport.length > 0 && (
        <ImportPrompt localWorkspaces={pendingImport} onDone={dismissImport} />
      )}
    </FirmProvider>
  );
}
