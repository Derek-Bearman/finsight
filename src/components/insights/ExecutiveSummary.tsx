'use client';

/**
 * Executive summary block — the plain-English read of the client's latest
 * numbers, rendered at the top of Overview and Reports (PrintReport has its
 * own print-styled variant). Deterministic template output, not AI.
 */

import { useMemo } from 'react';
import type { AccountValue, ClientWorkspace } from '@/types';
import { buildExecutiveSummary, type SummaryLine } from '@/lib/insights/executive-summary';
import { useEffectiveTargets } from '@/lib/franchise/useEffectiveTargets';

const TONE_COLORS: Record<SummaryLine['tone'], string> = {
  positive: 'hsl(142 71% 45%)',
  negative: 'hsl(0 84% 60%)',
  neutral: 'hsl(217 91% 55%)',
  watch: 'hsl(38 92% 50%)',
};

export function ExecutiveSummary({
  workspace,
  values,
}: {
  workspace: ClientWorkspace;
  /** Optional scoped value set (the shared date-range window). When provided,
   *  the summary narrates from these values instead of the full workspace.
   *  Omitted = today's behavior exactly (the full workspace flows through). */
  values?: AccountValue[];
}) {
  // Composed targets (client > corporate set > industry pack) — falls back to
  // plain workspace targets for non-franchise workspaces. Kept keyed on the
  // REAL workspace so targets/franchise resolution is unaffected by scoping.
  const { targets: effectiveTargets } = useEffectiveTargets(workspace);
  // Only the buildExecutiveSummary input's values are scoped. No `values` prop
  // passes the workspace straight through (byte-identical default).
  const summaryWorkspace = useMemo(
    () => (values ? { ...workspace, values } : workspace),
    [workspace, values]
  );
  const lines = useMemo(
    () => buildExecutiveSummary(summaryWorkspace, effectiveTargets),
    [summaryWorkspace, effectiveTargets]
  );
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
