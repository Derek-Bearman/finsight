'use client';

/**
 * Corporate benchmarks panel (FRANCHISE_BENCHMARKS_PLAN.md §F2) — mounted per
 * franchise row inside FranchiseManager (canManage only). Lists the versioned
 * benchmark sets with activate/delete, and adds new sets two ways: a CSV
 * upload (metric_id,target,direction,notes; template downloadable) or a
 * manual row editor.
 *
 * Percent-format metrics are ENTERED as whole percents (30 = 30%) and STORED
 * as 0-1 fractions — the exact convention TargetsEditor uses — so composed
 * KpiTargets render correctly everywhere. Metric formats resolve through the
 * ratio registry first, then the franchise's industry profile's operational
 * metrics; free-text metric ids have no known format and are stored as typed.
 *
 * Every successful mutation invalidates the module-level franchise cache so
 * open workspaces recompose their effective targets.
 */

import { useMemo, useState, useTransition, type ChangeEvent } from 'react';
import Papa from 'papaparse';
import type { FranchiseBenchmarkMetric, FranchiseBenchmarkSet, MetricFormat } from '@/types';
import type { Franchise } from '@/lib/data/franchises';
import {
  saveBenchmarkSetAction,
  activateBenchmarkSetAction,
  deleteBenchmarkSetAction,
} from '@/lib/data/franchise-actions';
import { invalidateFranchiseCache } from '@/lib/franchise/useEffectiveTargets';
import { RATIO_DEFS, RATIO_DEF_MAP } from '@/lib/targets';
import { getProfile } from '@/lib/profiles';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type FranchiseWithLinks = Franchise & { linkedCount: number };

const CUSTOM_METRIC = '__custom__';

// ─────────────────────────────────────────────
// Format + percent helpers (mirrors TargetsEditor)
// ─────────────────────────────────────────────

/** Known format for a metric id: ratio registry, then the franchise
 *  profile's operational metrics, else null (free-text operational id). */
function metricFormat(metricId: string, profileId: string | null): MetricFormat | null {
  const ratio = RATIO_DEF_MAP[metricId];
  if (ratio) return ratio.format;
  if (profileId) {
    const op = getProfile(profileId).operationalMetrics.find((m) => m.id === metricId);
    if (op) return op.format;
  }
  return null;
}

/** As typed ("30" = 30% for percent metrics) → stored value (0.3). */
function fromRaw(raw: string, format: MetricFormat | null): number | null {
  const n = parseFloat(raw);
  if (isNaN(n)) return null;
  return format === 'percent' ? n / 100 : n;
}

function unitSuffix(format: MetricFormat | null): string {
  if (format === 'percent') return '%';
  if (format === 'currency') return '$';
  if (format === 'ratio') return '×';
  return '';
}

// ─────────────────────────────────────────────
// CSV template + parsing
// ─────────────────────────────────────────────

function buildTemplateCsv(): string {
  const exampleRows = RATIO_DEFS.map((d) => {
    const value =
      d.format === 'percent'
        ? String(Number((d.defaultBenchmark.good * 100).toFixed(4)))
        : String(d.defaultBenchmark.good);
    const direction = d.defaultDirection === 'at_least' ? 'gte' : 'lte';
    return `${d.key},${value},${direction},`;
  });
  const lines = [
    '# FinSight corporate benchmark template',
    '# Columns: metric_id,target,direction,notes (direction: gte = at-or-above passes, lte = at-or-below passes)',
    '# Percent metrics are entered as whole percents (30 = 30%). Ratios and scores use their native unit.',
    '# Lines starting with # and blank lines are skipped. Example values below are FinSight defaults; replace with corporate numbers.',
    '# Financial ratio metric ids:',
    ...RATIO_DEFS.map((d) => `#   ${d.key} = ${d.label}`),
    '# Operational metric ids from your FinSight industry profile also work (e.g. food_cost_pct).',
    'metric_id,target,direction,notes',
    ...exampleRows,
  ];
  return lines.join('\r\n') + '\r\n';
}

