'use client';

/**
 * Shared-input data entry (2026-07 refactor). One input per UNDERLYING NUMBER,
 * not per metric: fields that several metrics share (e.g. total_leads feeds
 * cost-per-lead and every funnel conversion rate) render ONCE, with a "used by"
 * callout listing every metric that derives from them. Entering each number a
 * single time per period was Derek's #1 operational-metrics complaint.
 *
 * Saved as an OperationalInputPool (period-scoped shared values) AND fanned
 * out to legacy per-metric OperationalDataPoints so pre-refactor consumers and
 * older workspaces keep working.
 */

import { useState, useCallback, useMemo } from 'react';
import type {
  OperationalMetricDef,
  OperationalMetricInputField,
  OperationalDataPoint,
  OperationalInputPool,
  Period,
} from '@/types';
import { periodLabel } from '@/lib/utils/period';

export interface DataEntrySave {
  pool: OperationalInputPool;
  /** Legacy fan-out: one point per metric that has at least one entered field. */
  points: OperationalDataPoint[];
}

export interface DataEntryFormProps {
  metricDefs: OperationalMetricDef[];
  existingData: OperationalDataPoint[];
  existingPools?: OperationalInputPool[];
  period: Period;
  onSave: (save: DataEntrySave) => void;
  onCancel: () => void;
}

interface SharedField {
  field: OperationalMetricInputField;
  /** Labels of every metric this field feeds. */
  usedBy: string[];
  /** Section = category of the first metric that declared the field. */
  category: string;
}

/** Union of all metrics' input fields, deduped by field id (first wins). */
function collectSharedFields(defs: OperationalMetricDef[]): SharedField[] {
  const byId = new Map<string, SharedField>();
  for (const def of defs) {
    for (const field of def.inputFields) {
      const existing = byId.get(field.id);
      if (existing) {
        if (!existing.usedBy.includes(def.label)) existing.usedBy.push(def.label);
        // A field is only truly optional if EVERY metric using it marks it so.
        if (!field.optional) existing.field = { ...existing.field, optional: false };
      } else {
        byId.set(field.id, {
          field: { ...field },
          usedBy: [def.label],
          category: def.category ?? 'General',
        });
      }
    }
  }
  return Array.from(byId.values());
}

/** Prefill: pool value wins, else the first legacy data-point value found. */
function buildInitialValues(
  shared: SharedField[],
  existingData: OperationalDataPoint[],
  existingPools: OperationalInputPool[] | undefined,
  period: Period
): Record<string, string> {
  const pool = existingPools?.find(
    (p) => p.period.year === period.year && p.period.month === period.month
  );
  const periodPoints = existingData.filter(
    (d) => d.period.year === period.year && d.period.month === period.month
  );
  const result: Record<string, string> = {};
  for (const sf of shared) {
    const poolVal = pool?.sharedInputs[sf.field.id];
    if (poolVal !== undefined) {
      result[sf.field.id] = String(poolVal);
      continue;
    }
    for (const dp of periodPoints) {
      const v = dp.inputs[sf.field.id];
      if (v !== undefined) {
        result[sf.field.id] = String(v);
        break;
      }
    }
  }
  return result;
}

