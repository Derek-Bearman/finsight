'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { pageTourKey } from './keys';
import { PAGE_TOURS } from './content/pageTours';

function hasPageTour(id: string | null): id is string {
  return !!id && Array.isArray((PAGE_TOURS as Record<string, unknown[]>)[id]) &&
    (PAGE_TOURS as Record<string, unknown[]>)[id]!.length > 0;
}

/**
 * Drives the page-specific tours. A page's tour auto-runs the FIRST time that
 * page/tab becomes active, but ONLY once the main tour is complete and not
 * currently open (never two overlays at once, never before onboarding). It
 * auto-shows at most once per session per page (autoShownRef) and once ever
 * (localStorage), and can always be reopened manually from the help panel.
 */
export function usePageTour(
  pageId: string | null,
  opts: { mainTourDone: boolean; mainTourOpen: boolean }
) {
  const { mainTourDone, mainTourOpen } = opts;
  const [openId, setOpenId] = useState<string | null>(null);
  const [startStep, setStartStep] = useState(0);
  const autoShownRef = useRef<Set<string>>(new Set());

  // Auto-open the current page's tour when eligible.
  useEffect(() => {
    if (!hasPageTour(pageId)) return;
    if (!mainTourDone || mainTourOpen) return; // gate: after main tour, never overlapping
    if (openId) return; // a page tour is already open
    if (autoShownRef.current.has(pageId)) return; // once per session per page
    let seen = false;
    try {
      seen = !!localStorage.getItem(pageTourKey(pageId));
    } catch {
      /* localStorage blocked */
    }
    if (seen) return;
    autoShownRef.current.add(pageId);
    setStartStep(0);
    setOpenId(pageId);
  }, [pageId, mainTourDone, mainTourOpen, openId]);

  // If the active page changes while a tour is open for a DIFFERENT page, close
  // it (its targets no longer exist). Not marked seen, so it can still run later
  // this session bounded by autoShownRef, or persist when actually finished.
  useEffect(() => {
    if (openId && pageId && openId !== pageId) setOpenId(null);
  }, [pageId, openId]);

  const openPageTour = useCallback((id: string) => {
    if (!hasPageTour(id)) return;
    autoShownRef.current.add(id);
    setStartStep(0);
    setOpenId(id);
  }, []);

  const finish = useCallback((id: string) => {
    try {
      localStorage.setItem(pageTourKey(id), '1');
    } catch {}
    setOpenId(null);
  }, []);

  // Close without persisting (e.g. the main tour was reopened over it).
  const dismiss = useCallback(() => setOpenId(null), []);

  return { openId, startStep, openPageTour, complete: finish, skip: finish, dismiss, hasPageTour };
}
