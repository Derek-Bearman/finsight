'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ColumnMapping, ParsedRow } from '@/lib/parsers/csv-parser';

interface ColumnMappingPreviewProps {
  headers: string[];
  mapping: ColumnMapping;
  rows: ParsedRow[];
  onConfirm: (mapping: ColumnMapping) => void;
  onCancel: () => void;
}

type ColumnRole = 'account_name' | 'account_number' | 'period' | 'ignore';

const ROLE_LABELS: Record<ColumnRole, string> = {
  account_name: 'Account Name',
  account_number: 'Account Number',
  period: 'Period',
  ignore: 'Ignore',
};

function getRoleForHeader(header: string, mapping: ColumnMapping): ColumnRole {
  if (mapping.accountNameColumn === header) return 'account_name';
  if (mapping.accountNumberColumn === header) return 'account_number';
  if (mapping.periodColumns.some((pc) => pc.header === header)) return 'period';
  return 'ignore';
}

function getPeriodLabel(header: string, mapping: ColumnMapping): string | null {
  const pc = mapping.periodColumns.find((p) => p.header === header);
  if (!pc) return null;
  const { year, month } = pc.period;
  const date = new Date(year, month - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function ColumnMappingPreview({
  headers,
  mapping,
  rows,
  onConfirm,
  onCancel,
}: ColumnMappingPreviewProps) {
  const [roles, setRoles] = useState<Record<string, ColumnRole>>(() => {
    const init: Record<string, ColumnRole> = {};
    for (const h of headers) {
      init[h] = getRoleForHeader(h, mapping);
    }
    return init;
  });

  const periodCount = Object.values(roles).filter((r) => r === 'period').length;

  const buildUpdatedMapping = (): ColumnMapping => {
    const accountNameColumn =
      Object.entries(roles).find(([, r]) => r === 'account_name')?.[0] ?? mapping.accountNameColumn;
    const accountNumberColumn =
      Object.entries(roles).find(([, r]) => r === 'account_number')?.[0] ?? mapping.accountNumberColumn;

    // Keep period columns that are still marked as period; preserve period metadata
    const periodColumns = mapping.periodColumns.filter(
      (pc) => roles[pc.header] === 'period'
    );

    return {
      accountNameColumn,
      accountNumberColumn,
      periodColumns,
    };
  };

  const handleRoleChange = (header: string, role: ColumnRole) => {
    setRoles((prev) => {
      const next = { ...prev };
      // Enforce single account_name and account_number
      if (role === 'account_name') {
        for (const k of Object.keys(next)) {
          if (next[k] === 'account_name') next[k] = 'ignore';
        }
      }
      if (role === 'account_number') {
        for (const k of Object.keys(next)) {
          if (next[k] === 'account_number') next[k] = 'ignore';
        }
      }
      next[header] = role;
      return next;
    });
  };

  const previewRows = rows.slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Review Column Mapping</h3>
          <p className="text-sm mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Confirm how each column maps to data fields.{' '}
            <span className="font-medium" style={{ color: 'hsl(var(--foreground))' }}>
              {periodCount} period {periodCount === 1 ? 'column' : 'columns'} detected
            </span>
          </p>
        </div>
      </div>

      {/* Column role editor */}
      <div
        className="overflow-x-auto rounded-lg border"
        style={{ borderColor: 'hsl(var(--border))' }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--muted))' }}>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Column Header
              </th>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Role
              </th>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Period
              </th>
            </tr>
          </thead>
          <tbody>
            {headers.map((header, idx) => {
              const role = roles[header];
              const periodLabel = getPeriodLabel(header, mapping);
              return (
                <tr
                  key={header}
                  style={{
                    borderBottom: idx < headers.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                  }}
                >
                  <td className="px-4 py-2 font-mono text-xs" style={{ color: 'hsl(var(--foreground))' }}>
                    {header}
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={role}
                      onChange={(e) => handleRoleChange(header, e.target.value as ColumnRole)}
                      data-testid={`role-select-${idx}`}
                      className="rounded-md border px-2 py-1 text-sm outline-none focus:ring-2"
                      style={{
                        borderColor: 'hsl(var(--border))',
                        background: 'hsl(var(--background))',
                        color: 'hsl(var(--foreground))',
                      }}
                    >
                      {(Object.entries(ROLE_LABELS) as [ColumnRole, string][]).map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    {role === 'period' && periodLabel && (
                      <Badge variant="secondary" className="text-xs">
                        {periodLabel}
                      </Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Preview table */}
      {previewRows.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-2 uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Data Preview (first {previewRows.length} rows)
          </p>
          <div
            className="overflow-x-auto rounded-lg border"
            style={{ borderColor: 'hsl(var(--border))' }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--muted))' }}>
                  {headers.map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-medium truncate max-w-28"
                      style={{ color: 'hsl(var(--muted-foreground))' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, rowIdx) => (
                  <tr
                    key={rowIdx}
                    style={{
                      borderBottom: rowIdx < previewRows.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                    }}
                  >
                    {headers.map((h) => (
                      <td
                        key={h}
                        className="px-3 py-1.5 truncate max-w-28"
                        style={{ color: 'hsl(var(--foreground))' }}
                      >
                        {String(row[h] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" onClick={onCancel} data-testid="mapping-cancel">
          Cancel
        </Button>
        <Button onClick={() => onConfirm(buildUpdatedMapping())} data-testid="mapping-confirm">
          Confirm Mapping
        </Button>
      </div>
    </div>
  );
}
