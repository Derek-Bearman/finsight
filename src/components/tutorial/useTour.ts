'use client';
import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'finsight-tutorial-seen';

export function useTour(opts: { autoOpen?: boolean } = {}) {
  const { autoOpen = true } = opts;
  const [isOpen, setIsOpen] = useState(false);
  const [startStep, setStartStep] = useState(0);

  // Auto-show on first visit (opt-out via { autoOpen: false } — the home tour
  // opts out because its steps describe later wizard screens and don't anchor
  // cleanly on a populated home; the workspace tour keeps auto-open).
  useEffect(() => {
    if (!autoOpen) return;
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setIsOpen(true);
      }
    } catch {
      /* localStorage blocked */
    }
  }, [autoOpen]);

  const openTour = useCallback((step = 0) => {
    setStartStep(step);
    setIsOpen(true);
  }, []);

  const completeTour = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {}
    setIsOpen(false);
  }, []);

  const skipTour = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {}
    setIsOpen(false);
  }, []);

  return { isOpen, startStep, openTour, completeTour, skipTour };
}
