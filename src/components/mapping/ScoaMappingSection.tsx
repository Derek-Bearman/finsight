'use client';

/**
 * Corporate SCOA mapping section (FRANCHISE_BENCHMARKS_PLAN.md §F4) — shown on
 * the Mapping tab only when the workspace is linked to a franchise whose
 * config carries an uploaded corporate standard chart of accounts.
 *
 * Renders the auditScoa() result as summary chips + three work lists
 * (discrepancies, missing, extra) and lets the user persist
 * Account.scoaNumber assignments. Every mutation flows through the SAME
 * onAccountsChange handler the mapping views use (store batchUpdateAccounts),
 * so cloud-sync persists it with the workspace jsonb.
 *
 * The franchise (and its config.scoa) comes from useEffectiveTargets' cached
 * getFranchiseState() fetch — the same session cache every other franchise
 * surface reads, invalidated by SCOA uploads via invalidateFranchiseCache().
 */

import React, { useMemo, useState } from 'react';
import type { Account, ClientWorkspace, FranchiseScoaAccount } from '@/types';
import { auditScoa, scoaCoverage, type ScoaDiscrepancy } from '@/lib/franchise/scoa-audit';
import { useEffectiveTargets } from '@/lib/franchise/useEffectiveTargets';

export interface ScoaMappingSectionProps {
  workspace: ClientWorkspace;
  /** Same persistence path as the mapping views (store batchUpdateAccounts). */
  onAccountsChange: (accounts: Account[]) => void;
  /** Optional toast hook-up from the page. */
  onNotify?: (msg: string) => void;
}

const MATCHED_BY_LABELS: Record<ScoaDiscrepancy['matchedBy'], string> = {
  mapping: 'Explicit',
  number: 'Number match',
  name: 'Name match',
};

function scoaLabel(s: FranchiseScoaAccount): string {
  return `${s.number} · ${s.name}`;
}

function accountLabel(a: Account): string {
  return a.number ? `${a.number} · ${a.name}` : a.name;
}

/** Small count chip used in the audit summary row. */
function SummaryChip({
  label,
  count,
  tone,
  testId,
}: {
  label: string;
  count: number;
  tone: 'green' | 'amber' | 'red' | 'muted';
  testId: string;
}) {
  const colors: Record<typeof tone, { fg: string; bg: string; border: string }> = {
    green: { fg: 'hsl(142 76% 28%)', bg: 'hsl(142 76% 36% / 0.08)', border: 'hsl(142 76% 36% / 0.4)' },
    amber: { fg: 'hsl(32 81% 29%)', bg: 'hsl(38 92% 50% / 0.08)', border: 'hsl(38 92% 50% / 0.4)' },
    red: { fg: 'hsl(0 72% 40%)', bg: 'hsl(0 72% 51% / 0.06)', border: 'hsl(0 72% 51% / 0.4)' },
    muted: { fg: 'hsl(var(--muted-foreground))', bg: 'hsl(var(--muted) / 0.5)', border: 'hsl(var(--border))' },
  };
  const c = count === 0 ? colors.muted : colors[tone];
  return (
    <span
      data-testid={testId}
      className="rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{ borderColor: c.border, background: c.bg, color: c.fg }}
    >
      {count} {label}
    </span>
  );
}

