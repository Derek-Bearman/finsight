'use client';
import { useState, useCallback } from 'react';
import { TourOverlay } from './TourOverlay';
import { useTour } from './useTour';
import { usePageTour } from './usePageTour';
import { HelpButton } from './HelpButton';
import { HelpPanel } from './HelpPanel';
import type { TourStep } from './TourSteps';
import { PAGE_TOURS } from './content/pageTours';
import { PAGE_FAQ } from './content/faq';

interface PageTutorProps {
  /** The main ("app") tour for this surface: home or workspace. */
  mainTour: { steps: TourStep[]; storageKey: string; label: string; autoOpen?: boolean };
  /**
   * Current page/tab id, used to pick the page tour + FAQ. On the workspace
   * page this is the active tab and changes as the user switches tabs; on
   * single-purpose pages (home, franchises) it is a fixed string or null.
   */
  pageId: string | null;
  /** Human name of the current page/tab shown in the help panel header. */
  pageTitle: string;
}

/**
 * Self-contained tutorial controller for a surface: renders the "?" help
 * button, the page-scoped FAQ panel with its two restart controls, and both
 * the main-tour and page-tour overlays (portalled, so this can live in a
 * header). Keeps the two overlays mutually exclusive.
 */
export function PageTutor({ mainTour, pageId, pageTitle }: PageTutorProps) {
  const tour = useTour({ storageKey: mainTour.storageKey, autoOpen: mainTour.autoOpen ?? true });
  const pageTour = usePageTour(pageId, {
    mainTourDone: tour.seen,
    mainTourOpen: tour.isOpen,
  });
  const [helpOpen, setHelpOpen] = useState(false);

  const hasPageTour = pageTour.hasPageTour(pageId);
  const faq = (pageId && PAGE_FAQ[pageId]) || PAGE_FAQ.home || [];

  const restartAppTour = useCallback(() => {
    setHelpOpen(false);
    pageTour.dismiss(); // never show two overlays at once
    tour.openTour(0);
  }, [pageTour, tour]);

  const restartPageTour = useCallback(() => {
    if (!pageId) return;
    setHelpOpen(false);
    pageTour.openPageTour(pageId);
  }, [pageId, pageTour]);

  const openTourSteps = pageTour.openId ? PAGE_TOURS[pageTour.openId as keyof typeof PAGE_TOURS] : null;

  return (
    <>
      <HelpButton onOpen={() => setHelpOpen(true)} />

      {/* Main (app) tour */}
      {tour.isOpen && (
        <TourOverlay
          steps={mainTour.steps}
          onComplete={tour.completeTour}
          onSkip={tour.skipTour}
          startAtStep={tour.startStep}
          tourLabel={mainTour.label}
        />
      )}

      {/* Page-specific tour (never rendered while the main tour is open) */}
      {!tour.isOpen && pageTour.openId && openTourSteps && (
        <TourOverlay
          steps={openTourSteps}
          onComplete={() => pageTour.complete(pageTour.openId!)}
          onSkip={() => pageTour.skip(pageTour.openId!)}
          startAtStep={pageTour.startStep}
          tourLabel={`${pageTitle} tour`}
        />
      )}

      <HelpPanel
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        pageTitle={pageTitle}
        faq={faq}
        onRestartAppTour={restartAppTour}
        onRestartPageTour={hasPageTour ? restartPageTour : undefined}
      />
    </>
  );
}
