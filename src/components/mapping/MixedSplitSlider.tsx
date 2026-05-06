'use client';

import React from 'react';
import type { Account } from '@/types';

export interface MixedSplitSliderProps {
  account: Account;
  onUpdate: (accountId: string, fixedPercent: number) => void;
}

export function MixedSplitSlider({ account, onUpdate }: MixedSplitSliderProps) {
  const fixedPct = Math.round((account.mixedFixedPercent ?? 0.5) * 100);
  const variablePct = 100 - fixedPct;

  return (
    <div
      className="rounded-lg border p-3 flex flex-col gap-2"
      style={{
        borderColor: 'hsl(var(--border))',
        background: 'hsl(var(--card))',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate" style={{ color: 'hsl(var(--foreground))' }}>
          {account.number && (
            <span className="font-mono text-xs mr-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {account.number}
            </span>
          )}
          {account.name}
        </span>
        <span className="text-xs tabular-nums shrink-0" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {fixedPct}% Fixed / {variablePct}% Variable
        </span>
      </div>

      {/* Slider */}
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Var</span>
        <div className="relative flex-1">
          <input
            type="range"
            min={0}
            max={100}
            value={fixedPct}
            onChange={(e) => onUpdate(account.id, parseInt(e.target.value, 10) / 100)}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              accentColor: 'hsl(var(--primary))',
              background: `linear-gradient(to right, hsl(38 92% 50%) ${fixedPct}%, hsl(var(--border)) ${fixedPct}%)`,
            }}
            aria-label={`Fixed/variable split for ${account.name}`}
          />
        </div>
        <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Fixed</span>
      </div>

      {/* Visual split bar */}
      <div className="flex h-1 rounded-full overflow-hidden gap-0.5">
        <div
          style={{
            width: `${fixedPct}%`,
            background: 'hsl(38 92% 50%)',
            transition: 'width 0.1s',
          }}
        />
        <div
          style={{
            width: `${variablePct}%`,
            background: 'hsl(217 91% 60%)',
            transition: 'width 0.1s',
          }}
        />
      </div>
    </div>
  );
}