export function ScoaMappingSection({ workspace, onAccountsChange, onNotify }: ScoaMappingSectionProps) {
  const { franchise } = useEffectiveTargets(workspace);
  const [expanded, setExpanded] = useState(false);

  const scoa = franchise?.config.scoa;

  const audit = useMemo(
    () => (scoa && scoa.accounts.length > 0 ? auditScoa(scoa.accounts, workspace.accounts) : null),
    [scoa, workspace.accounts]
  );

  // Section exists only for franchise-linked workspaces with an uploaded SCOA.
  if (!workspace.franchiseId || !scoa || scoa.accounts.length === 0 || !audit) return null;

  const suggestionCount = Object.keys(audit.autoMap).length;
  const mappedCount = workspace.accounts.filter((a) => a.scoaNumber).length;
  const reviewCount = audit.discrepancies.length + audit.missing.length + audit.extra.length;

  /** Apply scoaNumber assignments (null clears) through the store path. */
  const assignScoaNumbers = (assignments: Record<string, string | null>) => {
    const updated = workspace.accounts.map((a) => {
      const value = assignments[a.id];
      if (value === undefined) return a;
      if (value === null) {
        const rest: Account = { ...a };
        delete rest.scoaNumber;
        return rest;
      }
      return { ...a, scoaNumber: value };
    });
    onAccountsChange(updated);
  };

  const handleApplySuggested = () => {
    if (suggestionCount === 0) return;
    assignScoaNumbers(audit.autoMap);
    onNotify?.(
      `${suggestionCount} suggested SCOA mapping${suggestionCount !== 1 ? 's' : ''} applied`
    );
  };

  const handleMapOne = (account: Account, scoaNumber: string) => {
    assignScoaNumbers({ [account.id]: scoaNumber });
    onNotify?.(`${account.name} mapped to SCOA ${scoaNumber}`);
  };

  const handleUnmap = (account: Account) => {
    assignScoaNumbers({ [account.id]: null });
    onNotify?.(`${account.name} unmapped`);
  };

  return (
    <section
      data-testid="scoa-mapping-section"
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
    >
      {/* Collapsible header */}
      <button
        type="button"
        data-testid="scoa-mapping-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            aria-hidden
            className="text-xs"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            {expanded ? '▾' : '▸'}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold" style={{ color: 'hsl(var(--foreground))' }}>
              Corporate SCOA mapping
            </h2>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {franchise?.name ?? workspace.franchiseName ?? 'Franchise'} · {scoaCoverage(audit, scoa.accounts.length)} ·{' '}
              {mappedCount} of {workspace.accounts.length} client accounts mapped
            </p>
          </div>
        </div>
        <span
          className="rounded-full border px-2.5 py-1 text-xs font-medium flex-shrink-0"
          style={
            reviewCount > 0
              ? {
                  borderColor: 'hsl(38 92% 50% / 0.4)',
                  background: 'hsl(38 92% 50% / 0.08)',
                  color: 'hsl(32 81% 29%)',
                }
              : {
                  borderColor: 'hsl(142 76% 36% / 0.4)',
                  background: 'hsl(142 76% 36% / 0.08)',
                  color: 'hsl(142 76% 28%)',
                }
          }
        >
          {reviewCount > 0 ? `${reviewCount} to review` : 'All aligned'}
        </span>
      </button>

      {expanded && (
        <div
          className="border-t px-4 py-4 flex flex-col gap-5"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          {/* Audit summary chips + apply-suggested */}
          <div className="flex flex-wrap items-center gap-2">
            <SummaryChip label="matched clean" count={audit.matched.length} tone="green" testId="scoa-chip-matched" />
            <SummaryChip label={audit.discrepancies.length === 1 ? 'discrepancy' : 'discrepancies'} count={audit.discrepancies.length} tone="amber" testId="scoa-chip-discrepancies" />
            <SummaryChip label="missing from client" count={audit.missing.length} tone="red" testId="scoa-chip-missing" />
            <SummaryChip label={`extra client account${audit.extra.length !== 1 ? 's' : ''}`} count={audit.extra.length} tone="muted" testId="scoa-chip-extra" />

            {suggestionCount > 0 && (
              <button
                type="button"
                data-testid="scoa-apply-suggested"
                onClick={handleApplySuggested}
                className="ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors"
                style={{
                  background: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                }}
                title="Persist the audit's safe matches (exact number, then guarded name) as SCOA mappings on this client's accounts."
              >
                Apply suggested mappings ({suggestionCount})
              </button>
            )}
          </div>

          {/* Discrepancies — matched pairs whose number or name drifts */}
          {audit.discrepancies.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Discrepancies
              </h3>
              <div
                className="rounded-lg border overflow-x-auto"
                style={{ borderColor: 'hsl(var(--border))' }}
              >
                <table data-testid="scoa-discrepancies-table" className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr
                      className="text-left text-xs"
                      style={{ color: 'hsl(var(--muted-foreground))', background: 'hsl(var(--muted) / 0.4)' }}
                    >
                      <th className="px-3 py-2 font-medium">SCOA account</th>
                      <th className="px-3 py-2 font-medium">Client account</th>
                      <th className="px-3 py-2 font-medium">Matched by</th>
                      <th className="px-3 py-2 font-medium">Drift</th>
                      <th className="px-3 py-2 font-medium" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {audit.discrepancies.map((d) => {
                      const alreadyMapped = d.account.scoaNumber === d.scoa.number;
                      return (
                        <tr
                          key={`${d.scoa.number}-${d.account.id}`}
                          data-testid="scoa-discrepancy-row"
                          className="border-t"
                          style={{ borderColor: 'hsl(var(--border))' }}
                        >
                          <td className="px-3 py-2" style={{ color: 'hsl(var(--foreground))' }}>
                            {scoaLabel(d.scoa)}
                          </td>
                          <td className="px-3 py-2" style={{ color: 'hsl(var(--foreground))' }}>
                            {accountLabel(d.account)}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className="rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap"
                              style={{
                                borderColor: 'hsl(var(--border))',
                                color: 'hsl(var(--muted-foreground))',
                                background: 'hsl(var(--muted) / 0.4)',
                              }}
                            >
                              {MATCHED_BY_LABELS[d.matchedBy]}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'hsl(32 81% 29%)' }}>
                            {[d.numberMismatch ? 'Number differs' : null, d.nameMismatch ? 'Name differs' : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {alreadyMapped ? (
                              <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                                Mapped
                              </span>
                            ) : (
                              <button
                                type="button"
                                data-testid="scoa-map-btn"
                                onClick={() => handleMapOne(d.account, d.scoa.number)}
                                className="rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
                                style={{
                                  borderColor: 'hsl(var(--primary) / 0.4)',
                                  color: 'hsl(var(--primary))',
                                  background: 'hsl(var(--background))',
                                }}
                                title={`Persist the mapping: ${accountLabel(d.account)} to SCOA ${d.scoa.number}`}
                              >
                                Map
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Missing — SCOA accounts with no client counterpart (read-only) */}
          {audit.missing.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Missing from client
              </h3>
              <ul
                data-testid="scoa-missing-list"
                className="rounded-lg border px-3 py-2 max-h-48 overflow-y-auto flex flex-col gap-1"
                style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted) / 0.25)' }}
              >
                {audit.missing.map((m) => (
                  <li key={m.number} className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {scoaLabel(m)}
                    {m.statementType ? ` (${m.statementType === 'pnl' ? 'P&L' : 'Balance Sheet'})` : ''}
                  </li>
                ))}
              </ul>
              <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                These corporate accounts have no counterpart in this client&apos;s chart. Nothing to do here unless the client adds them.
              </p>
            </div>
          )}

          {/* Extra — client accounts absent from the SCOA (manual mapping) */}
          {audit.extra.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Extra client accounts
              </h3>
              <ul data-testid="scoa-extra-list" className="flex flex-col gap-1.5">
                {audit.extra.map((a) => (
                  <li
                    key={a.id}
                    data-testid="scoa-extra-row"
                    className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
                    style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--background))' }}
                  >
                    <span className="text-sm flex-1 min-w-40 truncate" style={{ color: 'hsl(var(--foreground))' }}>
                      {accountLabel(a)}
                    </span>

                    {a.scoaNumber && (
                      <span
                        className="rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap"
                        style={{
                          borderColor: 'hsl(38 92% 50% / 0.4)',
                          background: 'hsl(38 92% 50% / 0.08)',
                          color: 'hsl(32 81% 29%)',
                        }}
                        title="This account carries a SCOA number that is not (or no longer) claimable in the current corporate chart."
                      >
                        Mapped to {a.scoaNumber}
                      </span>
                    )}

                    <select
                      data-testid="scoa-extra-select"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) handleMapOne(a, e.target.value);
                      }}
                      className="rounded-md border px-2 py-1 text-xs cursor-pointer max-w-64"
                      style={{
                        borderColor: 'hsl(var(--border))',
                        background: 'hsl(var(--card))',
                        color: 'hsl(var(--foreground))',
                      }}
                      aria-label={`Map ${a.name} to a SCOA account`}
                    >
                      <option value="" disabled>
                        Map to SCOA account…
                      </option>
                      {scoa.accounts.map((s) => (
                        <option key={s.number} value={s.number}>
                          {scoaLabel(s)}
                        </option>
                      ))}
                    </select>

                    {a.scoaNumber && (
                      <button
                        type="button"
                        data-testid="scoa-unmap-btn"
                        onClick={() => handleUnmap(a)}
                        className="rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
                        style={{
                          borderColor: 'hsl(var(--border))',
                          color: 'hsl(var(--muted-foreground))',
                          background: 'hsl(var(--background))',
                        }}
                      >
                        Unmap
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Accounts the corporate chart does not know about. Map each to its closest SCOA account so cross-franchisee rollups line up, or leave unmapped to keep them client-only.
              </p>
            </div>
          )}

          {reviewCount === 0 && (
            <p className="text-sm" style={{ color: 'hsl(142 76% 28%)' }}>
              Every client account lines up with the corporate chart. Nothing to review.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
