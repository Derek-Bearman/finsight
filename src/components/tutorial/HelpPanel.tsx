'use client';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { FaqEntry } from './content/faq';

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
  /** Human name of the current page/tab, e.g. "Overview", "Franchises". */
  pageTitle: string;
  faq: FaqEntry[];
  /** Restart the main app tour (home or workspace) for the current surface. */
  onRestartAppTour: () => void;
  /** Restart this page's own tour. Omitted on surfaces with no page tour. */
  onRestartPageTour?: () => void;
}

/**
 * Page-scoped help sheet opened by the "?" button. Lists the current page's FAQ
 * and offers two restart controls: the main app tour and (when present) this
 * page's own tour. Portalled, theme-aware, mobile-friendly, closes on Escape,
 * backdrop click, or the X.
 */
export function HelpPanel({
  open,
  onClose,
  pageTitle,
  faq,
  onRestartAppTour,
  onRestartPageTour,
}: HelpPanelProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  // Keep the latest onClose without re-running the focus effect each render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    // Remember what had focus (the "?" button) so we can restore it on close.
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    // Move focus into the sheet once it has mounted.
    const focusTimer = setTimeout(() => sheetRef.current?.focus(), 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      // Trap Tab within the sheet so keyboard/screen-reader users stay inside
      // the dialog it advertises via aria-modal.
      const focusables = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        sheetRef.current.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === sheetRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      prevFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const panel = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${pageTitle} help`}
      data-testid="help-panel"
      style={{ position: 'fixed', inset: 0, zIndex: 10000 }}
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        tabIndex={-1}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          height: '100%',
          width: 'min(440px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          background: 'hsl(var(--card))',
          color: 'hsl(var(--foreground))',
          borderLeft: '1px solid hsl(var(--border))',
          boxShadow: '-20px 0 60px rgba(0,0,0,0.3)',
          outline: 'none',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '16px 20px',
            borderBottom: '1px solid hsl(var(--border))',
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'hsl(var(--muted-foreground))',
              }}
            >
              Help
            </div>
            <h2 style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{pageTitle}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close help"
            data-testid="help-panel-close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'hsl(var(--muted-foreground))',
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* FAQ list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }} data-testid="help-panel-faq">
          {faq.length === 0 ? (
            <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>
              No help topics for this page yet.
            </p>
          ) : (
            faq.map((entry, i) => (
              <details
                key={i}
                data-testid={`faq-item-${i}`}
                style={{
                  borderBottom: '1px solid hsl(var(--border))',
                  padding: '10px 0',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer',
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: 'hsl(var(--foreground))',
                    listStyle: 'none',
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  <span aria-hidden="true" style={{ color: 'hsl(var(--primary))' }}>
                    ?
                  </span>
                  <span>{entry.q}</span>
                </summary>
                <p
                  style={{
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: 'hsl(var(--muted-foreground))',
                    margin: '8px 0 0',
                    paddingLeft: 16,
                  }}
                >
                  {entry.a}
                </p>
              </details>
            ))
          )}
        </div>

        {/* Footer — restart controls */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '14px 20px',
            borderTop: '1px solid hsl(var(--border))',
          }}
        >
          <button
            onClick={onRestartAppTour}
            data-testid="help-restart-app-tour"
            style={{
              background: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
              border: 'none',
              borderRadius: 8,
              padding: '9px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            Restart the app tour
          </button>
          {onRestartPageTour && (
            <button
              onClick={onRestartPageTour}
              data-testid="help-restart-page-tour"
              style={{
                background: 'transparent',
                color: 'hsl(var(--foreground))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                padding: '9px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                width: '100%',
              }}
            >
              Restart this page&apos;s tour
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
