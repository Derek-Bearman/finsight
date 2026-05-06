'use client';

import { useState, useMemo } from 'react';
import { ALL_FIXTURES, FIXTURES_MAP } from '@/fixtures';
import { ALL_PROFILES, PROFILE_MAP } from '@/lib/profiles';
import { formatCurrency, formatPercent } from '@/lib/utils/format';
import { periodLabel } from '@/lib/utils/period';
import type { ClientWorkspace, Account, AccountType, CostBehavior } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ACCOUNT_TYPE_COLORS: Record<AccountType, string> = {
  revenue:   'bg-emerald-100 text-emerald-800 border-emerald-200',
  cogs:      'bg-orange-100 text-orange-800 border-orange-200',
  expense:   'bg-red-100 text-red-800 border-red-200',
  asset:     'bg-blue-100 text-blue-800 border-blue-200',
  liability: 'bg-purple-100 text-purple-800 border-purple-200',
  equity:    'bg-indigo-100 text-indigo-800 border-indigo-200',
};

const BEHAVIOR_COLORS: Record<CostBehavior, string> = {
  variable:      'bg-amber-100 text-amber-800',
  fixed:         'bg-slate-100 text-slate-700',
  mixed:         'bg-teal-100 text-teal-800',
  unclassified:  'bg-gray-100 text-gray-600',
};

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${className}`}>
      {label}
    </span>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h3>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{count}</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Financial Summary (quick totals for selected period)
// ─────────────────────────────────────────────────────────────────────────────

function computeSummary(workspace: ClientWorkspace, year: number) {
  const accounts = workspace.accounts;
  const values = workspace.values.filter((v) => v.period.year === year);

  const sumByType = (type: AccountType) => {
    const ids = new Set(accounts.filter((a) => a.type === type).map((a) => a.id));
    return values.filter((v) => ids.has(v.accountId)).reduce((s, v) => s + v.amount, 0);
  };

  const revenue   = sumByType('revenue');
  const cogs      = sumByType('cogs');
  const expenses  = sumByType('expense');
  const grossProfit = revenue - cogs;
  const netIncome   = grossProfit - expenses;

  return { revenue, cogs, grossProfit, expenses, netIncome };
}

// ─────────────────────────────────────────────────────────────────────────────
// Account Row
// ─────────────────────────────────────────────────────────────────────────────

function AccountRow({ account, latestValue }: { account: Account; latestValue: number | undefined }) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
      <td className="py-2 px-3 font-mono text-xs text-muted-foreground w-20">{account.number ?? '—'}</td>
      <td className="py-2 px-3 text-sm">{account.name}</td>
      <td className="py-2 px-3">
        <Badge label={account.type} className={ACCOUNT_TYPE_COLORS[account.type]} />
      </td>
      <td className="py-2 px-3">
        {account.costBehavior && account.costBehavior !== 'unclassified' ? (
          <Badge label={account.costBehavior} className={BEHAVIOR_COLORS[account.costBehavior]} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-2 px-3 text-right font-mono text-sm tabular-nums">
        {latestValue !== undefined ? (
          <span className={latestValue < 0 ? 'accounting-negative' : ''}>
            {formatCurrency(latestValue)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly Sparkline Table
// ─────────────────────────────────────────────────────────────────────────────

function MonthlyTable({ workspace, accountType }: { workspace: ClientWorkspace; accountType: AccountType }) {
  const accounts = workspace.accounts.filter((a) => a.type === accountType);
  if (accounts.length === 0) return null;

  // Get all available periods, sorted
  const periods = [...new Set(workspace.values.map((v) => `${v.period.year}-${String(v.period.month).padStart(2,'0')}`))]
    .sort()
    .map((s) => {
      const [y, m] = s.split('-');
      return { year: parseInt(y), month: parseInt(m) };
    });

  // Show last 6 periods
  const shownPeriods = periods.slice(-6);

  // Build totals
  const totals = shownPeriods.map((p) => {
    const ids = new Set(accounts.map((a) => a.id));
    return workspace.values
      .filter((v) => ids.has(v.accountId) && v.period.year === p.year && v.period.month === p.month)
      .reduce((s, v) => s + v.amount, 0);
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Account</th>
            {shownPeriods.map((p) => (
              <th key={`${p.year}-${p.month}`} className="text-right py-1.5 px-2 font-medium text-muted-foreground">
                {periodLabel(p)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} className="border-b border-border/30">
              <td className="py-1.5 px-2 text-foreground">{account.name}</td>
              {shownPeriods.map((p) => {
                const val = workspace.values.find(
                  (v) => v.accountId === account.id && v.period.year === p.year && v.period.month === p.month
                )?.amount;
                return (
                  <td key={`${p.year}-${p.month}`} className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                    {val !== undefined ? formatCurrency(val) : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
          {/* Totals row */}
          <tr className="bg-muted/30 font-semibold">
            <td className="py-1.5 px-2 text-foreground">Total</td>
            {totals.map((total, i) => (
              <td key={i} className={`py-1.5 px-2 text-right tabular-nums ${total < 0 ? 'accounting-negative' : ''}`}>
                {formatCurrency(total)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Hints Panel
// ─────────────────────────────────────────────────────────────────────────────

function ProfileHintsPanel({ profileId }: { profileId: string }) {
  const profile = PROFILE_MAP[profileId];
  if (!profile) return null;

  if (profile.classificationHints.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No profile-specific hints (generic fallback).</p>;
  }

  return (
    <div className="space-y-2">
      {profile.classificationHints.map((hint, i) => (
        <div key={i} className="flex items-start gap-3 text-sm bg-muted/30 rounded-md p-2">
          <div className="flex flex-wrap gap-1 flex-1">
            {hint.keywords.map((kw) => (
              <code key={kw} className="px-1.5 py-0.5 bg-background border border-border rounded text-xs font-mono">
                {kw}
              </code>
            ))}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hint.accountType && (
              <Badge label={hint.accountType} className={ACCOUNT_TYPE_COLORS[hint.accountType]} />
            )}
            {hint.costBehavior && (
              <Badge label={hint.costBehavior} className={BEHAVIOR_COLORS[hint.costBehavior]} />
            )}
            <span className={`text-xs font-medium ${
              hint.confidence === 'high' ? 'text-emerald-600' :
              hint.confidence === 'medium' ? 'text-amber-600' : 'text-slate-500'
            }`}>
              {hint.confidence}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Operational Metrics Panel
// ─────────────────────────────────────────────────────────────────────────────

function OperationalMetricsPanel({ profileId }: { profileId: string }) {
  const profile = PROFILE_MAP[profileId];
  if (!profile) return null;

  return (
    <div className="space-y-3">
      {profile.operationalMetrics.map((metric) => (
        <div key={metric.id} className="border border-border rounded-md p-3">
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="text-sm font-medium">{metric.label}</span>
            <div className="flex items-center gap-1.5">
              {metric.category && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{metric.category}</span>
              )}
              <span className="text-xs text-muted-foreground bg-accent/50 px-2 py-0.5 rounded">{metric.format}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-2">{metric.formula}</p>
          <div className="flex flex-wrap gap-1">
            {metric.inputFields.map((f) => (
              <span key={f.id} className="text-xs bg-muted border border-border px-2 py-0.5 rounded font-mono">
                {f.label} ({f.unit})
              </span>
            ))}
          </div>
          {metric.benchmark && (
            <div className="mt-2 text-xs text-muted-foreground">
              Benchmark: 🟢 {metric.format === 'percent'
                ? formatPercent(metric.benchmark.good)
                : metric.benchmark.good} /
              🟡 {metric.format === 'percent'
                ? formatPercent(metric.benchmark.warn)
                : metric.benchmark.warn} /
              🔴 {metric.format === 'percent'
                ? formatPercent(metric.benchmark.bad)
                : metric.benchmark.bad} ({metric.benchmark.direction} is better)
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Dev Page
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'accounts' | 'monthly' | 'profile' | 'raw';

export default function DevPage() {
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>(ALL_FIXTURES[0].id);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [filterType, setFilterType] = useState<AccountType | 'all'>('all');

  const workspace = FIXTURES_MAP[selectedFixtureId] as ClientWorkspace;
  const profile = PROFILE_MAP[workspace.industryProfileId];

  // Determine available years
  const years = useMemo(() => {
    const ys = [...new Set(workspace.values.map((v) => v.period.year))].sort();
    return ys;
  }, [workspace]);
  const latestYear = years[years.length - 1];

  const summary = useMemo(() => computeSummary(workspace, latestYear), [workspace, latestYear]);

  // Latest month for each account
  const latestValues = useMemo(() => {
    const map = new Map<string, number>();
    const latestPeriods = new Map<string, { year: number; month: number }>();
    for (const v of workspace.values) {
      const existing = latestPeriods.get(v.accountId);
      if (!existing || v.period.year > existing.year || (v.period.year === existing.year && v.period.month > existing.month)) {
        latestPeriods.set(v.accountId, v.period);
        map.set(v.accountId, v.amount);
      }
    }
    return map;
  }, [workspace]);

  const filteredAccounts = workspace.accounts.filter(
    (a) => filterType === 'all' || a.type === filterType
  );

  const totalValues = workspace.values.length;
  const totalAccounts = workspace.accounts.length;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview',  label: 'Overview' },
    { id: 'accounts',  label: 'Chart of Accounts' },
    { id: 'monthly',   label: 'Monthly Data' },
    { id: 'profile',   label: 'Profile Config' },
    { id: 'raw',       label: 'Raw JSON' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded">
                  DEV
                </span>
                <h1 className="text-lg font-semibold">FinSight — Phase 1 Inspector</h1>
              </div>
              <p className="text-sm text-muted-foreground">
                Data model, industry profiles &amp; fixture verification
              </p>
            </div>

            {/* Fixture Selector */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground">Fixture:</label>
              <select
                value={selectedFixtureId}
                onChange={(e) => { setSelectedFixtureId(e.target.value); setActiveTab('overview'); }}
                className="text-sm border border-border rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid="select-fixture"
              >
                {ALL_FIXTURES.map((f) => {
                  const p = PROFILE_MAP[f.industryProfileId];
                  return (
                    <option key={f.id} value={f.id}>
                      {p?.icon} {f.name} ({p?.name})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Workspace Identity */}
        <div className="flex items-center gap-4 mb-6 p-4 bg-card border border-border rounded-lg">
          <div className="text-3xl">{profile?.icon}</div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold">{workspace.name}</h2>
            <p className="text-sm text-muted-foreground">{profile?.name} · {profile?.description}</p>
          </div>
          <div className="flex gap-4 text-right">
            <div>
              <div className="text-xs text-muted-foreground">Accounts</div>
              <div className="text-lg font-semibold tabular-nums">{totalAccounts}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Data Points</div>
              <div className="text-lg font-semibold tabular-nums">{totalValues}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Periods</div>
              <div className="text-lg font-semibold tabular-nums">{years.length * 12}</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              data-testid={`tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── TAB: Overview ────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Financial Summary */}
            <div>
              <SectionHeader title={`${latestYear} Financial Summary (Annual Totals)`} />
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Revenue',       value: summary.revenue,     positive: true },
                  { label: 'COGS',          value: summary.cogs,        positive: false },
                  { label: 'Gross Profit',  value: summary.grossProfit, positive: summary.grossProfit >= 0 },
                  { label: 'Expenses',      value: summary.expenses,    positive: false },
                  { label: 'Net Income',    value: summary.netIncome,   positive: summary.netIncome >= 0 },
                ].map(({ label, value, positive }) => (
                  <div key={label} className="bg-card border border-border rounded-lg p-4">
                    <div className="text-xs text-muted-foreground mb-1">{label}</div>
                    <div className={`text-lg font-semibold tabular-nums ${
                      !positive && value < 0 ? 'accounting-negative' :
                      positive ? 'accounting-positive' : ''
                    }`}>
                      {formatCurrency(value)}
                    </div>
                    {label === 'Gross Profit' && summary.revenue > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatPercent(summary.grossProfit / summary.revenue)} margin
                      </div>
                    )}
                    {label === 'Net Income' && summary.revenue > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatPercent(summary.netIncome / summary.revenue)} margin
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Account Type Breakdown */}
            <div>
              <SectionHeader title="Account Type Breakdown" />
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {(['revenue','cogs','expense','asset','liability','equity'] as AccountType[]).map((type) => {
                  const count = workspace.accounts.filter((a) => a.type === type).length;
                  return (
                    <div key={type} className={`rounded-lg p-3 border ${ACCOUNT_TYPE_COLORS[type]}`}>
                      <div className="text-xs font-medium capitalize">{type}</div>
                      <div className="text-xl font-semibold mt-1">{count}</div>
                      <div className="text-xs opacity-70">accounts</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Operational Data Preview */}
            {workspace.operationalData.length > 0 && (
              <div>
                <SectionHeader title="Sample Operational Data" count={workspace.operationalData.length} />
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left py-2 px-4 text-muted-foreground font-medium">Metric</th>
                        <th className="text-left py-2 px-4 text-muted-foreground font-medium">Period</th>
                        <th className="text-left py-2 px-4 text-muted-foreground font-medium">Inputs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspace.operationalData.map((dp, i) => (
                        <tr key={i} className="border-t border-border/50">
                          <td className="py-2 px-4 font-mono text-xs">{dp.metricDefId}</td>
                          <td className="py-2 px-4 text-muted-foreground text-xs">{periodLabel(dp.period)}</td>
                          <td className="py-2 px-4 text-xs font-mono text-muted-foreground">
                            {Object.entries(dp.inputs).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Profile Quick Stats */}
            <div>
              <SectionHeader title="Profile Configuration" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Default Growth Rate', value: formatPercent(profile.defaultGrowthRate) },
                  { label: 'Projection Model', value: profile.defaultProjectionModel },
                  { label: 'Seasonality', value: profile.seasonalityExpected ? 'Expected' : 'Not expected' },
                  { label: 'Capacity Unit', value: profile.labels.capacityUnit ?? 'N/A' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-card border border-border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground mb-1">{label}</div>
                    <div className="text-sm font-medium capitalize">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: Accounts ─────────────────────────────────────────────────── */}
        {activeTab === 'accounts' && (
          <div>
            {/* Filter */}
            <div className="flex gap-2 mb-4 flex-wrap">
              {(['all', 'revenue', 'cogs', 'expense', 'asset', 'liability', 'equity'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    filterType === t
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                  data-testid={`filter-${t}`}
                >
                  {t === 'all' ? `All (${workspace.accounts.length})` : `${t} (${workspace.accounts.filter(a => a.type === t).length})`}
                </button>
              ))}
            </div>

            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium w-20">Acct #</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Name</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Type</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Behavior</th>
                    <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Latest Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      latestValue={latestValues.get(account.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB: Monthly Data ─────────────────────────────────────────────── */}
        {activeTab === 'monthly' && (
          <div className="space-y-6">
            {(['revenue', 'cogs', 'expense', 'asset', 'liability', 'equity'] as AccountType[]).map((type) => (
              <div key={type}>
                <SectionHeader
                  title={type.charAt(0).toUpperCase() + type.slice(1)}
                  count={workspace.accounts.filter((a) => a.type === type).length}
                />
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                  <MonthlyTable workspace={workspace} accountType={type} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── TAB: Profile Config ───────────────────────────────────────────── */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <div>
              <SectionHeader title="Classification Hints" count={profile.classificationHints.length} />
              <ProfileHintsPanel profileId={workspace.industryProfileId} />
            </div>

            <div className="border-t border-border pt-6">
              <SectionHeader title="Operational Metrics" count={profile.operationalMetrics.length} />
              <OperationalMetricsPanel profileId={workspace.industryProfileId} />
            </div>

            <div className="border-t border-border pt-6">
              <SectionHeader title="Benchmarks" count={profile.benchmarks.length} />
              <div className="space-y-2">
                {profile.benchmarks.map((b) => (
                  <div key={b.metricId} className="flex items-center justify-between bg-card border border-border rounded-md p-3 text-sm">
                    <span className="font-medium">{b.metricId}</span>
                    <div className="flex gap-4 text-muted-foreground">
                      <span>Low: {b.range.low}</span>
                      <span>Typical: {b.range.typical}</span>
                      <span>High: {b.range.high}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: Raw JSON ─────────────────────────────────────────────────── */}
        {activeTab === 'raw' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Raw workspace JSON — {JSON.stringify(workspace).length.toLocaleString()} bytes
              </p>
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${workspace.id}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                Download JSON
              </button>
            </div>
            <pre className="bg-card border border-border rounded-lg p-4 text-xs font-mono overflow-auto max-h-[600px] text-muted-foreground">
              {JSON.stringify({ ...workspace, values: `[${workspace.values.length} AccountValue objects — truncated for display]` }, null, 2)}
            </pre>
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 pt-4 border-t border-border text-center text-xs text-muted-foreground">
          FinSight Phase 1 · {ALL_PROFILES.length} profiles · {ALL_FIXTURES.length} fixtures ·
          Total data points: {ALL_FIXTURES.reduce((s, f) => s + f.values.length, 0).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
