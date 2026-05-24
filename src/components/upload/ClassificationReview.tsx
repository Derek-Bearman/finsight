'use client';

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Account, AccountType, CostBehavior, ConfidenceLevel } from '@/types';
import type { ClassificationResult } from '@/lib/classifiers';

interface ClassificationReviewProps {
  accounts: Account[];
  classificationResults: Map<string, ClassificationResult>;
  profileId: string;
  onConfirm: (accounts: Account[]) => void;
  onBack: () => void;
  /**
   * Restricts which account types appear in the Type dropdown.
   * 'pnl' shows: revenue, cogs, expense
   * 'balance_sheet' shows: asset, liability, equity
   * Omit to show all types (default behaviour).
   */
  statementType?: 'pnl' | 'balance_sheet';
}

type FilterMode = 'all' | 'review' | 'manual';

const ALL_ACCOUNT_TYPES: AccountType[] = ['revenue', 'cogs', 'expense', 'asset', 'liability', 'equity'];
const PNL_ACCOUNT_TYPES: AccountType[] = ['revenue', 'cogs', 'expense'];
const BS_ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity'];
const COST_BEHAVIORS: CostBehavior[] = ['variable', 'fixed', 'mixed', 'unclassified'];

const CONFIDENCE_STYLES: Record<ConfidenceLevel, { bg: string; text: string; label: string }> = {
  high: { bg: 'bg-green-600', text: 'text-white', label: 'High' },
  medium: { bg: 'bg-amber-500', text: 'text-white', label: 'Medium' },
  low: { bg: 'bg-red-500', text: 'text-white', label: 'Low' },
};

const SOURCE_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  profile_keyword: { label: 'profile', variant: 'default' },
  baseline_keyword: { label: 'baseline', variant: 'secondary' },
  account_number: { label: 'acct#', variant: 'outline' },
  manual: { label: 'manual', variant: 'outline' },
};

