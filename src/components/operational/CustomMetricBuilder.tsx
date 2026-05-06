'use client';

import { useState } from 'react';
import type { CustomMetricDef, MetricFormat, OperationalMetricInputField } from '@/types';

export interface CustomMetricBuilderProps {
  profileId: string;
  onAdd: (metric: CustomMetricDef) => void;
  onClose: () => void;
}

interface FieldRow {
  id: string;
  label: string;
  unit: string;
  optional: boolean;
}

const FORMAT_OPTIONS: { value: MetricFormat; label: string }[] = [
  { value: 'currency', label: 'Currency ($)' },
  { value: 'percent', label: 'Percent (%)' },
  { value: 'ratio', label: 'Ratio (x)' },
  { value: 'number', label: 'Number' },
  { value: 'days', label: 'Days' },
];

function makeRowId() {
  return `field-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function CustomMetricBuilder({ profileId, onAdd, onClose }: CustomMetricBuilderProps) {
  const [label, setLabel] = useState('');
  const [formulaDesc, setFormulaDesc] = useState('');
  const [format, setFormat] = useState<MetricFormat>('number');
  const [fields, setFields] = useState<FieldRow[]>([
    { id: makeRowId(), label: '', unit: '', optional: false },
  ]);
  const [labelError, setLabelError] = useState('');

  const addField = () => {
    setFields((prev) => [...prev, { id: makeRowId(), label: '', unit: '', optional: false }]);
  };

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  };

  const updateField = (id: string, patch: Partial<FieldRow>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const handleSubmit = () => {
    if (!label.trim()) {
      setLabelError('Metric label is required');
      return;
    }
    setLabelError('');

    const inputFields: OperationalMetricInputField[] = fields
      .filter((f) => f.label.trim() !== '')
      .map((f) => ({
        id: f.id,
        label: f.label.trim(),
        unit: f.unit.trim() || 'units',
        optional: f.optional,
      }));

    const metric: CustomMetricDef = {
      id: `custom-${Date.now()}`,
      label: label.trim(),
      formula: formulaDesc.trim() || 'Manual tracking',
      format,
      inputFields,
      profileId,
    };

    onAdd(metric);
  };

  return (
    <div
      className="rounded-xl border p-6 flex flex-col gap-5"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
            Add Custom Metric
          </h2>
          <p
            className="text-xs mt-0.5 italic"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            Custom metrics track inputs manually. Calculation happens outside the tool.
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-sm px-2 py-1 rounded"
          style={{ color: 'hsl(var(--muted-foreground))' }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Metric label */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'hsl(var(--foreground))' }}>
          Metric Label <span style={{ color: 'hsl(0 84% 60%)' }}>*</span>
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => { setLabel(e.target.value); setLabelError(''); }}
          placeholder="e.g., Revenue Per Employee"
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{
            borderColor: labelError ? 'hsl(0 84% 60%)' : 'hsl(var(--border))',
            background: 'hsl(var(--background))',
            color: 'hsl(var(--foreground))',
          }}
        />
        {labelError && (
          <p className="text-xs" style={{ color: 'hsl(0 84% 60%)' }}>
            {labelError}
          </p>
        )}
      </div>

      {/* Formula description */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'hsl(var(--foreground))' }}>
          Formula Description{' '}
          <span className="font-normal" style={{ color: 'hsl(var(--muted-foreground))' }}>
            (human-readable)
          </span>
        </label>
        <input
          type="text"
          value={formulaDesc}
          onChange={(e) => setFormulaDesc(e.target.value)}
          placeholder="e.g., Revenue ÷ Headcount"
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{
            borderColor: 'hsl(var(--border))',
            background: 'hsl(var(--background))',
            color: 'hsl(var(--foreground))',
          }}
        />
      </div>

      {/* Format */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'hsl(var(--foreground))' }}>
          Display Format
        </label>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as MetricFormat)}
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{
            borderColor: 'hsl(var(--border))',
            background: 'hsl(var(--card))',
            color: 'hsl(var(--foreground))',
          }}
        >
          {FORMAT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Input fields */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium" style={{ color: 'hsl(var(--foreground))' }}>
            Input Fields
          </label>
          <button
            onClick={addField}
            className="text-xs font-medium px-2 py-1 rounded-lg"
            style={{
              background: 'hsl(var(--muted))',
              color: 'hsl(var(--muted-foreground))',
            }}
          >
            + Add Field
          </button>
        </div>

        {fields.map((field, idx) => (
          <div
            key={field.id}
            className="flex flex-col gap-2 p-3 rounded-lg border"
            style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--background))' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Field {idx + 1}
              </span>
              {fields.length > 1 && (
                <button
                  onClick={() => removeField(field.id)}
                  className="text-xs"
                  style={{ color: 'hsl(0 84% 60%)' }}
                >
                  Remove
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Label
                </label>
                <input
                  type="text"
                  value={field.label}
                  onChange={(e) => updateField(field.id, { label: e.target.value })}
                  placeholder="e.g., Headcount"
                  className="rounded border px-2 py-1 text-xs"
                  style={{
                    borderColor: 'hsl(var(--border))',
                    background: 'hsl(var(--card))',
                    color: 'hsl(var(--foreground))',
                  }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Unit
                </label>
                <input
                  type="text"
                  value={field.unit}
                  onChange={(e) => updateField(field.id, { unit: e.target.value })}
                  placeholder="e.g., employees"
                  className="rounded border px-2 py-1 text-xs"
                  style={{
                    borderColor: 'hsl(var(--border))',
                    background: 'hsl(var(--card))',
                    color: 'hsl(var(--foreground))',
                  }}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={field.optional}
                onChange={(e) => updateField(field.id, { optional: e.target.checked })}
                className="rounded"
                style={{ accentColor: 'hsl(var(--primary))' }}
              />
              <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Optional
              </span>
            </label>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2 border-t" style={{ borderColor: 'hsl(var(--border))' }}>
        <button
          onClick={handleSubmit}
          className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
          }}
        >
          Add Metric
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ color: 'hsl(var(--muted-foreground))', background: 'transparent' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
