'use client';
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import type { TourStep } from './TourSteps';
import {
  computeBubblePosition,
  getElementBorderRadius,
  type BubblePosition,
} from './tourUtils';

interface TourOverlayProps {
  steps: TourStep[];
  onComplete: () => void;
  onSkip: () => void;
  startAtStep?: number;
  /**
   * Short label identifying which tour this is (e.g. "Home tour",
   * "Workspace tour"). Shown alongside the step counter so users can tell
   * different tours apart when re-opening with "?".
   */
  tourLabel?: string;
}

const BUBBLE_W = 340;
const BUBBLE_H_ESTIMATE = 220;

export function TourOverlay({ steps, onComplete, onSkip, startAtStep = 0, tourLabel }: TourOverlayProps) {
  const [currentIdx, setCurrentIdx] = useState(startAtStep);
  // Reset the tour to startAtStep whenever the parent re-opens it with a
  // different start point — otherwise the previous in-progress index sticks
  // around if React reuses the component instance.
  useEffect(() => {
    setCurrentIdx(startAtStep);
  }, [startAtStep]);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [targetRadius, setTargetRadius] = useState(8);
  const [bubblePos, setBubblePos] = useState<BubblePosition>({ top: 0, left: 0, arrowSide: null });
  const bubbleRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const step = steps[currentIdx];

  // Find the target element and compute positions
  const updatePositions = useCallback(() => {
    if (!step) return;
    if (!step.target) {
      setTargetRect(null);
      setTargetRadius(8);
      const bh = bubbleRef.current?.offsetHeight ?? BUBBLE_H_ESTIMATE;
      setBubblePos(computeBubblePosition(null, 'center', BUBBLE_W, bh));
      return;
    }
    const el = document.querySelector(step.target);
    if (!el) {
      setTargetRect(null);
      setTargetRadius(8);
      const bh = bubbleRef.current?.offsetHeight ?? BUBBLE_H_ESTIMATE;
      setBubblePos(computeBubblePosition(null, 'center', BUBBLE_W, bh));
      return;
    }
    const rect = el.getBoundingClientRect();
    const radius = getElementBorderRadius(el);
    setTargetRect(rect);
    setTargetRadius(radius);
    const bh = bubbleRef.current?.offsetHeight ?? BUBBLE_H_ESTIMATE;
    setBubblePos(computeBubblePosition(rect, step.position ?? 'below', BUBBLE_W, bh));
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [step]);

  // Update positions when step changes
  useEffect(() => {
    // Small delay so scroll settles
    const t = setTimeout(updatePositions, 80);
    return () => clearTimeout(t);
  }, [updatePositions]);

  // ResizeObserver for layout changes
  useEffect(() => {
    observerRef.current?.disconnect();
    if (step?.target) {
      const el = document.querySelector(step.target);
      if (el) {
        observerRef.current = new ResizeObserver(updatePositions);
        observerRef.current.observe(el);
      }
    }
    window.addEventListener('resize', updatePositions);
    return () => {
      observerRef.current?.disconnect();
      window.removeEventListener('resize', updatePositions);
    };
  }, [updatePositions, step?.target]);

  // Find next valid step (skip steps whose targets aren't in DOM)
  const findNextValidStep = useCallback(
    (fromIdx: number, direction: 1 | -1): number => {
      let idx = fromIdx + direction;
      while (idx >= 0 && idx < steps.length) {
        const s = steps[idx];
        if (!s) break;
        if (!s.target || document.querySelector(s.target)) return idx;
        idx += direction;
      }
      return -1;
    },
    [steps]
  );

  const handleNext = useCallback(() => {
    if (currentIdx >= steps.length - 1) {
      onComplete();
      return;
    }
    const next = findNextValidStep(currentIdx, 1);
    if (next === -1) {
      onComplete();
    } else {
      setCurrentIdx(next);
    }
  }, [currentIdx, steps.length, findNextValidStep, onComplete]);

  const handleBack = useCallback(() => {
    const prev = findNextValidStep(currentIdx, -1);
    if (prev >= 0) setCurrentIdx(prev);
  }, [currentIdx, findNextValidStep]);

  // Keyboard handling
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') handleBack();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSkip, handleNext, handleBack]);

  // Focus trap
  useEffect(() => {
    bubbleRef.current?.focus();
  }, [currentIdx]);

  if (!step) return null;

  const isFirst = currentIdx === 0;
  const isLast = currentIdx === steps.length - 1;
  const isCenter = !step.target || step.position === 'center';
  const { arrowSide } = bubblePos;

  const arrowStyles: React.CSSProperties = {
    position: 'absolute',
    width: 0,
    height: 0,
    ...(arrowSide === 'top' && {
      top: -8,
      left: BUBBLE_W / 2 - 8,
      borderLeft: '8px solid transparent',
      borderRight: '8px solid transparent',
      borderBottom: '8px solid hsl(var(--card))',
    }),
    ...(arrowSide === 'bottom' && {
      bottom: -8,
      left: BUBBLE_W / 2 - 8,
      borderLeft: '8px solid transparent',
      borderRight: '8px solid transparent',
      borderTop: '8px solid hsl(var(--card))',
    }),
    ...(arrowSide === 'left' && {
      left: -8,
      top: '50%',
      transform: 'translateY(-50%)',
      borderTop: '8px solid transparent',
      borderBottom: '8px solid transparent',
      borderRight: '8px solid hsl(var(--card))',
    }),
    ...(arrowSide === 'right' && {
      right: -8,
      top: '50%',
      transform: 'translateY(-50%)',
      borderTop: '8px solid transparent',
      borderBottom: '8px solid transparent',
      borderLeft: '8px solid hsl(var(--card))',
    }),
  };

  const overlay = (
    <>
      {/* Spotlight ring over the target element */}
      {targetRect && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            borderRadius: targetRadius + 4,
            boxShadow:
              '0 0 0 4px hsl(217 91% 55%), 0 0 0 9999px rgba(0,0,0,0.55)',
            pointerEvents: 'none',
            zIndex: 9998,
          }}
        />
      )}

      {/* Dark backdrop for center modal (no target) */}
      {isCenter && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 9997,
          }}
        />
      )}

      {/* Tooltip bubble */}
      <div
        ref={bubbleRef}
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        tabIndex={-1}
        style={{
          position: 'fixed',
          top: bubblePos.top,
          left: bubblePos.left,
          width: BUBBLE_W,
          zIndex: 9999,
          background: 'hsl(var(--card))',
          color: 'hsl(var(--foreground))',
          borderRadius: 16,
          boxShadow:
            '0 20px 60px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.15)',
          padding: '20px 20px 16px',
          outline: 'none',
        }}
      >
        {/* Arrow */}
        {arrowSide && <div style={arrowStyles} aria-hidden="true" />}

        {/* Step counter */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'hsl(var(--muted-foreground))',
            marginBottom: 8,
          }}
        >
          {tourLabel ? `${tourLabel} · ` : ''}Step {currentIdx + 1} of {steps.length}
        </div>

        {/* Title */}
        <h2
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: 'hsl(var(--foreground))',
            marginBottom: 8,
            lineHeight: 1.3,
          }}
        >
          {step.title}
        </h2>

        {/* Body */}
        <p
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: 'hsl(var(--muted-foreground))',
            marginBottom: 16,
          }}
        >
          {step.body}
        </p>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
          {steps.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === currentIdx ? 16 : 6,
                height: 6,
                borderRadius: 3,
                background:
                  i < currentIdx
                    ? 'hsl(217 91% 55%)'
                    : i === currentIdx
                    ? 'hsl(217 91% 55%)'
                    : 'hsl(var(--muted))',
                transition: 'width 0.2s, background 0.2s',
              }}
            />
          ))}
        </div>

        {/* Navigation buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {isFirst && isCenter ? (
            // Welcome screen: Start Tour + Skip Tour
            <div style={{ display: 'flex', gap: 8, width: '100%', flexDirection: 'column' }}>
              <button
                onClick={handleNext}
                style={{
                  background: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                  border: 'none',
                  borderRadius: 8,
                  padding: '9px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                Start Tour
              </button>
              <button
                onClick={onSkip}
                style={{
                  background: 'transparent',
                  color: 'hsl(var(--muted-foreground))',
                  border: 'none',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '4px 0',
                }}
              >
                Skip Tour
              </button>
            </div>
          ) : isLast ? (
            // Last step: close button
            <div style={{ display: 'flex', gap: 8, width: '100%', flexDirection: 'column' }}>
              <button
                onClick={onComplete}
                style={{
                  background: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                  border: 'none',
                  borderRadius: 8,
                  padding: '9px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                Start Using FinSight
              </button>
              <button
                onClick={handleBack}
                style={{
                  background: 'transparent',
                  color: 'hsl(var(--muted-foreground))',
                  border: 'none',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '4px 0',
                }}
              >
                ← Back
              </button>
            </div>
          ) : (
            // Middle steps: Back + Next + Skip
            <>
              <button
                onClick={handleBack}
                disabled={isFirst}
                style={{
                  background: 'transparent',
                  color: isFirst ? 'hsl(var(--muted))' : 'hsl(var(--muted-foreground))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  padding: '7px 14px',
                  fontSize: 13,
                  cursor: isFirst ? 'not-allowed' : 'pointer',
                }}
              >
                ← Back
              </button>
              <button
                onClick={onSkip}
                style={{
                  background: 'transparent',
                  color: 'hsl(var(--muted-foreground))',
                  border: 'none',
                  fontSize: 11,
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                Skip Tour
              </button>
              <button
                onClick={handleNext}
                style={{
                  background: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                  border: 'none',
                  borderRadius: 8,
                  padding: '7px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Next →
              </button>
            </>
          )}
        </div>

        {/* X close button */}
        <button
          onClick={onSkip}
          aria-label="Close tutorial"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'hsl(var(--muted-foreground))',
            fontSize: 16,
            lineHeight: 1,
            padding: 4,
          }}
        >
          ✕
        </button>
      </div>
    </>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(overlay, document.body);
}