interface CsvParseOutcome {
  metrics: FranchiseBenchmarkMetric[];
  errors: string[];
}

function parseBenchmarkCsv(text: string, profileId: string | null): CsvParseOutcome {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    comments: '#',
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const errors: string[] = [];
  for (const err of parsed.errors) {
    errors.push(`Row ${typeof err.row === 'number' ? err.row + 2 : '?'}: ${err.message}`);
  }
  const fields = parsed.meta.fields ?? [];
  if (!fields.includes('metric_id') || !fields.includes('target') || !fields.includes('direction')) {
    return {
      metrics: [],
      errors: ['The header row must include metric_id, target, and direction (notes is optional).'],
    };
  }
  const byId = new Map<string, FranchiseBenchmarkMetric>();
  parsed.data.forEach((row, i) => {
    // Data-row index + header row, 1-based. Comment/blank lines are not
    // counted by PapaParse, so this is approximate when they are interleaved.
    const line = i + 2;
    const metricId = (row.metric_id ?? '').trim();
    const rawTarget = (row.target ?? '').trim();
    const rawDirection = (row.direction ?? '').trim().toLowerCase();
    const notes = (row.notes ?? '').trim();
    if (!metricId && !rawTarget && !rawDirection) return; // effectively blank
    if (!metricId) {
      errors.push(`Row ${line}: missing metric_id.`);
      return;
    }
    const n = Number(rawTarget);
    if (rawTarget === '' || !Number.isFinite(n)) {
      errors.push(`Row ${line} (${metricId}): target "${rawTarget}" is not a number.`);
      return;
    }
    if (rawDirection !== 'gte' && rawDirection !== 'lte') {
      errors.push(`Row ${line} (${metricId}): direction must be gte or lte.`);
      return;
    }
    if (byId.has(metricId)) {
      errors.push(`Row ${line}: duplicate metric_id "${metricId}" — the last row wins.`);
    }
    const format = metricFormat(metricId, profileId);
    const target = format === 'percent' ? n / 100 : n;
    byId.set(metricId, {
      metricId,
      target,
      direction: rawDirection,
      ...(notes ? { notes } : {}),
    });
  });
  return { metrics: [...byId.values()], errors };
}

// ─────────────────────────────────────────────
// Manual editor rows
// ─────────────────────────────────────────────

interface EditorRow {
  /** Selected option id, or CUSTOM_METRIC for a free-text id. */
  metricId: string;
  customId: string;
  /** As typed: percents in whole numbers ("30" = 30%). */
  raw: string;
  direction: 'gte' | 'lte';
  notes: string;
}

function emptyRow(): EditorRow {
  return { metricId: RATIO_DEFS[0]!.key, customId: '', raw: '', direction: 'gte', notes: '' };
}

interface MetricOption {
  id: string;
  label: string;
  format: MetricFormat;
  defaultDirection: 'gte' | 'lte';
}

// ─────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────

