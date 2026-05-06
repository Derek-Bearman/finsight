'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import type { Account, AccountType, CostBehavior, AccountValue, Period } from '@/types';

interface ManualEntryFormProps {
  profileId: string;
  existingAccounts: Account[];
  onAdd: (account: Account, values: AccountValue[]) => void;
  onDone: () => void;
}

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'cogs', label: 'COGS' },
  { value: 'expense', label: 'Expense' },
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
];

const COST_BEHAVIORS: { value: CostBehavior; label: string }[] = [
  { value: 'variable', label: 'Variable' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'mixed', label: 'Mixed' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

const accountSchema = z.object({
  number: z.string().optional(),
  name: z.string().min(1, 'Account name is required'),
  type: z.enum(['revenue', 'cogs', 'expense', 'asset', 'liability', 'equity']),
  costBehavior: z.enum(['variable', 'fixed', 'mixed']).optional(),
});

type AccountFormData = z.infer<typeof accountSchema>;

interface PeriodEntry {
  period: Period;
  amount: string;
}

function generateAccountId(): string {
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium mb-1" style={{ color: 'hsl(var(--foreground))' }}>
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

export function ManualEntryForm({
  existingAccounts,
  onAdd,
  onDone,
}: ManualEntryFormProps) {
  const [periods, setPeriods] = useState<PeriodEntry[]>([
    { period: { year: currentYear, month: new Date().getMonth() + 1 }, amount: '' },
  ]);
  const [addedCount, setAddedCount] = useState(0);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<AccountFormData>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      type: 'expense',
    },
  });

  const selectedType = watch('type');
  const showCostBehavior = selectedType === 'cogs' || selectedType === 'expense';

  const addPeriodRow = () => {
    const last = periods[periods.length - 1];
    let nextMonth = last ? last.period.month + 1 : new Date().getMonth() + 2;
    let nextYear = last ? last.period.year : currentYear;
    if (nextMonth > 12) { nextMonth = 1; nextYear++; }
    setPeriods((prev) => [...prev, { period: { year: nextYear, month: nextMonth }, amount: '' }]);
  };

  const removePeriodRow = (idx: number) => {
    setPeriods((prev) => prev.filter((_, i) => i !== idx));
  };

  const updatePeriodField = (idx: number, field: 'year' | 'month', value: number) => {
    setPeriods((prev) =>
      prev.map((p, i) => i === idx ? { ...p, period: { ...p.period, [field]: value } } : p)
    );
  };

  const updateAmount = (idx: number, value: string) => {
    setPeriods((prev) =>
      prev.map((p, i) => i === idx ? { ...p, amount: value } : p)
    );
  };

  const onSubmit = (data: AccountFormData) => {
    const id = generateAccountId();
    const account: Account = {
      id,
      number: data.number || undefined,
      name: data.name,
      type: data.type,
      costBehavior: showCostBehavior ? (data.costBehavior ?? 'unclassified') : undefined,
      isManuallyClassified: true,
      classificationSource: 'manual',
    };

    const values: AccountValue[] = periods
      .filter((p) => p.amount.trim() !== '')
      .map((p) => ({
        accountId: id,
        period: p.period,
        amount: parseFloat(p.amount.replace(/,/g, '')) || 0,
      }));

    onAdd(account, values);
    setAddedCount((c) => c + 1);
    reset({ type: 'expense', name: '', number: '' });
    setPeriods([{ period: { year: currentYear, month: new Date().getMonth() + 1 }, amount: '' }]);
  };

  const isDuplicateName = (name: string) =>
    existingAccounts.some((a) => a.name.toLowerCase() === name.toLowerCase());

  return (
    <div className="flex flex-col gap-6">
      {addedCount > 0 && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            background: 'hsl(var(--accent))',
            borderColor: 'hsl(var(--border))',
            color: 'hsl(var(--accent-foreground))',
          }}
        >
          {addedCount} account{addedCount !== 1 ? 's' : ''} added. Add another or click "Done".
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" data-testid="manual-entry-form">
        {/* Account info */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel>Account Number</FieldLabel>
            <input
              {...register('number')}
              placeholder="e.g. 4000"
              data-testid="field-account-number"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
              style={{
                borderColor: 'hsl(var(--border))',
                background: 'hsl(var(--background))',
                color: 'hsl(var(--foreground))',
              }}
            />
          </div>

          <div>
            <FieldLabel required>Account Name</FieldLabel>
            <input
              {...register('name')}
              placeholder="e.g. Advertising Expense"
              data-testid="field-account-name"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
              style={{
                borderColor: errors.name ? 'hsl(var(--destructive))' : 'hsl(var(--border))',
                background: 'hsl(var(--background))',
                color: 'hsl(var(--foreground))',
              }}
            />
            <FieldError message={errors.name?.message} />
            {!errors.name && watch('name') && isDuplicateName(watch('name')) && (
              <p className="mt-1 text-xs text-amber-600">An account with this name already exists.</p>
            )}
          </div>

          <div>
            <FieldLabel required>Account Type</FieldLabel>
            <select
              {...register('type')}
              data-testid="field-account-type"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
              style={{
                borderColor: 'hsl(var(--border))',
                background: 'hsl(var(--background))',
                color: 'hsl(var(--foreground))',
              }}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {showCostBehavior && (
            <div>
              <FieldLabel>Cost Behavior</FieldLabel>
              <select
                {...register('costBehavior')}
                data-testid="field-cost-behavior"
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
                style={{
                  borderColor: 'hsl(var(--border))',
                  background: 'hsl(var(--background))',
                  color: 'hsl(var(--foreground))',
                }}
              >
                <option value="">Select…</option>
                {COST_BEHAVIORS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Period / amounts */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <FieldLabel>Period Values</FieldLabel>
            <button
              type="button"
              onClick={addPeriodRow}
              data-testid="add-period-row"
              className="text-xs font-medium transition-colors"
              style={{ color: 'hsl(var(--primary))' }}
            >
              + Add Period
            </button>
          </div>

          <div className="space-y-2">
            {periods.map((entry, idx) => (
              <div key={idx} className="flex items-center gap-2">
                {/* Month */}
                <select
                  value={entry.period.month}
                  onChange={(e) => updatePeriodField(idx, 'month', parseInt(e.target.value, 10))}
                  data-testid={`period-month-${idx}`}
                  className="rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2"
                  style={{
                    borderColor: 'hsl(var(--border))',
                    background: 'hsl(var(--background))',
                    color: 'hsl(var(--foreground))',
                  }}
                >
                  {MONTHS.map((m, mi) => (
                    <option key={m} value={mi + 1}>
                      {m}
                    </option>
                  ))}
                </select>

                {/* Year */}
                <select
                  value={entry.period.year}
                  onChange={(e) => updatePeriodField(idx, 'year', parseInt(e.target.value, 10))}
                  data-testid={`period-year-${idx}`}
                  className="rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2"
                  style={{
                    borderColor: 'hsl(var(--border))',
                    background: 'hsl(var(--background))',
                    color: 'hsl(var(--foreground))',
                  }}
                >
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>

                {/* Amount */}
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={entry.amount}
                  onChange={(e) => updateAmount(idx, e.target.value)}
                  data-testid={`period-amount-${idx}`}
                  className="flex-1 rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2"
                  style={{
                    borderColor: 'hsl(var(--border))',
                    background: 'hsl(var(--background))',
                    color: 'hsl(var(--foreground))',
                  }}
                />

                {periods.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePeriodRow(idx)}
                    data-testid={`remove-period-${idx}`}
                    className="shrink-0 rounded p-1 hover:opacity-70 transition-opacity"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                    aria-label="Remove period"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Form actions */}
        <div className="flex items-center justify-between pt-2">
          <Button type="button" variant="ghost" onClick={onDone} data-testid="manual-done">
            Done
          </Button>
          <Button type="submit" data-testid="manual-add-account">
            Add Account
          </Button>
        </div>
      </form>
    </div>
  );
}