export function ClassificationReview({
  accounts,
  classificationResults,
  onConfirm,
  onBack,
  statementType,
}: ClassificationReviewProps) {
  // Determine which account type options to show based on statement type
  const accountTypeOptions: AccountType[] =
    statementType === 'pnl'
      ? PNL_ACCOUNT_TYPES
      : statementType === 'balance_sheet'
      ? BS_ACCOUNT_TYPES
      : ALL_ACCOUNT_TYPES;
  const [localAccounts, setLocalAccounts] = useState<Account[]>(accounts);
  const [filter, setFilter] = useState<FilterMode>('all');

  const highCount = useMemo(
    () => localAccounts.filter((a) => a.classificationConfidence === 'high').length,
    [localAccounts]
  );
  const mediumCount = useMemo(
    () => localAccounts.filter((a) => a.classificationConfidence === 'medium').length,
    [localAccounts]
  );
  const lowCount = useMemo(
    () => localAccounts.filter((a) => a.classificationConfidence === 'low').length,
    [localAccounts]
  );
  const manualCount = useMemo(
    () => localAccounts.filter((a) => a.isManuallyClassified).length,
    [localAccounts]
  );
  const autoCount = localAccounts.length - manualCount;

  const filteredAccounts = useMemo(() => {
    if (filter === 'review') return localAccounts.filter((a) => a.classificationConfidence === 'low');
    if (filter === 'manual') return localAccounts.filter((a) => a.isManuallyClassified);
    return localAccounts;
  }, [localAccounts, filter]);

  const updateAccount = (id: string, patch: Partial<Account>) => {
    setLocalAccounts((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, ...patch, isManuallyClassified: true, classificationSource: 'manual' }
          : a
      )
    );
  };

  const showCostBehavior = (type: AccountType) => type === 'cogs' || type === 'expense';

  return (
    <div className="flex flex-col gap-6">
      {/* Summary banner */}
      <div
        className="rounded-lg border px-4 py-3 flex flex-wrap items-center gap-4"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted))' }}
      >
        <span className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>
          {autoCount} accounts auto-classified
        </span>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-green-600 text-white">
            {highCount} high
          </span>
          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-amber-500 text-white">
            {mediumCount} medium
          </span>
          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-red-500 text-white">
            {lowCount} low
          </span>
        </div>
        {manualCount > 0 && (
          <Badge variant="outline" className="text-xs">
            {manualCount} manual override{manualCount !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* Filter buttons */}
      <div className="flex gap-2">
        {(['all', 'review', 'manual'] as FilterMode[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            data-testid={`filter-${f}`}
            className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              background: filter === f ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
              color: filter === f ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
            }}
          >
            {f === 'all' ? `All (${localAccounts.length})` : f === 'review' ? `Review Needed (${lowCount})` : `Manual Overrides (${manualCount})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div
        className="overflow-x-auto rounded-lg border"
        style={{ borderColor: 'hsl(var(--border))' }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--muted))' }}>
              {['Acct #', 'Name', 'Type', 'Conf.', 'Source', 'Behavior'].map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-left font-medium text-xs uppercase tracking-wide whitespace-nowrap"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.map((account, idx) => {
              const conf = account.classificationConfidence;
              const confStyle = conf ? CONFIDENCE_STYLES[conf] : null;
              const source = account.classificationSource;
              const sourceBadge = source ? SOURCE_BADGE[source] : null;
              const isProfileHint = source === 'profile_keyword';

              return (
                <tr
                  key={account.id}
                  style={{
                    borderBottom: idx < filteredAccounts.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                    background: isProfileHint ? 'hsl(var(--accent) / 0.3)' : undefined,
                  }}
                >
                  {/* Account # */}
                  <td className="px-3 py-2 font-mono text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {account.number ?? '—'}
                  </td>

                  {/* Name */}
                  <td className="px-3 py-2 font-medium" style={{ color: 'hsl(var(--foreground))', maxWidth: '10rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span title={account.name}>{account.name}</span>
                    {account.isManuallyClassified && (
                      <Badge variant="outline" className="ml-1 text-xs">manual</Badge>
                    )}
                  </td>

                  {/* Type */}
                  <td className="px-3 py-2">
                    <select
                      value={account.type}
                      onChange={(e) => updateAccount(account.id, { type: e.target.value as AccountType })}
                      data-testid={`type-select-${account.id}`}
                      className="rounded-md border px-2 py-1 text-xs outline-none focus:ring-2"
                      style={{
                        borderColor: 'hsl(var(--border))',
                        background: 'hsl(var(--background))',
                        color: 'hsl(var(--foreground))',
                      }}
                    >
                      {accountTypeOptions.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Confidence */}
                  <td className="px-3 py-2">
                    {confStyle ? (
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${confStyle.bg} ${confStyle.text}`}>
                        {confStyle.label}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>—</span>
                    )}
                  </td>

                  {/* Source badge */}
                  <td className="px-3 py-2">
                    {sourceBadge ? (
                      <span
                        title={account.classificationHintFired ?? ''}
                        className="cursor-help"
                      >
                        <Badge variant={sourceBadge.variant} className="text-xs">
                          {sourceBadge.label}
                        </Badge>
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>—</span>
                    )}
                  </td>

                  {/* Cost Behavior */}
                  <td className="px-3 py-2">
                    {showCostBehavior(account.type) ? (
                      <select
                        value={account.costBehavior ?? 'unclassified'}
                        onChange={(e) =>
                          updateAccount(account.id, { costBehavior: e.target.value as CostBehavior })
                        }
                        data-testid={`behavior-select-${account.id}`}
                        className="rounded-md border px-2 py-1 text-xs outline-none focus:ring-2"
                        style={{
                          borderColor: 'hsl(var(--border))',
                          background: 'hsl(var(--background))',
                          color: 'hsl(var(--foreground))',
                        }}
                      >
                        {COST_BEHAVIORS.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>N/A</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredAccounts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  No accounts match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack} data-testid="classification-back">
          ← Back
        </Button>
        <Button onClick={() => onConfirm(localAccounts)} data-testid="classification-confirm">
          Confirm &amp; Import
        </Button>
      </div>
    </div>
  );
}
