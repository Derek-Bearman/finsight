'use client';

import React, {
  use,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import Link from 'next/link';
import { useWorkspaceStore } from '@/store/workspace-store';
import type { Scenario, ScenarioAdjustment, Period, Account, ClientWorkspace } from '@/types';
import {
  applyScenario,
  computeScenarioImpact,
  buildScenarioSeries,
  buildDefaultScenarios,
  SCENARIO_COLORS,
} from '@/lib/scenarios';
import { formatCurrency, formatPercent } from '@/lib/utils/format';
import { getUniquePeriods } from '@/lib/calculations/period-aggregation';
import { ScenarioComparisonChart } from '@/components/charts';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function periodToKey(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

function getAvailableYears(workspace: ClientWorkspace): number[] {
  const years = new Set(workspace.values.map(v => v.period.year));
  return Array.from(years).sort((a, b) => a - b);
}

function getFirstPeriod(workspace: ClientWorkspace): Period {
  const periods = getUniquePeriods(workspace.values);
  if (periods.length > 0) return periods[0]!;
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function getMonthName(month: number): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[month - 1] ?? 'Jan';
}

// ─────────────────────────────────────────────
// Delta display
// ─────────────────────────────────────────────

function DeltaBadge({ value, isPercent = false }: { value: number; isPercent?: boolean }) {
  if (value === 0) {
    return <span style={{ color: 'hsl(var(--muted-foreground))' }}>—</span>;
  }
  const positive = value > 0;
  const color = positive ? 'hsl(142 71% 45%)' : 'hsl(0 84% 60%)';
  const sign = positive ? '+' : '';
  const text = isPercent
    ? `${sign}${formatPercent(value)}`
    : `${sign}${formatCurrency(value)}`;
  return <span style={{ color }}>{text}</span>;
}

// ─────────────────────────────────────────────
// Traffic light health indicator
// ─────────────────────────────────────────────

function HealthLight({ isAboveBreakeven, marginOfSafetyPct }: {
  isAboveBreakeven: boolean;
  marginOfSafetyPct: number;
}) {
  if (!isAboveBreakeven) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
        style={{ background: 'hsl(0 84% 60% / 0.12)', color: 'hsl(0 84% 50%)' }}
      >
        <span>&#9679;</span> Below Breakeven
      </div>
    );
  }
  if (marginOfSafetyPct < 0.1) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
        style={{ background: 'hsl(38 92% 50% / 0.12)', color: 'hsl(38 80% 40%)' }}
      >
        <span>&#9679;</span> Near Breakeven
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
      style={{ background: 'hsl(142 71% 45% / 0.12)', color: 'hsl(142 60% 35%)' }}
    >
      <span>&#9679;</span> Profitable
    </div>
  );
}

// ─────────────────────────────────────────────
// Scenario Card
// ─────────────────────────────────────────────

interface ScenarioCardProps {
  scenario: Scenario;
  isActive: boolean;
  colorIndex: number;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRename: (name: string) => void;
}

