'use client';

/**
 * Executive summary block — the plain-English read of the client's latest
 * numbers, rendered at the top of Overview and Reports (PrintReport has its
 * own print-styled variant). Deterministic template output, not AI.
 */

import { useMemo } from 'react';
import type { ClientWorkspace } from '@/types';
import { buildExecutiveSummary, type SummaryLine } from '@/lib/insights/executive-summary';

const TONE_COLORS: Record<SummaryLine['tone'], string> = {
  positive: 'hsl(142 71% 45%)',
  negative: 'hsl(0 84% 60%)',
  neutral: 'hsl(217 91% 55%)',
  watch: 'hsl(38 92% 50%)',
};

export function ExecutiveSummary({ workspace }: { workspace: ClientWorkspace }) {
  const lines = useMemo(() => buildExecutiveSummary(workspace), [workspace]);
  if (lines.length === 0) return null;

  return (
    <div
      className="rounded-xl border p-5"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      data-testid="executive-summary"
    >
      <div className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
        <h3 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
          Executive Summary
        </h3>
        <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
          Generated from this client&apos;s numbers — every figure traces to the statements
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {lines.map((line, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed">
            <span
              className="h-2 w-2 rounded-full flex-shrink-0 mt-1.5"
              style={{ background: TONE_COLORS[line.tone] }}
              aria-hidden
            />
            <span style={{ color: 'hsl(var(--foreground))' }}>{line.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
