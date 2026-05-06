'use client';
import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'finsight-tutorial-seen';

export function useTour() {
  const [isOpen, setIsOpen] = useState(false);
  const [startStep, setStartStep] = useState(0);

  // Auto-show on first visit
  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setIsOpen(true);
      }
    } catch {
      /* localStorage blocked */
    }
  }, []);

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
