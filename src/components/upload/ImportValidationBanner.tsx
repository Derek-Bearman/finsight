'use client';

import React, { useState } from 'react';
import type { ImportValidationWarning } from '@/types';

interface ImportValidationBannerProps {
  warnings: ImportValidationWarning[];
  onDismiss?: () => void;
}

type Severity = 'error' | 'warning' | 'info';

const SEVERITY_CONFIG: Record<
  Severity,
  { bg: string; border: string; iconColor: string; titleColor: string; textColor: string; icon: React.ReactNode }
> = {
  error: {
    bg: 'bg-red-50 dark:bg-red-950/20',
    border: 'border-red-200 dark:border-red-900',
    iconColor: 'text-red-500',
    titleColor: 'text-red-800 dark:text-red-300',
    textColor: 'text-red-700 dark:text-red-400',
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
    ),
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-950/20',
    border: 'border-amber-200 dark:border-amber-900',
    iconColor: 'text-amber-500',
    titleColor: 'text-amber-800 dark:text-amber-300',
    textColor: 'text-amber-700 dark:text-amber-400',
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
    ),
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    border: 'border-blue-200 dark:border-blue-900',
    iconColor: 'text-blue-500',
    titleColor: 'text-blue-800 dark:text-blue-300',
    textColor: 'text-blue-700 dark:text-blue-400',
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
      </svg>
    ),
  },
};

export function ImportValidationBanner({ warnings, onDismiss }: ImportValidationBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || warnings.length === 0) return null;

  const grouped = {
    error: warnings.filter((w) => w.severity === 'error'),
    warning: warnings.filter((w) => w.severity === 'warning'),
    info: warnings.filter((w) => w.severity === 'info'),
  };

  const errorCount = grouped.error.length;
  const warnCount = grouped.warning.length;

  // Determine dominant severity for header styling
  const dominantSeverity: Severity = errorCount > 0 ? 'error' : warnCount > 0 ? 'warning' : 'info';
  const cfg = SEVERITY_CONFIG[dominantSeverity];

  const summaryParts: string[] = [];
  if (errorCount > 0) summaryParts.push(`${errorCount} error${errorCount !== 1 ? 's' : ''}`);
  if (warnCount > 0) summaryParts.push(`${warnCount} warning${warnCount !== 1 ? 's' : ''}`);
  if (grouped.info.length > 0) summaryParts.push(`${grouped.info.length} info`);

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <div
      className={`rounded-lg border ${cfg.bg} ${cfg.border}`}
      data-testid="import-validation-banner"
    >
      {/* Header / collapsed view */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        data-testid="banner-toggle"
      >
        <div className={`flex items-center gap-2 ${cfg.iconColor}`}>
          {cfg.icon}
          <span className={`text-sm font-medium ${cfg.titleColor}`}>
            {summaryParts.join(', ')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`text-xs font-medium underline-offset-2 hover:underline ${cfg.textColor}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            data-testid="banner-expand"
          >
            {expanded ? 'Collapse' : 'Show details'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDismiss();
            }}
            className="ml-1 rounded hover:opacity-70 transition-opacity"
            aria-label="Dismiss"
            data-testid="banner-dismiss"
          >
            <svg className={`h-4 w-4 ${cfg.iconColor}`} viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-4" style={{ borderColor: 'inherit' }}>
          {(['error', 'warning', 'info'] as Severity[]).map((sev) => {
            const items = grouped[sev];
            if (items.length === 0) return null;
            const c = SEVERITY_CONFIG[sev];
            return (
              <div key={sev}>
                <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${c.titleColor}`}>
                  {sev === 'error' ? 'Errors' : sev === 'warning' ? 'Warnings' : 'Information'}
                </p>
                <ul className="space-y-1.5">
                  {items.map((w, i) => (
                    <li key={i} className={`flex items-start gap-2 text-sm ${c.textColor}`}>
                      <span className={`mt-0.5 shrink-0 ${c.iconColor}`}>{c.icon}</span>
                      {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          {/* Proceed anyway for warnings/info-only */}
          {errorCount === 0 && (
            <div className="flex justify-end pt-1">
              <button
                onClick={handleDismiss}
                className={`text-xs font-medium underline underline-offset-2 ${cfg.textColor}`}
                data-testid="banner-proceed"
              >
                Proceed Anyway
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
