'use client';

/**
 * Corporate SCOA bucket mapper (SCOA_ROLLUP_PLAN.md, Phase 3).
 *
 * The many-to-one mapping UX: unmapped client accounts on the left, the
 * franchisor's corporate lines as drop-target buckets on the right. Drag an
 * account onto a line (or use its dropdown) to fold it in; many accounts can
 * share one line. Auto-match pre-fills the safe exact-number/name matches.
 * Every assignment writes Account.scoaNumber through the same onAccountsChange
 * path the mapping views use, so cloud-sync persists it and the Reports-tab
 * corporate-line comparison rolls up on it.
 *
 * Replaces ScoaMappingSection on the mapping surfaces. Keeps the
 * scoa-mapping-section / scoa-mapping-toggle / scoa-apply-suggested testids so
 * the page tour and any references keep working.
 */

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { Account, ClientWorkspace, FranchiseScoaAccount } from '@/types';
import { auditScoa } from '@/lib/franchise/scoa-audit';
import { useEffectiveTargets } from '@/lib/franchise/useEffectiveTargets';

export interface ScoaBucketMapperProps {
  workspace: ClientWorkspace;
  onAccountsChange: (accounts: Account[]) => void;
  onNotify?: (msg: string) => void;
}

function accountLabel(a: Account): string {
  return a.number ? `${a.number} · ${a.name}` : a.name;
}

// ── Draggable unmapped account ──────────────────────────────────────────────
function DraggableAccount({ account }: { account: Account }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: account.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-testid="scoa-unmapped-account"
      className="rounded-lg border px-2.5 py-1.5 text-sm select-none"
      style={{
        borderColor: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        color: 'hsl(var(--foreground))',
        cursor: 'grab',
        opacity: isDragging ? 0.4 : 1,
        touchAction: 'none',
      }}
      title={account.name}
    >
      {accountLabel(account)}
    </div>
  );
}