export function DataEntryForm({
  metricDefs,
  existingData,
  existingPools,
  period,
  onSave,
  onCancel,
}: DataEntryFormProps) {
  const sharedFields = useMemo(() => collectSharedFields(metricDefs), [metricDefs]);

  const [values, setValues] = useState<Record<string, string>>(() =>
    buildInitialValues(sharedFields, existingData, existingPools, period)
  );

  const handleFieldChange = useCallback((fieldId: string, raw: string) => {
    setValues((prev) => ({ ...prev, [fieldId]: raw }));
  }, []);

  const handleSave = () => {
    const sharedInputs: Record<string, number> = {};
    for (const sf of sharedFields) {
      const raw = (values[sf.field.id] ?? '').trim();
      if (raw === '') continue;
      const num = parseFloat(raw);
      if (!isNaN(num)) sharedInputs[sf.field.id] = num;
    }

    // Legacy fan-out: emit a per-metric point when any of its fields exist.
    const points: OperationalDataPoint[] = [];
    for (const def of metricDefs) {
      const inputs: Record<string, number> = {};
      let anyFilled = false;
      for (const field of def.inputFields) {
        const v = sharedInputs[field.id];
        if (v !== undefined) {
          inputs[field.id] = v;
          anyFilled = true;
        }
      }
      if (anyFilled) points.push({ metricDefId: def.id, period, inputs });
    }

    onSave({ pool: { period, sharedInputs }, points });
  };

  // Group by section, preserving profile order.
  const sections = useMemo(() => {
    const map = new Map<string, SharedField[]>();
    for (const sf of sharedFields) {
      const existing = map.get(sf.category) ?? [];
      existing.push(sf);
      map.set(sf.category, existing);
    }
    return map;
  }, [sharedFields]);

  const derivedCount = metricDefs.length;
  const fieldCount = sharedFields.length;

  return (
    <div
      className="rounded-xl border p-6 flex flex-col gap-6"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
      data-testid="data-entry-form"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
            Enter Operational Data
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {periodLabel(period)} · enter each number once — {fieldCount} inputs drive {derivedCount}{' '}
            metrics automatically
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-sm font-medium px-3 py-1.5 rounded-lg border cursor-pointer"
          style={{
            borderColor: 'hsl(var(--border))',
            color: 'hsl(var(--muted-foreground))',
            background: 'transparent',
          }}
        >
          Cancel
        </button>
      </div>

      {/* Shared fields grouped by section */}
      {Array.from(sections.entries()).map(([category, fields]) => (
        <div key={category} className="flex flex-col gap-4">
          <h3
            className="text-xs font-semibold uppercase tracking-wide pb-1 border-b"
            style={{
              color: 'hsl(var(--muted-foreground))',
              borderColor: 'hsl(var(--border))',
            }}
          >
            {category}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            {fields.map(({ field, usedBy }) => (
              <div key={field.id} className="flex flex-col gap-1">
                <label
                  className="text-xs font-medium"
                  style={{ color: 'hsl(var(--foreground))' }}
                  htmlFor={`op-input-${field.id}`}
                >
                  {field.label}
                  {field.optional && (
                    <span className="ml-1 font-normal" style={{ color: 'hsl(var(--muted-foreground))' }}>
                      (optional)
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id={`op-input-${field.id}`}
                    type="number"
                    min={0}
                    step="any"
                    value={values[field.id] ?? ''}
                    onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    placeholder="0"
                    className="flex-1 rounded-lg border px-3 py-1.5 text-sm"
                    style={{
                      borderColor: 'hsl(var(--border))',
                      background: 'hsl(var(--background))',
                      color: 'hsl(var(--foreground))',
                    }}
                  />
                  <span
                    className="text-xs px-2 py-1.5 rounded-lg border whitespace-nowrap"
                    style={{
                      borderColor: 'hsl(var(--border))',
                      background: 'hsl(var(--muted))',
                      color: 'hsl(var(--muted-foreground))',
                    }}
                  >
                    {field.unit}
                  </span>
                </div>
                {field.description && (
                  <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {field.description}
                  </p>
                )}
                <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Used by: {usedBy.join(' · ')}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Zero-input note */}
      {metricDefs.some((d) => d.inputFields.length === 0) && (
        <p className="text-xs italic" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {metricDefs
            .filter((d) => d.inputFields.length === 0)
            .map((d) => d.label)
            .join(', ')}{' '}
          calculate straight from your imported financials — nothing to enter.
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2 border-t" style={{ borderColor: 'hsl(var(--border))' }}>
        <button
          onClick={handleSave}
          data-testid="data-entry-save"
          className="px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer"
          style={{
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
          }}
        >
          Save Data
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
          style={{
            color: 'hsl(var(--muted-foreground))',
            background: 'transparent',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
