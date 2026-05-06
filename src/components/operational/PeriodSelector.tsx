'use client';

import type { Period } from '@/types';
import { periodLabel, periodSortKey } from '@/lib/utils/period';

export interface PeriodSelectorProps {
  availablePeriods: Period[];
  selectedPeriod: Period | null;
  onChange: (period: Period) => void;
  label?: string;
}

export function PeriodSelector({
  availablePeriods,
  selectedPeriod,
  onChange,
  label = 'Period',
}: PeriodSelectorProps) {
  // Sort in reverse chronological order (most recent first)
  const sorted = [...availablePeriods].sort(
    (a, b) => periodSortKey(b) - periodSortKey(a)
  );

  const toValue = (p: Period) => `${p.year}-${String(p.month).padStart(2, '0')}`;
  const selectedValue = selectedPeriod ? toValue(selectedPeriod) : '';

  if (sorted.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-medium"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          {label}:
        </span>
        <span
          className="text-xs"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          No data imported
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label
        className="text-xs font-medium whitespace-nowrap"
        style={{ color: 'hsl(var(--muted-foreground))' }}
      >
        {label}:
      </label>
      <select
        value={selectedValue}
        onChange={(e) => {
          const found = sorted.find((p) => toValue(p) === e.target.value);
          if (found) onChange(found);
        }}
        className="rounded-lg border px-2 py-1.5 text-sm font-medium"
        style={{
          borderColor: 'hsl(var(--border))',
          background: 'hsl(var(--card))',
          color: 'hsl(var(--foreground))',
        }}
      >
        {sorted.map((p) => (
          <option key={toValue(p)} value={toValue(p)}>
            {periodLabel(p)}
          </option>
        ))}
      </select>
    </div>
  );
}
