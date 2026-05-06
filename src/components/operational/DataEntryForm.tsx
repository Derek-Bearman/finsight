'use client';

import { useState, useCallback } from 'react';
import type { OperationalMetricDef, OperationalDataPoint, Period } from '@/types';
import { periodLabel } from '@/lib/utils/period';

export interface DataEntryFormProps {
  metricDefs: OperationalMetricDef[];
  existingData: OperationalDataPoint[];
  period: Period;
  onSave: (points: OperationalDataPoint[]) => void;
  onCancel: () => void;
}

// Group metrics by category
function groupByCategory(defs: OperationalMetricDef[]): Map<string, OperationalMetricDef[]> {
  const map = new Map<string, OperationalMetricDef[]>();
  for (const def of defs) {
    const cat = def.category ?? 'General';
    const existing = map.get(cat) ?? [];
    existing.push(def);
    map.set(cat, existing);
  }
  return map;
}

// Build initial values from existing data for a period
function buildInitialValues(
  defs: OperationalMetricDef[],
  existingData: OperationalDataPoint[],
  period: Period
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const def of defs) {
    result[def.id] = {};
    const dataPoint = existingData.find(
      (d) =>
        d.metricDefId === def.id &&
        d.period.year === period.year &&
        d.period.month === period.month
    );
    if (dataPoint) {
      for (const field of def.inputFields) {
        const val = dataPoint.inputs[field.id];
        if (val !== undefined) {
          result[def.id]![field.id] = String(val);
        }
      }
    }
  }
  return result;
}

export function DataEntryForm({
  metricDefs,
  existingData,
  period,
  onSave,
  onCancel,
}: DataEntryFormProps) {
  const [values, setValues] = useState<Record<string, Record<string, string>>>(
    () => buildInitialValues(metricDefs, existingData, period)
  );
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});

  const handleFieldChange = useCallback(
    (metricId: string, fieldId: string, raw: string) => {
      setValues((prev) => ({
        ...prev,
        [metricId]: {
          ...prev[metricId],
          [fieldId]: raw,
        },
      }));
      // Clear error on change
      setErrors((prev) => {
        if (!prev[metricId]?.[fieldId]) return prev;
        const metricErrors = { ...(prev[metricId] ?? {}) };
        delete metricErrors[fieldId];
        return { ...prev, [metricId]: metricErrors };
      });
    },
    []
  );

  const validate = (): boolean => {
    const newErrors: Record<string, Record<string, string>> = {};
    let valid = true;

    for (const def of metricDefs) {
      const requiredFields = def.inputFields.filter((f) => !f.optional);
      for (const field of requiredFields) {
        const raw = values[def.id]?.[field.id] ?? '';
        if (raw.trim() === '') {
          // Only required if any field in this metric is being entered
          // Actually: check if user is entering data for this metric at all
          const anyFilled = def.inputFields.some((f) => (values[def.id]?.[f.id] ?? '').trim() !== '');
          if (anyFilled) {
            newErrors[def.id] = newErrors[def.id] ?? {};
            newErrors[def.id]![field.id] = `${field.label} is required`;
            valid = false;
          }
        }
      }
    }

    setErrors(newErrors);
    return valid;
  };

  const handleSave = () => {
    if (!validate()) return;

    const points: OperationalDataPoint[] = [];

    for (const def of metricDefs) {
      const metricValues = values[def.id] ?? {};
      const inputs: Record<string, number> = {};
      let anyFilled = false;

      for (const field of def.inputFields) {
        const raw = (metricValues[field.id] ?? '').trim();
        if (raw !== '') {
          const num = parseFloat(raw);
          if (!isNaN(num)) {
            inputs[field.id] = num;
            anyFilled = true;
          }
        }
      }

      // For metrics with no input fields, always emit a data point (to trigger calculation)
      if (def.inputFields.length === 0 || anyFilled) {
        points.push({
          metricDefId: def.id,
          period,
          inputs,
        });
      }
    }

    onSave(points);
  };

  const grouped = groupByCategory(metricDefs);
  const categories = Array.from(grouped.keys());

  return (
    <div
      className="rounded-xl border p-6 flex flex-col gap-6"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
            Enter Operational Data
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {periodLabel(period)}
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-sm font-medium px-3 py-1.5 rounded-lg border"
          style={{
            borderColor: 'hsl(var(--border))',
            color: 'hsl(var(--muted-foreground))',
            background: 'transparent',
          }}
        >
          Cancel
        </button>
      </div>

      {/* Fields grouped by category */}
      {categories.map((category) => {
        const defs = grouped.get(category) ?? [];
        return (
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

            {defs.map((def) => (
              <div key={def.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                    {def.label}
                  </p>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{
                      background: 'hsl(var(--muted))',
                      color: 'hsl(var(--muted-foreground))',
                    }}
                  >
                    {def.formula}
                  </span>
                </div>

                {def.inputFields.length === 0 ? (
                  <p
                    className="text-xs italic"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    Calculated from financial data — no input required
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {def.inputFields.map((field) => {
                      const fieldError = errors[def.id]?.[field.id];
                      return (
                        <div key={field.id} className="flex flex-col gap-1">
                          <label
                            className="text-xs font-medium"
                            style={{ color: 'hsl(var(--foreground))' }}
                          >
                            {field.label}
                            {field.optional && (
                              <span
                                className="ml-1 font-normal"
                                style={{ color: 'hsl(var(--muted-foreground))' }}
                              >
                                (optional)
                              </span>
                            )}
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={values[def.id]?.[field.id] ?? ''}
                              onChange={(e) => handleFieldChange(def.id, field.id, e.target.value)}
                              placeholder="0"
                              className="flex-1 rounded-lg border px-3 py-1.5 text-sm"
                              style={{
                                borderColor: fieldError
                                  ? 'hsl(0 84% 60%)'
                                  : 'hsl(var(--border))',
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
                          {fieldError && (
                            <p className="text-xs" style={{ color: 'hsl(0 84% 60%)' }}>
                              {fieldError}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2 border-t" style={{ borderColor: 'hsl(var(--border))' }}>
        <button
          onClick={handleSave}
          className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
          }}
        >
          Save Data
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm font-medium"
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
