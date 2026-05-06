// ── Tour positioning utilities ─────────────────────────────────────────────

export type ArrowSide = 'top' | 'bottom' | 'left' | 'right' | null;

export interface BubblePosition {
  top: number;
  left: number;
  arrowSide: ArrowSide;
}

const BUBBLE_GAP = 14; // px gap between target and bubble
const VIEWPORT_PADDING = 16; // minimum distance from viewport edges

/**
 * Compute where to place the tooltip bubble relative to the target element.
 * Returns fixed-position coordinates and which side the arrow should appear on.
 */
export function computeBubblePosition(
  targetRect: DOMRect | null,
  position: string,
  bubbleWidth: number,
  bubbleHeight: number
): BubblePosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Center modal — no target
  if (!targetRect || position === 'center') {
    return {
      top: Math.max(VIEWPORT_PADDING, (vh - bubbleHeight) / 2),
      left: Math.max(VIEWPORT_PADDING, (vw - bubbleWidth) / 2),
      arrowSide: null,
    };
  }

  const { top: tTop, left: tLeft, right: tRight, bottom: tBottom, width: tWidth, height: tHeight } = targetRect;
  const tCenterX = tLeft + tWidth / 2;
  const tCenterY = tTop + tHeight / 2;

  let top = 0;
  let left = 0;
  let arrowSide: ArrowSide = null;

  switch (position) {
    case 'below':
      top = tBottom + BUBBLE_GAP;
      left = tCenterX - bubbleWidth / 2;
      arrowSide = 'top';
      break;
    case 'above':
      top = tTop - bubbleHeight - BUBBLE_GAP;
      left = tCenterX - bubbleWidth / 2;
      arrowSide = 'bottom';
      break;
    case 'right':
      top = tCenterY - bubbleHeight / 2;
      left = tRight + BUBBLE_GAP;
      arrowSide = 'left';
      break;
    case 'left':
      top = tCenterY - bubbleHeight / 2;
      left = tLeft - bubbleWidth - BUBBLE_GAP;
      arrowSide = 'right';
      break;
    default:
      top = tBottom + BUBBLE_GAP;
      left = tCenterX - bubbleWidth / 2;
      arrowSide = 'top';
  }

  // Clamp to viewport
  top = Math.max(VIEWPORT_PADDING, Math.min(top, vh - bubbleHeight - VIEWPORT_PADDING));
  left = Math.max(VIEWPORT_PADDING, Math.min(left, vw - bubbleWidth - VIEWPORT_PADDING));

  return { top, left, arrowSide };
}

/**
 * Get border-radius of a DOM element (clamped to 0–16px for the spotlight ring).
 */
export function getElementBorderRadius(el: Element): number {
  const computed = window.getComputedStyle(el);
  const radius = parseFloat(computed.borderRadius || '0');
  return isNaN(radius) ? 8 : Math.min(radius, 16);
}
