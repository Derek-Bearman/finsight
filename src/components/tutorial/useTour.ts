'use client';
import { useState, useCallback, useEffect } from 'react';
import { LEGACY_TOUR_KEY } from './keys';

/**
 * Drives a single "main" tour (home or workspace). Each caller passes its own
 * storageKey so tours are independent. `seen` is exposed reactively so page
 * tours can gate on "the main tour is complete" and auto-run right after it
 * finishes (not just on a later visit).
 */
export function useTour(opts: { autoOpen?: boolean; storageKey?: string } = {}) {
  const { autoOpen = true, storageKey = LEGACY_TOUR_KEY } = opts;
  const [isOpen, setIsOpen] = useState(false);
  const [startStep, setStartStep] = useState(0);
  // Whether this main tour has been completed/skipped (own key OR the legacy
  // combined key). Resolved in an effect so the hydration pass matches SSR.
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    let alreadySeen = false;
    try {
      alreadySeen = !!(
        localStorage.getItem(storageKey) || localStorage.getItem(LEGACY_TOUR_KEY)
      );
    } catch {
      /* localStorage blocked — treat as not seen, but don't force the tour */
    }
    setSeen(alreadySeen);
    if (autoOpen && !alreadySeen) setIsOpen(true);
  }, [autoOpen, storageKey]);

  const openTour = useCallback((step = 0) => {
    setStartStep(step);
    setIsOpen(true);
  }, []);

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {}
    setSeen(true);
    setIsOpen(false);
  }, [storageKey]);

  return {
    isOpen,
    startStep,
    seen,
    openTour,
    completeTour: markSeen,
    skipTour: markSeen,
  };
}