function ScenarioCard({
  scenario,
  isActive,
  colorIndex,
  onSelect,
  onDelete,
  onDuplicate,
  onRename,
}: ScenarioCardProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(scenario.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const color = SCENARIO_COLORS[colorIndex % SCENARIO_COLORS.length] ?? SCENARIO_COLORS[0]!;

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(scenario.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleBlur = () => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== scenario.name) {
      onRename(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') inputRef.current?.blur();
    if (e.key === 'Escape') {
      setEditValue(scenario.name);
      setEditing(false);
    }
  };

  return (
    <div
      onClick={onSelect}
      className="relative group rounded-xl border p-3 cursor-pointer transition-all"
      style={{
        borderColor: isActive ? color : 'hsl(var(--border))',
        background: isActive ? `${color.replace(')', ' / 0.06)').replace('hsl(', 'hsl(')}` : 'hsl(var(--card))',
        boxShadow: isActive ? `0 0 0 1px ${color}` : 'none',
      }}
    >
      {/* Color dot + name */}
      <div className="flex items-center gap-2 mb-1">
        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onClick={e => e.stopPropagation()}
            className="flex-1 min-w-0 text-sm font-semibold rounded px-1 outline-none border"
            style={{
              color: 'hsl(var(--foreground))',
              borderColor: 'hsl(var(--ring))',
              background: 'hsl(var(--background))',
            }}
          />
        ) : (
          <span
            className="flex-1 min-w-0 text-sm font-semibold truncate"
            style={{ color: 'hsl(var(--foreground))' }}
            onDoubleClick={handleStartEdit}
            title="Double-click to rename"
          >
            {scenario.name}
          </span>
        )}
        {scenario.isBaseline && (
          <span
            className="rounded px-1 py-0.5 text-xs flex-shrink-0"
            style={{ background: 'hsl(var(--accent))', color: 'hsl(var(--accent-foreground))' }}
          >
            Base
          </span>
        )}
      </div>

      {/* Description */}
      {scenario.description && (
        <p className="text-xs truncate" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {scenario.description}
        </p>
      )}

      {/* Adjustment count */}
      <div className="flex items-center justify-between mt-2">
        <span
          className="rounded-full px-1.5 py-0.5 text-xs font-medium"
          style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
        >
          {scenario.adjustments.length} adj.
        </span>

        {/* Action buttons (show on hover) */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={e => { e.stopPropagation(); onDuplicate(); }}
            className="rounded p-1 text-xs hover:opacity-80 transition-opacity"
            style={{ color: 'hsl(var(--muted-foreground))' }}
            title="Duplicate"
          >
            &#9107;
          </button>
          <button
            onClick={e => { e.stopPropagation(); handleStartEdit(e); }}
            className="rounded p-1 text-xs hover:opacity-80 transition-opacity"
            style={{ color: 'hsl(var(--muted-foreground))' }}
            title="Rename"
          >
            &#9998;
          </button>
          {!scenario.isBaseline && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="rounded p-1 text-xs hover:opacity-80 transition-opacity"
              style={{ color: 'hsl(0 84% 60%)' }}
              title="Delete"
            >
              &#10005;
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Slider component
// ─────────────────────────────────────────────

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
  formatValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  const display = formatValue ? formatValue(value) : `${value >= 0 ? '+' : ''}${value}%`;
  const color = value > 0 ? 'hsl(142 71% 45%)' : value < 0 ? 'hsl(0 84% 60%)' : 'hsl(var(--muted-foreground))';

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm w-36 flex-shrink-0" style={{ color: 'hsl(var(--foreground))' }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1"
        style={{ accentColor: 'hsl(var(--primary))', opacity: disabled ? 0.4 : 1 }}
      />
      <span className="text-sm font-semibold w-14 text-right tabular-nums" style={{ color }}>
        {display}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Impact Panel
// ─────────────────────────────────────────────

interface ImpactPanelProps {
  workspace: ClientWorkspace;
  activeScenario: Scenario | null;
  baseScenario: Scenario | null;
}

function ImpactPanel({ workspace, activeScenario, baseScenario }: ImpactPanelProps) {
  const impact = useMemo(() => {
    if (!activeScenario || !baseScenario || activeScenario.isBaseline) return null;
    if (workspace.accounts.length === 0 || workspace.values.length === 0) return null;
    return computeScenarioImpact(workspace.accounts, workspace.values, activeScenario);
  }, [workspace.accounts, workspace.values, activeScenario, baseScenario]);

  const baselinePnL = useMemo(() => {
    if (workspace.accounts.length === 0 || workspace.values.length === 0) return null;
    if (!baseScenario) return null;
    return computeScenarioImpact(workspace.accounts, workspace.values, baseScenario);
  }, [workspace.accounts, workspace.values, baseScenario]);

  if (!impact && activeScenario?.isBaseline) {
    return (
      <div
        className="rounded-xl border p-4 flex items-center justify-center"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))', minHeight: 160 }}
      >
        <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
          Base Case — this is the baseline (no adjustments).
        </p>
      </div>
    );
  }

  if (!impact) {
    return (
      <div
        className="rounded-xl border p-4 flex items-center justify-center"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))', minHeight: 160 }}
      >
        <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
          No data available. Import financial data to see impact.
        </p>
      </div>
    );
  }

  const marginOfSafetyPct = impact.scenarioRevenue > 0
    ? (impact.scenarioRevenue - impact.scenarioBreakeven) / impact.scenarioRevenue
    : 0;

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-4"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
          Impact vs Base Case
        </h4>
        <HealthLight isAboveBreakeven={impact.isAboveBreakeven} marginOfSafetyPct={marginOfSafetyPct} />
      </div>

      {/* Warning banner */}
      {!impact.isAboveBreakeven && (
        <div
          className="rounded-lg border px-3 py-2 text-xs font-medium"
          style={{
            borderColor: 'hsl(0 84% 60% / 0.3)',
            background: 'hsl(0 84% 60% / 0.08)',
            color: 'hsl(0 84% 50%)',
          }}
        >
          ⚠ Below Breakeven — this scenario puts the business below breakeven threshold
        </div>
      )}

      {/* Metrics table */}
      <div className="flex flex-col gap-2">
        {/* Revenue row */}
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>Revenue</span>
          <div className="flex items-center gap-2 text-right">
            <span style={{ color: 'hsl(var(--muted-foreground))' }}>{formatCurrency(impact.baseRevenue)}</span>
            <span style={{ color: 'hsl(var(--muted-foreground))' }}>→</span>
            <span className="font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
              {formatCurrency(impact.scenarioRevenue)}
            </span>
            <DeltaBadge value={impact.revenueDelta} />
          </div>
        </div>

        {/* Net Income row */}
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>Net Income</span>
          <div className="flex items-center gap-2 text-right">
            <span style={{ color: 'hsl(var(--muted-foreground))' }}>{formatCurrency(impact.baseNetIncome)}</span>
            <span style={{ color: 'hsl(var(--muted-foreground))' }}>→</span>
            <span className="font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
              {formatCurrency(impact.scenarioNetIncome)}
            </span>
            <DeltaBadge value={impact.netIncomeDelta} />
          </div>
        </div>

        {/* Gross Margin row */}
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>Gross Margin</span>
          <div className="flex items-center gap-2 text-right">
            <span style={{ color: 'hsl(var(--muted-foreground))' }}>{formatPercent(impact.baseGrossMarginPct)}</span>
            <span style={{ color: 'hsl(var(--muted-foreground))' }}>→</span>
            <span className="font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
              {formatPercent(impact.scenarioGrossMarginPct)}
            </span>
            <DeltaBadge
              value={impact.scenarioGrossMarginPct - impact.baseGrossMarginPct}
              isPercent
            />
          </div>
        </div>

        {/* Breakeven row */}
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>Breakeven Rev.</span>
          <div className="flex items-center gap-2 text-right">
            <span style={{ color: 'hsl(var(--muted-foreground))' }}>{formatCurrency(impact.baseBreakeven)}</span>
            <span style={{ color: 'hsl(var(--muted-foreground))' }}>→</span>
            <span className="font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
              {formatCurrency(impact.scenarioBreakeven)}
            </span>
          </div>
        </div>

        {/* Margin of safety */}
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>Margin of Safety</span>
          <span
            className="font-semibold"
            style={{ color: marginOfSafetyPct >= 0.1 ? 'hsl(142 71% 45%)' : marginOfSafetyPct >= 0 ? 'hsl(38 80% 40%)' : 'hsl(0 84% 60%)' }}
          >
            {formatPercent(marginOfSafetyPct)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Adjustment Row
// ─────────────────────────────────────────────

function AdjustmentRow({
  adj,
  accounts,
  onRemove,
}: {
  adj: ScenarioAdjustment;
  accounts: Account[];
  onRemove: () => void;
}) {
  const accountName = useMemo(() => {
    if (adj.accountId === '_all_revenue_') return 'All Revenue';
    if (adj.accountId === '_all_expense_') return 'All Expenses';
    if (adj.accountId === '_all_costs_') return 'All Costs (COGS + Expense)';
    const acc = accounts.find(a => a.id === adj.accountId);
    return acc?.name ?? adj.accountId;
  }, [adj.accountId, accounts]);

  const valueDisplay = useMemo(() => {
    if (adj.type === 'percent') {
      const sign = adj.value >= 0 ? '+' : '';
      return `${sign}${adj.value}%`;
    }
    if (adj.type === 'absolute') {
      const sign = adj.value >= 0 ? '+' : '';
      return `${sign}${formatCurrency(adj.value)}`;
    }
    return `= ${formatCurrency(adj.value)}`;
  }, [adj.type, adj.value]);

  const valueColor = adj.value >= 0 ? 'hsl(142 71% 45%)' : 'hsl(0 84% 60%)';

  return (
    <tr>
      <td className="py-1.5 pr-3 text-sm" style={{ color: 'hsl(var(--foreground))' }}>
        {accountName}
      </td>
      <td className="py-1.5 pr-3 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
        {adj.type === 'percent' ? 'Percent' : adj.type === 'absolute' ? 'Absolute' : 'Replace'}
      </td>
      <td className="py-1.5 pr-3 text-sm font-semibold tabular-nums" style={{ color: valueColor }}>
        {valueDisplay}
      </td>
      <td className="py-1.5 pr-3 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
        From {getMonthName(adj.appliesFrom.month)} {adj.appliesFrom.year}
      </td>
      <td className="py-1.5">
        <button
          onClick={onRemove}
          className="rounded px-1.5 py-0.5 text-xs hover:opacity-80 transition-opacity"
          style={{ color: 'hsl(0 84% 60%)' }}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────
// Add Adjustment Form
// ─────────────────────────────────────────────

interface AddAdjustmentFormProps {
  accounts: Account[];
  availableYears: number[];
  onAdd: (adj: ScenarioAdjustment) => void;
  onCancel: () => void;
}

function AddAdjustmentForm({ accounts, availableYears, onAdd, onCancel }: AddAdjustmentFormProps) {
  const [accountId, setAccountId] = useState('_all_revenue_');
  const [adjType, setAdjType] = useState<'percent' | 'absolute' | 'replace'>('percent');
  const [value, setValue] = useState(0);
  const [fromYear, setFromYear] = useState(availableYears[0] ?? new Date().getFullYear());
  const [fromMonth, setFromMonth] = useState(1);

  const SENTINEL_OPTIONS = [
    { id: '_all_revenue_', label: 'All Revenue Accounts' },
    { id: '_all_costs_', label: 'All Cost Accounts (COGS + Expense)' },
    { id: '_all_expense_', label: 'All Expense Accounts' },
  ];

  const handleAdd = () => {
    onAdd({
      accountId,
      type: adjType,
      value,
      appliesFrom: { year: fromYear, month: fromMonth },
    });
  };

  const years = availableYears.length > 0 ? availableYears : [new Date().getFullYear()];

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted) / 0.3)' }}
    >
      <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
        Add Adjustment
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Account selector */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Account
          </label>
          <select
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            className="rounded-md border px-2 py-1.5 text-sm"
            style={{
              borderColor: 'hsl(var(--border))',
              background: 'hsl(var(--card))',
              color: 'hsl(var(--foreground))',
            }}
          >
            <optgroup label="Sentinels">
              {SENTINEL_OPTIONS.map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </optgroup>
            {accounts.length > 0 && (
              <optgroup label="Specific Accounts">
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        {/* Adjustment type */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Type
          </label>
          <select
            value={adjType}
            onChange={e => setAdjType(e.target.value as 'percent' | 'absolute' | 'replace')}
            className="rounded-md border px-2 py-1.5 text-sm"
            style={{
              borderColor: 'hsl(var(--border))',
              background: 'hsl(var(--card))',
              color: 'hsl(var(--foreground))',
            }}
          >
            <option value="percent">Percent %</option>
            <option value="absolute">Absolute $</option>
            <option value="replace">Replace $</option>
          </select>
        </div>

        {/* Value */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Value {adjType === 'percent' ? '(%)' : '($)'}
          </label>
          <input
            type="number"
            value={value}
            onChange={e => setValue(Number(e.target.value))}
            className="rounded-md border px-2 py-1.5 text-sm"
            style={{
              borderColor: 'hsl(var(--border))',
              background: 'hsl(var(--card))',
              color: 'hsl(var(--foreground))',
            }}
          />
        </div>

        {/* Applies From */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Applies From
          </label>
          <div className="flex gap-2">
            <select
              value={fromMonth}
              onChange={e => setFromMonth(Number(e.target.value))}
              className="flex-1 rounded-md border px-2 py-1.5 text-sm"
              style={{
                borderColor: 'hsl(var(--border))',
                background: 'hsl(var(--card))',
                color: 'hsl(var(--foreground))',
              }}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>{getMonthName(m)}</option>
              ))}
            </select>
            <select
              value={fromYear}
              onChange={e => setFromYear(Number(e.target.value))}
              className="flex-1 rounded-md border px-2 py-1.5 text-sm"
              style={{
                borderColor: 'hsl(var(--border))',
                background: 'hsl(var(--card))',
                color: 'hsl(var(--foreground))',
              }}
            >
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={onCancel}
          className="rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
          style={{
            borderColor: 'hsl(var(--border))',
            color: 'hsl(var(--muted-foreground))',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleAdd}
          className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
          style={{
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Scenario Editor (inner component)
// ─────────────────────────────────────────────

interface ScenarioEditorProps {
  clientId: string;
  workspace: ClientWorkspace;
  scenario: Scenario;
  baseScenario: Scenario | null;
}

function ScenarioEditor({ clientId, workspace, scenario, baseScenario }: ScenarioEditorProps) {
  const updateScenario = useWorkspaceStore(s => s.updateScenario);

  // Quick slider local state
  const [revenueSlider, setRevenueSlider] = useState(0);
  const [costSlider, setCostSlider] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);

  // Debounce ref for Zustand writes
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync slider state from scenario on load
  useEffect(() => {
    const revenueAdj = scenario.adjustments.find(a => a.accountId === '_all_revenue_' && a.type === 'percent');
    const costAdj = scenario.adjustments.find(a => a.accountId === '_all_costs_' && a.type === 'percent');
    setRevenueSlider(revenueAdj?.value ?? 0);
    setCostSlider(costAdj?.value ?? 0);
  }, [scenario.id]); // only re-sync when scenario changes

  const firstPeriod = useMemo(() => getFirstPeriod(workspace), [workspace.values]); // eslint-disable-line react-hooks/exhaustive-deps
  const availableYears = useMemo(() => getAvailableYears(workspace), [workspace.values]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute the "live" scenario — merge slider values into the scenario's adjustments
  const liveScenario = useMemo((): Scenario => {
    if (scenario.isBaseline) return scenario;

    // Start with non-slider adjustments
    const baseAdjs = scenario.adjustments.filter(
      a => !(a.accountId === '_all_revenue_' && a.type === 'percent') &&
           !(a.accountId === '_all_costs_' && a.type === 'percent')
    );

    const sliderAdjs: ScenarioAdjustment[] = [];
    if (revenueSlider !== 0) {
      sliderAdjs.push({ accountId: '_all_revenue_', type: 'percent', value: revenueSlider, appliesFrom: firstPeriod });
    }
    if (costSlider !== 0) {
      sliderAdjs.push({ accountId: '_all_costs_', type: 'percent', value: costSlider, appliesFrom: firstPeriod });
    }

    return { ...scenario, adjustments: [...sliderAdjs, ...baseAdjs] };
  }, [scenario, revenueSlider, costSlider, firstPeriod]);

  // Compute live impact for the impact panel (uses liveScenario, not persisted)
  const liveImpact = useMemo(() => {
    if (liveScenario.isBaseline || workspace.accounts.length === 0 || workspace.values.length === 0) return null;
    return computeScenarioImpact(workspace.accounts, workspace.values, liveScenario);
  }, [workspace.accounts, workspace.values, liveScenario]);

  // Debounced persist of slider values to Zustand
  const persistSliders = useCallback((revVal: number, costVal: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const baseAdjs = scenario.adjustments.filter(
        a => !(a.accountId === '_all_revenue_' && a.type === 'percent') &&
             !(a.accountId === '_all_costs_' && a.type === 'percent')
      );
      const sliderAdjs: ScenarioAdjustment[] = [];
      if (revVal !== 0) {
        sliderAdjs.push({ accountId: '_all_revenue_', type: 'percent', value: revVal, appliesFrom: firstPeriod });
      }
      if (costVal !== 0) {
        sliderAdjs.push({ accountId: '_all_costs_', type: 'percent', value: costVal, appliesFrom: firstPeriod });
      }
      updateScenario(clientId, { ...scenario, adjustments: [...sliderAdjs, ...baseAdjs] });
    }, 150);
  }, [scenario, clientId, firstPeriod, updateScenario]);

  const handleRevenueSlider = useCallback((v: number) => {
    setRevenueSlider(v);
    persistSliders(v, costSlider);
  }, [costSlider, persistSliders]);

  const handleCostSlider = useCallback((v: number) => {
    setCostSlider(v);
    persistSliders(revenueSlider, v);
  }, [revenueSlider, persistSliders]);

  // Gross margin from live impact
  const liveGrossMarginPct = liveImpact?.scenarioGrossMarginPct ?? null;
  const liveBreakeven = liveImpact?.scenarioBreakeven ?? null;

  // Non-slider adjustments (for the adjustment list)
  const detailedAdjs = useMemo(() => {
    return scenario.adjustments.filter(
      a => !(a.accountId === '_all_revenue_' && a.type === 'percent') &&
           !(a.accountId === '_all_costs_' && a.type === 'percent')
    );
  }, [scenario.adjustments]);

  const handleAddAdjustment = useCallback((adj: ScenarioAdjustment) => {
    const updated = { ...scenario, adjustments: [...scenario.adjustments, adj] };
    updateScenario(clientId, updated);
    setShowAddForm(false);
  }, [scenario, clientId, updateScenario]);

  const handleRemoveAdjustment = useCallback((index: number) => {
    // index is within detailedAdjs — we need to remove from the full adjustments array
    const adjToRemove = detailedAdjs[index];
    if (!adjToRemove) return;
    const updated = {
      ...scenario,
      adjustments: scenario.adjustments.filter(a => a !== adjToRemove),
    };
    updateScenario(clientId, updated);
  }, [scenario, clientId, updateScenario, detailedAdjs]);

  const isBaseline = scenario.isBaseline ?? false;

  return (
    <div className="flex flex-col gap-6">
      {/* Scenario name + description header */}
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold" style={{ color: 'hsl(var(--foreground))' }}>
            {scenario.name}
          </h3>
          {isBaseline && (
            <span
              className="rounded px-1.5 py-0.5 text-xs"
              style={{ background: 'hsl(var(--accent))', color: 'hsl(var(--accent-foreground))' }}
            >
              Baseline
            </span>
          )}
        </div>
        {scenario.description && (
          <p className="text-sm mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {scenario.description}
          </p>
        )}
      </div>

      {/* Two-column layout: editor left, impact right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: sliders + detailed adjustments */}
        <div className="flex flex-col gap-4">

          {/* Part A: Quick Sliders */}
          <div
            className="rounded-xl border p-4 flex flex-col gap-4"
            style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
          >
            <h4 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
              Quick Adjustments
            </h4>
            <SliderRow
              label="Revenue"
              value={revenueSlider}
              min={-50}
              max={50}
              step={5}
              disabled={isBaseline}
              onChange={handleRevenueSlider}
            />
            <SliderRow
              label="Costs"
              value={costSlider}
              min={-30}
              max={30}
              step={5}
              disabled={isBaseline}
              onChange={handleCostSlider}
            />

            {/* Margin target */}
            <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: 'hsl(var(--border))' }}>
              <span className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Projected Gross Margin
              </span>
              <div className="text-right">
                <span className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                  {liveGrossMarginPct !== null ? formatPercent(liveGrossMarginPct) : '—'}
                </span>
                {liveBreakeven !== null && liveBreakeven > 0 && (
                  <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    Breakeven at {formatCurrency(liveBreakeven)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Part B: Detailed Adjustments */}
          <div
            className="rounded-xl border p-4 flex flex-col gap-3"
            style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                Detailed Adjustments
              </h4>
              {!isBaseline && !showAddForm && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="rounded-lg border px-2 py-1 text-xs font-medium transition-colors"
                  style={{
                    borderColor: 'hsl(var(--primary))',
                    color: 'hsl(var(--primary))',
                  }}
                >
                  + Add Adjustment
                </button>
              )}
            </div>

            {detailedAdjs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      {['Account', 'Type', 'Value', 'From', ''].map(h => (
                        <th
                          key={h}
                          className="pb-1.5 pr-3 text-xs font-medium"
                          style={{ color: 'hsl(var(--muted-foreground))' }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detailedAdjs.map((adj, i) => (
                      <AdjustmentRow
                        key={`${adj.accountId}-${i}`}
                        adj={adj}
                        accounts={workspace.accounts}
                        onRemove={() => handleRemoveAdjustment(i)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              !showAddForm && (
                <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  {isBaseline
                    ? 'Baseline scenario has no adjustments.'
                    : 'No detailed adjustments. Use sliders above or add specific account adjustments.'}
                </p>
              )
            )}

            {showAddForm && (
              <AddAdjustmentForm
                accounts={workspace.accounts}
                availableYears={availableYears}
                onAdd={handleAddAdjustment}
                onCancel={() => setShowAddForm(false)}
              />
            )}
          </div>
        </div>

        {/* Right: Impact Panel */}
        <ImpactPanel
          workspace={workspace}
          activeScenario={liveScenario}
          baseScenario={baseScenario}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Comparison Section
// ─────────────────────────────────────────────

interface ComparisonSectionProps {
  clientId: string;
  workspace: ClientWorkspace;
}

function ComparisonSection({ clientId: _clientId, workspace }: ComparisonSectionProps) {
  const [granularity, setGranularity] = useState<'monthly' | 'quarterly' | 'annual'>('monthly');

  const { allImpacts, scenarioSeries } = useMemo(() => {
    if (workspace.accounts.length === 0 || workspace.values.length === 0 || workspace.scenarios.length === 0) {
      return { allImpacts: [], scenarioSeries: [] };
    }

    const impacts = workspace.scenarios.map(sc =>
      computeScenarioImpact(workspace.accounts, workspace.values, sc)
    );

    const series = buildScenarioSeries(workspace.accounts, workspace.values, workspace.scenarios, granularity);

    return { allImpacts: impacts, scenarioSeries: series };
  }, [workspace.accounts, workspace.values, workspace.scenarios, granularity]);

  const baseImpact = allImpacts.find((_, i) => workspace.scenarios[i]?.isBaseline);

  if (workspace.accounts.length === 0 || workspace.values.length === 0) {
    return (
      <div
        className="rounded-xl border p-8 text-center"
        style={{ borderColor: 'hsl(var(--border))' }}
      >
        <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
          Import financial data to see scenario comparisons.
        </p>
      </div>
    );
  }

  const GRANULARITIES: { id: 'monthly' | 'quarterly' | 'annual'; label: string }[] = [
    { id: 'monthly', label: 'Monthly' },
    { id: 'quarterly', label: 'Quarterly' },
    { id: 'annual', label: 'Annual' },
  ];

  // Comparison table helpers
  function metricColor(scenarioVal: number, baseVal: number, higherIsBetter = true): string {
    if (Math.abs(scenarioVal - baseVal) < 0.0001) return 'hsl(var(--foreground))';
    const better = higherIsBetter ? scenarioVal > baseVal : scenarioVal < baseVal;
    return better ? 'hsl(142 71% 45%)' : 'hsl(0 84% 60%)';
  }

  const METRICS = [
    { id: 'revenue', label: 'Revenue', format: (v: number) => formatCurrency(v), higherIsBetter: true },
    { id: 'netIncome', label: 'Net Income', format: (v: number) => formatCurrency(v), higherIsBetter: true },
    { id: 'grossMarginPct', label: 'Gross Margin %', format: (v: number) => formatPercent(v), higherIsBetter: true },
    { id: 'breakeven', label: 'Breakeven Rev.', format: (v: number) => formatCurrency(v), higherIsBetter: false },
    {
      id: 'marginOfSafety',
      label: 'Margin of Safety',
      format: (v: number) => {
        const pct = v;
        return isFinite(pct) ? formatPercent(pct) : '—';
      },
      higherIsBetter: true,
    },
  ];

  function getMetricValue(impact: typeof allImpacts[0], metricId: string): number {
    switch (metricId) {
      case 'revenue': return impact.scenarioRevenue;
      case 'netIncome': return impact.scenarioNetIncome;
      case 'grossMarginPct': return impact.scenarioGrossMarginPct;
      case 'breakeven': return impact.scenarioBreakeven;
      case 'marginOfSafety':
        return impact.scenarioRevenue > 0
          ? (impact.scenarioRevenue - impact.scenarioBreakeven) / impact.scenarioRevenue
          : 0;
      default: return 0;
    }
  }

  const chartScenarios = scenarioSeries.map(s => ({
    name: s.name,
    color: s.color,
    data: s.data,
    isBaseline: s.isBaseline,
  }));

  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-base font-bold" style={{ color: 'hsl(var(--foreground))' }}>
        Scenario Comparison
      </h3>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left: Impact Summary Table */}
        <div
          className="rounded-xl border"
          style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
        >
          <div className="p-4 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
            <h4 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
              Impact Summary
            </h4>
          </div>
          <div className="overflow-x-auto p-2">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-xs font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    Metric
                  </th>
                  {workspace.scenarios.map((sc, i) => (
                    <th key={sc.id} className="p-2 text-xs font-medium whitespace-nowrap" style={{ color: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }}>
                      {sc.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map(metric => (
                  <tr key={metric.id} className="border-t" style={{ borderColor: 'hsl(var(--border))' }}>
                    <td className="p-2 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                      {metric.label}
                    </td>
                    {allImpacts.map((impact, i) => {
                      const val = getMetricValue(impact, metric.id);
                      const baseVal = baseImpact ? getMetricValue(baseImpact, metric.id) : val;
                      const isBase = workspace.scenarios[i]?.isBaseline;
                      const color = isBase ? 'hsl(var(--foreground))' : metricColor(val, baseVal, metric.higherIsBetter);
                      return (
                        <td key={impact.scenarioId} className="p-2 font-medium tabular-nums" style={{ color }}>
                          {metric.format(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Chart */}
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
        >
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
              Revenue by Scenario
            </h4>
            <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'hsl(var(--muted))' }}>
              {GRANULARITIES.map(g => (
                <button
                  key={g.id}
                  onClick={() => setGranularity(g.id)}
                  className="px-2 py-0.5 rounded-md text-xs font-medium transition-colors"
                  style={{
                    background: granularity === g.id ? 'hsl(var(--primary))' : 'transparent',
                    color: granularity === g.id ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <ScenarioComparisonChart
            scenarios={chartScenarios}
            metric="revenue"
            height={280}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// WhatIfContent — the inner component with all hooks
// ─────────────────────────────────────────────

function WhatIfContent({ clientId, workspace }: { clientId: string; workspace: ClientWorkspace }) {
  const addScenario = useWorkspaceStore(s => s.addScenario);
  const updateScenario = useWorkspaceStore(s => s.updateScenario);
  const deleteScenario = useWorkspaceStore(s => s.deleteScenario);
  const activeScenarioId = useWorkspaceStore(s => s.activeScenarioId);
  const setActiveScenario = useWorkspaceStore(s => s.setActiveScenario);

  // Ensure default scenarios exist
  useEffect(() => {
    if (workspace.scenarios.length === 0) {
      const firstPeriod = getFirstPeriod(workspace);
      const defaults = buildDefaultScenarios(firstPeriod);
      defaults.forEach(sc => addScenario(clientId, sc));
      if (defaults[0]) setActiveScenario(defaults[0].id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeScenario = useMemo(
    () => workspace.scenarios.find(sc => sc.id === activeScenarioId) ?? workspace.scenarios[0] ?? null,
    [workspace.scenarios, activeScenarioId]
  );

  const baseScenario = useMemo(
    () => workspace.scenarios.find(sc => sc.isBaseline) ?? null,
    [workspace.scenarios]
  );

  const handleSelectScenario = useCallback((id: string) => {
    setActiveScenario(id);
  }, [setActiveScenario]);

  const handleDeleteScenario = useCallback((id: string) => {
    deleteScenario(clientId, id);
    if (activeScenarioId === id) {
      const remaining = workspace.scenarios.filter(sc => sc.id !== id);
      setActiveScenario(remaining[0]?.id ?? null);
    }
  }, [clientId, deleteScenario, activeScenarioId, workspace.scenarios, setActiveScenario]);

  const handleDuplicateScenario = useCallback((scenario: Scenario) => {
    const newScenario: Scenario = {
      ...scenario,
      id: `scenario-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: `${scenario.name} (Copy)`,
      createdAt: new Date().toISOString(),
      isBaseline: false,
    };
    addScenario(clientId, newScenario);
    setActiveScenario(newScenario.id);
  }, [clientId, addScenario, setActiveScenario]);

  const handleRenameScenario = useCallback((scenario: Scenario, name: string) => {
    updateScenario(clientId, { ...scenario, name });
  }, [clientId, updateScenario]);

  const handleNewScenario = useCallback(() => {
    const firstPeriod = getFirstPeriod(workspace);
    const newScenario: Scenario = {
      id: `scenario-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: 'New Scenario',
      description: '',
      adjustments: [],
      createdAt: new Date().toISOString(),
      isBaseline: false,
    };
    addScenario(clientId, newScenario);
    setActiveScenario(newScenario.id);
    void firstPeriod; // suppress unused warning
  }, [clientId, workspace, addScenario, setActiveScenario]);

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
        <Link
          href={`/workspace/${clientId}`}
          className="transition-colors hover:opacity-80"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          ← Workspace
        </Link>
        <span>/</span>
        <span style={{ color: 'hsl(var(--foreground))' }}>{workspace.name}</span>
        <span>/</span>
        <span style={{ color: 'hsl(var(--foreground))' }}>What-If</span>
      </div>

      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
          What-If Scenarios
        </h1>
        <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
          Model revenue and cost adjustments to explore financial outcomes.
        </p>
      </div>

      {/* Top section: Selector + Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel: Scenario Selector */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
              Scenarios
            </h2>
            <button
              onClick={handleNewScenario}
              className="rounded-lg border px-2 py-1 text-xs font-medium transition-colors"
              style={{ borderColor: 'hsl(var(--primary))', color: 'hsl(var(--primary))' }}
            >
              + New
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {workspace.scenarios.map((sc, idx) => (
              <ScenarioCard
                key={sc.id}
                scenario={sc}
                isActive={sc.id === (activeScenario?.id ?? null)}
                colorIndex={idx}
                onSelect={() => handleSelectScenario(sc.id)}
                onDelete={() => handleDeleteScenario(sc.id)}
                onDuplicate={() => handleDuplicateScenario(sc)}
                onRename={(name) => handleRenameScenario(sc, name)}
              />
            ))}
            {workspace.scenarios.length === 0 && (
              <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                No scenarios yet. Creating defaults...
              </p>
            )}
          </div>
        </div>

        {/* Right panel: Scenario Editor */}
        <div className="lg:col-span-2">
          {activeScenario ? (
            <ScenarioEditor
              key={activeScenario.id}
              clientId={clientId}
              workspace={workspace}
              scenario={activeScenario}
              baseScenario={baseScenario}
            />
          ) : (
            <div
              className="rounded-xl border p-8 flex items-center justify-center"
              style={{ borderColor: 'hsl(var(--border))' }}
            >
              <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Select a scenario to edit.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t" style={{ borderColor: 'hsl(var(--border))' }} />

      {/* Bottom: Comparison Section */}
      <ComparisonSection clientId={clientId} workspace={workspace} />
    </div>
  );
}

// ─────────────────────────────────────────────
// Page (outer shell: hydration guard + null check)
// ─────────────────────────────────────────────

interface PageProps {
  params: Promise<{ clientId: string }>;
}

export default function WhatIfPage({ params }: PageProps) {
  const { clientId } = use(params);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (useWorkspaceStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useWorkspaceStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);

  const workspace = useWorkspaceStore(s => s.workspaces.find(w => w.id === clientId));

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'hsl(var(--background))' }}>
        <div className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'hsl(var(--primary))' }} />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'hsl(var(--background))' }}>
        <div className="text-center space-y-4">
          <p className="text-4xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>404</p>
          <p className="text-lg font-medium" style={{ color: 'hsl(var(--foreground))' }}>Workspace not found</p>
          <Link href="/" className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-2" style={{ color: 'hsl(var(--primary))' }}>
            ← Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--background))' }}>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <WhatIfContent clientId={clientId} workspace={workspace} />
      </div>
    </div>
  );
}