export function BenchmarkSetPanel({
  franchise,
  onUpdated,
}: {
  franchise: FranchiseWithLinks;
  /** Receives the updated franchise (with linkedCount) after any mutation. */
  onUpdated: (franchise: FranchiseWithLinks) => void;
}) {
  const sets = useMemo(() => franchise.config.benchmarkSets ?? [], [franchise.config.benchmarkSets]);

  // Add-set form
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<'csv' | 'manual'>('csv');
  const [label, setLabel] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [makeActive, setMakeActive] = useState(true);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvMetrics, setCsvMetrics] = useState<FranchiseBenchmarkMetric[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [rows, setRows] = useState<EditorRow[]>([emptyRow()]);

  const [deleteTarget, setDeleteTarget] = useState<FranchiseBenchmarkSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const metricOptions: MetricOption[] = useMemo(() => {
    const opts: MetricOption[] = RATIO_DEFS.map((d) => ({
      id: d.key,
      label: d.label,
      format: d.format,
      defaultDirection: d.defaultDirection === 'at_least' ? 'gte' : 'lte',
    }));
    if (franchise.industryProfileId) {
      for (const m of getProfile(franchise.industryProfileId).operationalMetrics) {
        opts.push({
          id: m.id,
          label: `${m.label} (operational)`,
          format: m.format,
          defaultDirection: m.benchmark?.direction === 'lower' ? 'lte' : 'gte',
        });
      }
    }
    return opts;
  }, [franchise.industryProfileId]);

  const optionMap = useMemo(
    () => new Map(metricOptions.map((o) => [o.id, o])),
    [metricOptions]
  );

  function openAddForm() {
    setError(null);
    setAdding(true);
    setMode('csv');
    setLabel('');
    setEffectiveDate('');
    setMakeActive(sets.length === 0 || !sets.some((s) => s.active));
    setCsvFileName(null);
    setCsvMetrics([]);
    setCsvErrors([]);
    setRows([emptyRow()]);
  }

  function closeAddForm() {
    setAdding(false);
    setError(null);
  }

  function downloadTemplate() {
    const blob = new Blob([buildTemplateCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'corporate-benchmark-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    setError(null);
    try {
      const text = await file.text();
      const outcome = parseBenchmarkCsv(text, franchise.industryProfileId);
      setCsvMetrics(outcome.metrics);
      setCsvErrors(outcome.errors);
    } catch {
      setCsvMetrics([]);
      setCsvErrors(['Could not read that file. Save it as a plain .csv and try again.']);
    }
    // Allow re-selecting the same file after a fix.
    e.target.value = '';
  }

  /** Collect manual rows into metrics; returns an error string on failure. */
  function collectManualMetrics(): { metrics: FranchiseBenchmarkMetric[] } | { error: string } {
    const byId = new Map<string, FranchiseBenchmarkMetric>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const isCustom = row.metricId === CUSTOM_METRIC;
      const id = isCustom ? row.customId.trim() : row.metricId;
      if (!id && row.raw.trim() === '' && row.notes.trim() === '') continue; // untouched row
      if (!id) return { error: `Row ${i + 1}: enter a metric id.` };
      const format = isCustom ? metricFormat(id, franchise.industryProfileId) : optionMap.get(id)?.format ?? null;
      const value = fromRaw(row.raw, format);
      if (value === null || !Number.isFinite(value)) {
        return { error: `Row ${i + 1} (${id}): enter a numeric target.` };
      }
      if (byId.has(id)) return { error: `Row ${i + 1}: metric "${id}" appears twice.` };
      const notes = row.notes.trim();
      byId.set(id, {
        metricId: id,
        target: value,
        direction: row.direction,
        ...(notes ? { notes } : {}),
      });
    }
    return { metrics: [...byId.values()] };
  }

  function handleSave() {
    setError(null);
    let metrics: FranchiseBenchmarkMetric[];
    if (mode === 'csv') {
      metrics = csvMetrics;
    } else {
      const collected = collectManualMetrics();
      if ('error' in collected) return setError(collected.error);
      metrics = collected.metrics;
    }
    if (!label.trim()) return setError('Give this benchmark set a label (e.g. "FY2027 corporate targets").');
    if (metrics.length === 0) {
      return setError(mode === 'csv' ? 'Upload a CSV with at least one valid metric row first.' : 'Add at least one metric row.');
    }
    const set: FranchiseBenchmarkSet = {
      id: crypto.randomUUID(),
      label: label.trim(),
      ...(effectiveDate ? { effectiveDate } : {}),
      uploadedAt: new Date().toISOString(), // restamped server-side
      active: makeActive,
      metrics,
    };
    startTransition(async () => {
      const res = await saveBenchmarkSetAction({ franchiseId: franchise.id, set });
      if (!res.ok) return setError(res.error);
      invalidateFranchiseCache();
      onUpdated(res.data);
      setAdding(false);
    });
  }

  function handleActivate(set: FranchiseBenchmarkSet) {
    setError(null);
    startTransition(async () => {
      const res = await activateBenchmarkSetAction({ franchiseId: franchise.id, setId: set.id });
      if (!res.ok) return setError(res.error);
      invalidateFranchiseCache();
      onUpdated(res.data);
    });
  }

  function handleDelete() {
    const target = deleteTarget;
    if (!target) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteBenchmarkSetAction({ franchiseId: franchise.id, setId: target.id });
      setDeleteTarget(null);
      if (!res.ok) return setError(res.error);
      invalidateFranchiseCache();
      onUpdated(res.data);
    });
  }

  const patchRow = (index: number, patch: Partial<EditorRow>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3" data-testid="benchmark-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">Corporate benchmarks</h4>
          <p className="text-xs text-muted-foreground">
            The active set applies to every linked client. Client-specific targets still win per metric.
          </p>
        </div>
        {!adding && (
          <Button size="sm" onClick={openAddForm} disabled={pending} data-testid="benchmark-add">
            Add benchmark set
          </Button>
        )}
      </div>

      {sets.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="benchmark-empty">
          No benchmark sets yet. Upload the corporate CSV or enter targets manually.
        </p>
      ) : (
        <div className="space-y-2">
          {sets.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
              data-testid="benchmark-set-row"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.label}</span>
                {s.active && <Badge data-testid="benchmark-set-active-badge">Active</Badge>}
                <span className="text-xs text-muted-foreground">
                  {s.metrics.length} metric{s.metrics.length === 1 ? '' : 's'}
                  {s.effectiveDate ? ` · Effective ${s.effectiveDate}` : ''}
                  {' · Uploaded '}
                  {new Date(s.uploadedAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {!s.active && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleActivate(s)}
                    disabled={pending}
                    data-testid="benchmark-set-activate"
                  >
                    Activate
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteTarget(s)}
                  disabled={pending}
                  data-testid="benchmark-set-delete"
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="space-y-3 rounded-md border border-border bg-background p-3" data-testid="benchmark-add-form">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <label htmlFor={`benchmark-label-${franchise.id}`} className="text-xs text-muted-foreground">
                Set label
              </label>
              <input
                id={`benchmark-label-${franchise.id}`}
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={80}
                placeholder='e.g. "FY2027 corporate targets"'
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                data-testid="benchmark-set-label"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`benchmark-effective-${franchise.id}`} className="text-xs text-muted-foreground">
                Effective date (optional)
              </label>
              <input
                id={`benchmark-effective-${franchise.id}`}
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                data-testid="benchmark-set-effective-date"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={makeActive}
                onChange={(e) => setMakeActive(e.target.checked)}
                data-testid="benchmark-set-make-active"
              />
              Make active
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={mode === 'csv' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('csv')}
              data-testid="benchmark-mode-csv"
            >
              Upload CSV
            </Button>
            <Button
              variant={mode === 'manual' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('manual')}
              data-testid="benchmark-mode-manual"
            >
              Manual entry
            </Button>
          </div>

          {mode === 'csv' ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFile}
                  className="text-sm"
                  aria-label="Benchmark CSV file"
                  data-testid="benchmark-csv-input"
                />
                <Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="benchmark-template-download">
                  Download template
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Columns: metric_id, target, direction (gte or lte), notes. Percent metrics as whole
                percents (30 = 30%). Lines starting with # are skipped.
              </p>
              {csvFileName && (
                <p className="text-sm" data-testid="benchmark-csv-summary">
                  {csvMetrics.length} metric{csvMetrics.length === 1 ? '' : 's'} parsed from {csvFileName}
                  {csvErrors.length > 0 ? ` · ${csvErrors.length} problem${csvErrors.length === 1 ? '' : 's'}` : ''}
                </p>
              )}
              {csvErrors.length > 0 && (
                <ul
                  className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-destructive"
                  data-testid="benchmark-csv-errors"
                >
                  {csvErrors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((row, i) => {
                const isCustom = row.metricId === CUSTOM_METRIC;
                const format = isCustom
                  ? metricFormat(row.customId.trim(), franchise.industryProfileId)
                  : optionMap.get(row.metricId)?.format ?? null;
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2" data-testid="benchmark-manual-row">
                    <select
                      value={row.metricId}
                      onChange={(e) => {
                        const next = e.target.value;
                        const opt = optionMap.get(next);
                        patchRow(i, {
                          metricId: next,
                          ...(opt ? { direction: opt.defaultDirection } : {}),
                        });
                      }}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                      aria-label={`Row ${i + 1} metric`}
                      data-testid="benchmark-manual-metric"
                    >
                      {metricOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                      <option value={CUSTOM_METRIC}>Custom metric id…</option>
                    </select>
                    {isCustom && (
                      <input
                        type="text"
                        value={row.customId}
                        onChange={(e) => patchRow(i, { customId: e.target.value })}
                        placeholder="metric_id"
                        className="w-40 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                        aria-label={`Row ${i + 1} custom metric id`}
                        data-testid="benchmark-manual-custom-id"
                      />
                    )}
                    <select
                      value={row.direction}
                      onChange={(e) => patchRow(i, { direction: e.target.value as 'gte' | 'lte' })}
                      className="rounded-md border border-border bg-background px-1.5 py-1.5 text-sm"
                      aria-label={`Row ${i + 1} rule`}
                      data-testid="benchmark-manual-direction"
                    >
                      <option value="gte">≥</option>
                      <option value="lte">≤</option>
                    </select>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="any"
                        value={row.raw}
                        onChange={(e) => patchRow(i, { raw: e.target.value })}
                        placeholder="—"
                        className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                        aria-label={`Row ${i + 1} target value`}
                        data-testid="benchmark-manual-target"
                      />
                      <span className="text-xs text-muted-foreground">{unitSuffix(format)}</span>
                    </div>
                    <input
                      type="text"
                      value={row.notes}
                      onChange={(e) => patchRow(i, { notes: e.target.value })}
                      placeholder="Notes (optional)"
                      className="min-w-32 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                      aria-label={`Row ${i + 1} notes`}
                      data-testid="benchmark-manual-notes"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                      disabled={rows.length === 1}
                      aria-label={`Remove row ${i + 1}`}
                      data-testid="benchmark-manual-remove"
                    >
                      Remove
                    </Button>
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRows((prev) => [...prev, emptyRow()])}
                  data-testid="benchmark-manual-add-row"
                >
                  Add row
                </Button>
                <p className="text-xs text-muted-foreground">
                  Percent metrics as whole percents (30 = 30%). Custom metric ids are stored as typed.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={pending} data-testid="benchmark-set-save">
              {pending ? 'Saving…' : 'Save benchmark set'}
            </Button>
            <Button variant="outline" onClick={closeAddForm} disabled={pending} data-testid="benchmark-set-cancel">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert" data-testid="benchmark-error">
          {error}
        </p>
      )}

      {/* Delete confirmation — house dialog, destructive action */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this benchmark set?</DialogTitle>
            <DialogDescription>
              This permanently removes <strong>{deleteTarget?.label}</strong> (
              {deleteTarget?.metrics.length ?? 0} metric{(deleteTarget?.metrics.length ?? 0) === 1 ? '' : 's'})
              from {franchise.name}.
              {deleteTarget?.active
                ? ' It is the ACTIVE set — linked clients will fall back to industry packs or FinSight defaults until another set is activated.'
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              data-testid="benchmark-set-delete-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={handleDelete}
              data-testid="benchmark-set-delete-confirm"
            >
              {pending ? 'Deleting…' : 'Delete set'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