// ── Droppable corporate-line bucket ─────────────────────────────────────────
function ScoaBucket({
  line,
  accounts,
  onUnmap,
}: {
  line: FranchiseScoaAccount;
  accounts: Account[];
  onUnmap: (a: Account) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `scoa:${line.number}` });
  return (
    <div
      ref={setNodeRef}
      data-testid="scoa-bucket"
      data-scoa-number={line.number}
      className="rounded-lg border p-2.5 transition-colors"
      style={{
        borderColor: isOver ? 'hsl(var(--primary))' : 'hsl(var(--border))',
        background: isOver ? 'hsl(var(--primary) / 0.06)' : 'hsl(var(--background))',
        borderStyle: accounts.length === 0 ? 'dashed' : 'solid',
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
            {line.name}
          </span>
          <span className="ml-1.5 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {line.number}
            {line.statementType ? ` · ${line.statementType === 'pnl' ? 'P&L' : 'BS'}` : ''}
          </span>
        </div>
        <span className="text-xs flex-shrink-0" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {accounts.length}
        </span>
      </div>
      {accounts.length === 0 ? (
        <p className="mt-1.5 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
          Drop accounts here
        </p>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {accounts.map((a) => (
            <span
              key={a.id}
              data-testid="scoa-bucket-chip"
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
              style={{
                borderColor: 'hsl(var(--primary) / 0.35)',
                background: 'hsl(var(--primary) / 0.06)',
                color: 'hsl(var(--foreground))',
              }}
              title={a.name}
            >
              <span className="truncate max-w-40">{a.name}</span>
              <button
                type="button"
                onClick={() => onUnmap(a)}
                aria-label={`Unmap ${a.name}`}
                data-testid="scoa-bucket-unmap"
                className="leading-none"
                style={{ color: 'hsl(var(--muted-foreground))' }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScoaBucketMapper({ workspace, onAccountsChange, onNotify }: ScoaBucketMapperProps) {
  const { franchise } = useEffectiveTargets(workspace);
  const scoa = franchise?.config.scoa;

  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const nonExcluded = useMemo(() => workspace.accounts.filter((a) => !a.isExcluded), [workspace.accounts]);

  // Valid corporate line numbers. A scoaNumber not in this set is a stale
  // mapping (the SCOA was re-uploaded / renumbered) — treated as unmapped so it
  // resurfaces in the left column and can be re-placed instead of vanishing.
  const validNumbers = useMemo(
    () => new Set((scoa?.accounts ?? []).map((s) => s.number.trim())),
    [scoa]
  );

  const groups = useMemo(() => {
    const m = new Map<string, Account[]>();
    for (const a of nonExcluded) {
      const key = a.scoaNumber?.trim();
      if (!key || !validNumbers.has(key)) continue;
      const list = m.get(key);
      if (list) list.push(a);
      else m.set(key, [a]);
    }
    return m;
  }, [nonExcluded, validNumbers]);

  const unmapped = useMemo(
    () =>
      nonExcluded.filter((a) => {
        const key = a.scoaNumber?.trim();
        return !key || !validNumbers.has(key);
      }),
    [nonExcluded, validNumbers]
  );
  const filteredUnmapped = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return unmapped;
    return unmapped.filter((a) => a.name.toLowerCase().includes(q) || (a.number ?? '').toLowerCase().includes(q));
  }, [unmapped, search]);

  // Auto-match over NON-excluded accounts only, so excluded summary rows never
  // get a scoaNumber written or inflate the suggestion count.
  const audit = useMemo(
    () => (scoa && scoa.accounts.length > 0 ? auditScoa(scoa.accounts, nonExcluded) : null),
    [scoa, nonExcluded]
  );
  const suggestionCount = audit ? Object.keys(audit.autoMap).length : 0;

  if (!workspace.franchiseId || !scoa || scoa.accounts.length === 0) return null;

  const mappedCount = nonExcluded.length - unmapped.length;
  const coverage = nonExcluded.length ? mappedCount / nonExcluded.length : 0;

  const assign = (accountId: string, number: string | null) => {
    const updated = workspace.accounts.map((a) => {
      if (a.id !== accountId) return a;
      if (number === null) {
        const rest: Account = { ...a };
        delete rest.scoaNumber;
        return rest;
      }
      return { ...a, scoaNumber: number };
    });
    onAccountsChange(updated);
  };

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const overId = e.over?.id;
    if (typeof overId === 'string' && overId.startsWith('scoa:')) {
      const number = overId.slice('scoa:'.length);
      const acct = workspace.accounts.find((a) => a.id === e.active.id);
      assign(String(e.active.id), number);
      if (acct) onNotify?.(`${acct.name} mapped to ${number}`);
    }
  };

  const applyAuto = () => {
    if (!audit || suggestionCount === 0) return;
    const updated = workspace.accounts.map((a) => {
      const n = audit.autoMap[a.id];
      return n ? { ...a, scoaNumber: n } : a;
    });
    onAccountsChange(updated);
    onNotify?.(`${suggestionCount} account${suggestionCount === 1 ? '' : 's'} auto-matched`);
  };

  const activeAccount = activeId ? workspace.accounts.find((a) => a.id === activeId) ?? null : null;

  return (
    <section
      data-testid="scoa-mapping-section"
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
    >
      {/* Collapsible header with coverage */}
      <button
        type="button"
        data-testid="scoa-mapping-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span aria-hidden className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {expanded ? '▾' : '▸'}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold" style={{ color: 'hsl(var(--foreground))' }}>
              Corporate SCOA mapping
            </h2>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {franchise?.name ?? workspace.franchiseName ?? 'Franchise'} · {mappedCount} of {nonExcluded.length} accounts mapped ·{' '}
              {unmapped.length} to place
            </p>
          </div>
        </div>
        <span
          className="rounded-full border px-2.5 py-1 text-xs font-medium flex-shrink-0"
          style={
            unmapped.length > 0
              ? { borderColor: 'hsl(38 92% 50% / 0.4)', background: 'hsl(38 92% 50% / 0.08)', color: 'hsl(32 81% 29%)' }
              : { borderColor: 'hsl(142 76% 36% / 0.4)', background: 'hsl(142 76% 36% / 0.08)', color: 'hsl(142 76% 28%)' }
          }
        >
          {Math.round(coverage * 100)}% mapped
        </span>
      </button>

      {expanded && (
        <div className="border-t px-4 py-4 flex flex-col gap-3" style={{ borderColor: 'hsl(var(--border))' }}>
          {/* Coverage bar + controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-2 flex-1 min-w-40 rounded-full overflow-hidden" style={{ background: 'hsl(var(--muted))' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.round(coverage * 100)}%`, background: 'hsl(var(--primary))' }} />
            </div>
            {suggestionCount > 0 && (
              <button
                type="button"
                data-testid="scoa-apply-suggested"
                onClick={applyAuto}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold"
                style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
                title="Fold in the safe exact-number and guarded-name matches."
              >
                Auto-match ({suggestionCount})
              </button>
            )}
          </div>

          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="grid gap-3 md:grid-cols-2">
              {/* LEFT — unmapped accounts */}
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Unmapped accounts ({unmapped.length})
                </h3>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search accounts…"
                  data-testid="scoa-mapper-search"
                  className="rounded-md border px-2.5 py-1.5 text-sm"
                  style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
                />
                <div
                  className="rounded-lg border p-2 flex flex-col gap-1.5 max-h-96 overflow-y-auto"
                  style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted) / 0.25)' }}
                >
                  {unmapped.length === 0 ? (
                    <p className="text-xs py-2 text-center" style={{ color: 'hsl(142 76% 28%)' }}>
                      Every account is mapped.
                    </p>
                  ) : filteredUnmapped.length === 0 ? (
                    <p className="text-xs py-2 text-center" style={{ color: 'hsl(var(--muted-foreground))' }}>
                      No accounts match “{search}”.
                    </p>
                  ) : (
                    filteredUnmapped.map((a) => (
                      <div key={a.id} className="flex items-center gap-1.5">
                        <div className="flex-1 min-w-0">
                          <DraggableAccount account={a} />
                        </div>
                        {/* Click-to-assign fallback (mobile / no-drag / a11y) */}
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              assign(a.id, e.target.value);
                              onNotify?.(`${a.name} mapped to ${e.target.value}`);
                            }
                          }}
                          aria-label={`Map ${a.name} to a corporate line`}
                          data-testid="scoa-mapper-assign-select"
                          className="rounded-md border px-1.5 py-1 text-xs cursor-pointer flex-shrink-0 max-w-28"
                          style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }}
                        >
                          <option value="" disabled>
                            Map to…
                          </option>
                          {scoa.accounts.map((s) => (
                            <option key={s.number} value={s.number}>
                              {s.number} · {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* RIGHT — corporate line buckets */}
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Corporate chart ({scoa.accounts.length} lines)
                </h3>
                <div className="flex flex-col gap-2 max-h-[26rem] overflow-y-auto pr-1">
                  {scoa.accounts.map((line) => (
                    <ScoaBucket
                      key={line.number}
                      line={line}
                      accounts={groups.get(line.number.trim()) ?? []}
                      onUnmap={(a) => {
                        assign(a.id, null);
                        onNotify?.(`${a.name} unmapped`);
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <DragOverlay>
              {activeAccount ? (
                <div
                  className="rounded-lg border px-2.5 py-1.5 text-sm shadow-lg"
                  style={{ borderColor: 'hsl(var(--primary))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }}
                >
                  {accountLabel(activeAccount)}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Many accounts can map to one corporate line (e.g. every marketing account into “Marketing Expense”).
            Mapped accounts roll up into the corporate-line comparison on the Reports tab.
          </p>
        </div>
      )}
    </section>
  );
}
