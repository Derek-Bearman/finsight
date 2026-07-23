'use client';

import React from 'react';
import type { ProjectionModel } from '@/types';
import { formatPercent } from '@/lib/utils/format';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type HorizonKey = '12m' | '1y' | '3y' | '5y' | '10y';

export interface ProjectionControlsProps {
  model: ProjectionModel;
  onModelChange: (m: ProjectionModel) => void;
  horizon: HorizonKey;
  onHorizonChange: (h: HorizonKey) => void;
  growthRateOverride: number | null;
  onGrowthRateChange: (v: number | null) => void;
  profileDefaultModel: ProjectionModel;
  impliedGrowthRate?: number;
}

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────

const MODELS: { id: ProjectionModel; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'seasonal', label: 'Seasonal' },
  { id: 'yoy', label: 'YoY Growth' },
  { id: 'driver', label: 'Driver-based' },
];

const HORIZONS: { id: HorizonKey; label: string }[] = [
  { id: '12m', label: '1 Yr' },
  { id: '3y', label: '3 Yr' },
  { id: '5y', label: '5 Yr' },
  { id: '10y', label: '10 Yr' },
];

// Answers Derek's "revenue vs net profit?" question inline: the rate drives each
// account's projected trend, and both revenue and net income are re-derived from
// those projected accounts (net income is not projected at the rate directly).
const APPLIED_TO_NOTE = "Applied to each account's projected trend; revenue and net income follow.";

// Driver-based mode answers a different mental model than the trend models: the
// rate drives revenue, and each cost then follows its classified cost behavior
// rather than extrapolating its own history.
const DRIVER_NOTE =
  'Growth rate drives revenue; variable costs scale with revenue, fixed costs stay flat, mixed costs split by their fixed/variable share.';

// ─────────────────────────────────────────────
// Pill group helper
// ─────────────────────────────────────────────

function PillGroup<T extends string>({
  options,
  value,
  onChange,
  renderLabel,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  renderLabel?: (opt: { id: T; label: string }) => React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg p-1"
      style={{ background: 'hsl(var(--muted))' }}
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className="px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap"
          style={{
            background: value === opt.id ? 'hsl(var(--primary))' : 'transparent',
            color: value === opt.id ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
          }}
        >
          {renderLabel ? renderLabel(opt) : opt.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// ProjectionControls
// ─────────────────────────────────────────────

export function ProjectionControls({
  model,
  onModelChange,
  horizon,
  onHorizonChange,
  growthRateOverride,
  onGrowthRateChange,
  profileDefaultModel,
  impliedGrowthRate,
}: ProjectionControlsProps) {
  const isOverrideActive = growthRateOverride !== null;

  // Input field value in percent (0.05 → "5")
  const inputValue = isOverrideActive ? (growthRateOverride! * 100).toFixed(1) : '';

  function handleToggleOverride() {
    if (isOverrideActive) {
      onGrowthRateChange(null);
    } else {
      // Enable with a default of 5%
      onGrowthRateChange(impliedGrowthRate ?? 0.05);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = parseFloat(e.target.value);
    if (!isNaN(raw)) {
      onGrowthRateChange(raw / 100);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Model selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
          Model
        </span>
        <PillGroup
          options={MODELS}
          value={model}
          onChange={onModelChange}
          renderLabel={(opt) => (
            <span className="flex items-center gap-1">
              {opt.label}
              {opt.id === profileDefaultModel && opt.id !== model && (
                /* Only show "default" badge when the default model isn't already
                   selected — otherwise it creates a second blue highlight that
                   competes with the selected-pill background. Use a neutral
                   outlined style so it doesn't read as "this is active". */
                <span
                  className="rounded border px-1 py-0.5 leading-none"
                  style={{
                    borderColor: 'hsl(var(--border))',
                    background: 'transparent',
                    color: 'hsl(var(--muted-foreground))',
                    fontSize: '9px',
                  }}
                >
                  default
                </span>
              )}
            </span>
          )}
        />
      </div>

      {/* Horizon selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
          Horizon
        </span>
        <PillGroup options={HORIZONS} value={horizon} onChange={onHorizonChange} />
      </div>

      {/* Growth rate: always surface the rate in effect + what it applies to */}
      <div className="flex flex-col gap-0.5" data-testid="growth-rate-display">
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleOverride}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            style={{
              background: isOverrideActive ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
              color: isOverrideActive ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
            }}
          >
            <span className="text-xs">{isOverrideActive ? '✓' : '+'}</span>
            Growth Rate
          </button>

          {isOverrideActive ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.1"
                value={inputValue}
                onChange={handleInputChange}
                className="w-16 rounded-md border px-2 py-0.5 text-xs text-right"
                style={{
                  borderColor: 'hsl(var(--border))',
                  background: 'hsl(var(--card))',
                  color: 'hsl(var(--foreground))',
                }}
              />
              <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                %/yr (manual)
              </span>
            </div>
          ) : (
            <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {impliedGrowthRate !== undefined
                ? `${formatPercent(impliedGrowthRate)}/yr · model-implied from revenue history`
                : 'Per-account model trend (not a single rate)'}
            </span>
          )}
        </div>

        <span className="text-[10px] leading-tight" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {model === 'driver' ? DRIVER_NOTE : APPLIED_TO_NOTE}
        </span>
      </div>
    </div>
  );
}
