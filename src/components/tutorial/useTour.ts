'use client';
import { useState, useCallback, useEffect } from 'react';

/** Legacy shared key (pre per-tour keys). Still honored as "seen everything"
 *  so existing users don't get re-toured after the split. */
const LEGACY_STORAGE_KEY = 'finsight-tutorial-seen';

export function useTour(opts: { autoOpen?: boolean; storageKey?: string } = {}) {
  const { autoOpen = true, storageKey = LEGACY_STORAGE_KEY } = opts;
  const [isOpen, setIsOpen] = useState(false);
  const [startStep, setStartStep] = useState(0);

  // Auto-show on first visit. Each tour has its own storage key (home vs
  // workspace) so completing one doesn't suppress the other; the legacy
  // combined key is treated as "seen" for both.
  useEffect(() => {
    if (!autoOpen) return;
    try {
      if (!localStorage.getItem(storageKey) && !localStorage.getItem(LEGACY_STORAGE_KEY)) {
        setIsOpen(true);
      }
    } catch {
      /* localStorage blocked */
    }
  }, [autoOpen, storageKey]);

  const openTour = useCallback((step = 0) => {
    setStartStep(step);
    setIsOpen(true);
  }, []);

  const completeTour = useCallback(() => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {}
    setIsOpen(false);
  }, [storageKey]);

  const skipTour = useCallback(() => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {}
    setIsOpen(false);
  }, [storageKey]);

  return { isOpen, startStep, openTour, completeTour, skipTour };
}
