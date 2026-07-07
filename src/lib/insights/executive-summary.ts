/**
 * Plain-English executive summary (Bob feature d — the Qvinci/ProfitKeeper
 * gap-closer: comprehensive engine, legible surface).
 *
 * Builds 4–7 deterministic, data-driven sentences from the calculation
 * outputs. TEMPLATE-BASED on purpose: no AI dependency, same data in → same
 * words out, every number traceable to the statements. Sentences skip
 * gracefully when their data is missing.
 *
 * Pure function — no I/O, no React — so it runs identically on the Overview,
 * Reports, and the printed client report, and is unit-checkable headless.
 */

import type { Account, AccountValue, ClientWorkspace, Period } from '@/types';
import { buildPeriodAggregations, computePnL, toFinancialSummary } from '@/lib/calculations/pnl';
import { computeBalanceSheetRatios } from '@/lib/calculations/balance-sheet';
import { computeHealthScores } from '@/lib/calculations/health';
import { computeProfitabilityRatios } from '@/lib/calculations/profitability';
import { computeMetricsForPeriod } from '@/lib/operational/calculator';
import { getProfile } from '@/lib/profiles';
import type { PeriodAggregation } from '@/types';
import { FUNNEL_INPUT_IDS } from '@/lib/operational/funnel';
import { RATIO_DEF_MAP, meetsTarget, formatTargetThreshold, type RatioKey } from '@/lib/targets';
import { formatCurrency, formatPercent } from '@/lib/utils/format';

export interface SummaryLine {
  text: string;
  tone: 'positive' | 'negative' | 'neutral' | 'watch';
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function monthName(p: Period): string {
  return `${MONTHS[p.month - 1]} ${p.year}`;
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return (curr - prev) / Math.abs(prev);
}

function fmtPct(n: number): string {
  return `${(Math.abs(n) * 100).toFixed(1)}%`;
}

function fmtPts(n: number): string {
  return `${Math.abs(n * 100).toFixed(1)} pt${Math.abs(n * 100) >= 1.95 ? 's' : ''}`;
}

/** Sum an account's value for a period from raw values (excluded rows skipped). */
function accountAmount(values: AccountValue[], accountId: string, period: Period): number {
  return values
    .filter((v) => v.accountId === accountId && v.period.year === period.year && v.period.month === period.month)
    .reduce((s, v) => s + v.amount, 0);
}

/** The active (non-excluded) account with the largest delta between periods. */
function biggestMover(
  accounts: Account[],
  values: AccountValue[],
  type: Account['type'],
  latest: Period,
  prior: Period
): { account: Account; delta: number; prev: number } | null {
  let best: { account: Account; delta: number; prev: number } | null = null;
  for (const a of accounts) {
    if (a.type !== type || a.isExcluded) continue;
    const curr = accountAmount(values, a.id, latest);
    const prev = accountAmount(values, a.id, prior);
    const delta = curr - prev;
    if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { account: a, delta, prev };
  }
  return best;
}

function isCashAccount(a: Account): boolean {
  if (a.type !== 'asset' || a.isExcluded) return false;
  const num = a.number ? parseInt(a.number, 10) : NaN;
  if (!isNaN(num) && num >= 1000 && num <= 1099) return true;
  const name = a.name.toLowerCase();
  return name.includes('cash') || name.includes('checking') || name.includes('savings');
}

export function buildExecutiveSummary(ws: ClientWorkspace): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const allAggs: PeriodAggregation[] = buildPeriodAggregations(ws.accounts, ws.values, 'monthly');
  if (allAggs.length === 0) return lines;

  // Anchor the P&L narrative on months that actually contain P&L data. A
  // trailing balance-sheet-only month (a BS as-of date one month past the
  // last closed P&L month is a routine QBO export offset) would otherwise
  // read as a $0-revenue month and deflate the trailing cost averages.
  const pnlAccountIds = new Set(
    ws.accounts
      .filter((a) => !a.isExcluded && (a.type === 'revenue' || a.type === 'cogs' || a.type === 'expense'))
      .map((a) => a.id)
  );
  const pnlPeriodKeys = new Set(
    ws.values
      .filter((v) => pnlAccountIds.has(v.accountId))
      .map((v) => `${v.period.year}-${v.period.month}`)
  );
  const aggs = allAggs.filter((a) => pnlPeriodKeys.has(`${a.period.year}-${a.period.month}`));
  if (aggs.length === 0) return lines;

  const latest = aggs[aggs.length - 1]!;
  const prior = aggs.length >= 2 ? aggs[aggs.length - 2]! : null;

  // ── 1. Revenue trend ────────────────────────────────────────────────────
  if (latest.revenue > 0 || (prior && prior.revenue > 0)) {
    let text = `Revenue for ${monthName(latest.period)} was ${formatCurrency(latest.revenue)}`;
    let tone: SummaryLine['tone'] = 'neutral';
    if (aggs.length >= 6) {
      const last3 = aggs.slice(-3).reduce((s, a) => s + a.revenue, 0);
      const prev3 = aggs.slice(-6, -3).reduce((s, a) => s + a.revenue, 0);
      const growth = pctChange(last3, prev3);
      if (growth !== null && Math.abs(growth) >= 0.005) {
        text = `Revenue ${growth >= 0 ? 'grew' : 'declined'} ${fmtPct(growth)} over the trailing three months (${formatCurrency(latest.revenue)} in ${monthName(latest.period)})`;
        tone = growth >= 0 ? 'positive' : 'negative';
      }
    } else if (prior) {
      const mom = pctChange(latest.revenue, prior.revenue);
      if (mom !== null && Math.abs(mom) >= 0.005) {
        text += `, ${mom >= 0 ? 'up' : 'down'} ${fmtPct(mom)} from ${monthName(prior.period)}`;
        tone = mom >= 0 ? 'positive' : 'negative';
      }
    }
    // Name the biggest revenue mover when it explains a real share of change.
    if (prior) {
      const mover = biggestMover(ws.accounts, ws.values, 'revenue', latest.period, prior.period);
      const totalDelta = latest.revenue - prior.revenue;
      if (
        mover &&
        Math.abs(totalDelta) > 0 &&
        Math.sign(mover.delta) === Math.sign(totalDelta) &&
        Math.abs(mover.delta) >= Math.abs(totalDelta) * 0.4 &&
        ws.accounts.filter((a) => a.type === 'revenue' && !a.isExcluded).length > 1
      ) {
        text += `, led by ${mover.account.name}`;
      }
    }
    lines.push({ text: text + '.', tone });
  }

  // ── 2. Gross margin ─────────────────────────────────────────────────────
  if (latest.revenue > 0) {
    const gm = latest.grossMarginPct;
    if (prior && prior.revenue > 0) {
      const delta = gm - prior.grossMarginPct;
      if (Math.abs(delta) < 0.005) {
        lines.push({ text: `Gross margin held steady at ${formatPercent(gm)}.`, tone: 'neutral' });
      } else {
        lines.push({
          text: `Gross margin ${delta > 0 ? 'improved' : 'slipped'} ${fmtPts(delta)} to ${formatPercent(gm)}.`,
          tone: delta > 0 ? 'positive' : 'negative',
        });
      }
    } else {
      lines.push({ text: `Gross margin is ${formatPercent(gm)}.`, tone: 'neutral' });
    }
  }

  // ── 3. Bottom line ──────────────────────────────────────────────────────
  {
    const ni = latest.netIncome;
    let text: string;
    let tone: SummaryLine['tone'];
    if (ni >= 0) {
      text = `The business earned ${formatCurrency(ni)} in ${monthName(latest.period)}`;
      tone = 'positive';
    } else {
      text = `The business lost ${formatCurrency(Math.abs(ni))} in ${monthName(latest.period)}`;
      tone = 'negative';
    }
    if (latest.revenue > 0) text += ` (${formatPercent(latest.netMarginPct)} net margin)`;
    if (prior && prior.revenue > 0 && latest.revenue > 0) {
      const delta = latest.netMarginPct - prior.netMarginPct;
      if (Math.abs(delta) >= 0.005) {
        text += `, with net margin ${delta > 0 ? 'up' : 'down'} ${fmtPts(delta)} versus the prior month`;
      }
    }
    lines.push({ text: text + '.', tone });
  }

  // ── 4. Cash coverage ────────────────────────────────────────────────────
  {
    const cashAccounts = ws.accounts.filter(isCashAccount);
    if (cashAccounts.length > 0) {
      // Cash is a snapshot — use the freshest month that actually has cash
      // data (a trailing BS-only month is the right source here), while the
      // cost average below stays on P&L-bearing months.
      const cashIds = new Set(cashAccounts.map((a) => a.id));
      let cashPeriod: Period | null = null;
      for (const v of ws.values) {
        if (!cashIds.has(v.accountId)) continue;
        if (
          !cashPeriod ||
          v.period.year > cashPeriod.year ||
          (v.period.year === cashPeriod.year && v.period.month > cashPeriod.month)
        ) {
          cashPeriod = v.period;
        }
      }
      const snapshotPeriod = cashPeriod ?? latest.period;
      const cash = cashAccounts.reduce(
        (s, a) => s + accountAmount(ws.values, a.id, snapshotPeriod),
        0
      );
      const recent = aggs.slice(-3);
      const avgMonthlyCosts =
        recent.reduce((s, a) => s + a.cogs + a.operatingExpenses, 0) / recent.length;
      if (cash > 0 && avgMonthlyCosts > 0) {
        const months = cash / avgMonthlyCosts;
        const monthsText = months.toFixed(1);
        lines.push({
          text: `Cash on hand (${formatCurrency(cash)}) covers ${monthsText} month${monthsText === '1.0' ? '' : 's'} of average operating costs.`,
          tone: months >= 3 ? 'positive' : months >= 1.5 ? 'neutral' : 'watch',
        });
      }
    }
  }

  // ── 5. Targets scorecard (ratio AND operational-metric targets) ─────────
  if (
    ws.targets &&
    (Object.keys(ws.targets.ratios ?? {}).length > 0 ||
      Object.keys(ws.targets.metrics ?? {}).length > 0)
  ) {
    const bs = computeBalanceSheetRatios(ws.accounts, ws.values, latest.period);
    const health = computeHealthScores(ws.accounts, ws.values, latest.period);
    const prof = computeProfitabilityRatios(
      ws.accounts,
      ws.values,
      latest.period,
      prior?.period
    );
    const ratioValues: Partial<Record<RatioKey, number | null>> = {
      gross_margin: latest.revenue > 0 ? latest.grossMarginPct : null,
      net_margin: latest.revenue > 0 ? latest.netMarginPct : null,
      contribution_margin: latest.revenue > 0 ? latest.contributionMarginPct : null,
      current_ratio: bs.currentRatio,
      debt_to_equity: bs.debtToEquity,
      roe: prof.roe,
      altman_z: health.altmanZScore,
    };
    let total = 0;
    let met = 0;
    let worst: { label: string; valueText: string; target: string } | null = null;
    for (const [key, target] of Object.entries(ws.targets.ratios ?? {})) {
      const def = RATIO_DEF_MAP[key];
      const value = ratioValues[key as RatioKey];
      if (!def || value === null || value === undefined) continue;
      total++;
      if (meetsTarget(value, target)) {
        met++;
      } else if (!worst) {
        worst = {
          label: def.label,
          valueText: formatMetric(value, def.format),
          target: formatTargetThreshold(target, def.format),
        };
      }
    }
    // Operational-metric targets (food cost %, CAC, …) count too — corporate
    // mandates live here for franchise clients.
    const metricTargets = ws.targets.metrics ?? {};
    if (Object.keys(metricTargets).length > 0) {
      const profile = getProfile(ws.industryProfileId);
      const summary = toFinancialSummary(
        computePnL(ws.accounts, ws.values, latest.period),
        latest.period
      );
      const metricResults = computeMetricsForPeriod(
        profile.operationalMetrics,
        ws.operationalData ?? [],
        summary,
        latest.period,
        ws.operationalInputs
      );
      for (const [metricId, target] of Object.entries(metricTargets)) {
        const result = metricResults.find((r) => r.metricId === metricId);
        if (!result || result.value === null) continue;
        total++;
        if (meetsTarget(result.value, target)) {
          met++;
        } else if (!worst) {
          worst = {
            label: result.label,
            valueText: formatMetric(result.value, result.format),
            target: formatTargetThreshold(target, result.format),
          };
        }
      }
    }
    if (total > 0) {
      let text = `${met} of ${total} client target${total === 1 ? ' is' : 's are'} met this month`;
      if (worst) {
        text += ` — ${worst.label} is ${worst.valueText} against a target of ${worst.target}`;
      }
      lines.push({ text: text + '.', tone: met === total ? 'positive' : 'watch' });
    }
  }

  // ── 6. Marketing funnel ─────────────────────────────────────────────────
  {
    const pools = [...(ws.operationalInputs ?? [])].sort(
      (a, b) => a.period.year * 12 + a.period.month - (b.period.year * 12 + b.period.month)
    );
    const latestPool = pools.find(
      (p) => p.period.year === latest.period.year && p.period.month === latest.period.month
    );
    const priorPool = prior
      ? pools.find((p) => p.period.year === prior.period.year && p.period.month === prior.period.month)
      : undefined;
    const leads = latestPool?.sharedInputs[FUNNEL_INPUT_IDS.leads];
    if (latestPool && leads !== undefined) {
      const spend =
        latestPool.sharedInputs[FUNNEL_INPUT_IDS.spend] !== undefined &&
        latestPool.sharedInputs[FUNNEL_INPUT_IDS.spend]! > 0
          ? latestPool.sharedInputs[FUNNEL_INPUT_IDS.spend]!
          : null;
      const priorLeads = priorPool?.sharedInputs[FUNNEL_INPUT_IDS.leads];
      const priorSpend = priorPool?.sharedInputs[FUNNEL_INPUT_IDS.spend];
      const customers = latestPool.sharedInputs[FUNNEL_INPUT_IDS.customers];
      if (
        spend !== null &&
        priorSpend !== undefined &&
        priorSpend > 0 &&
        priorLeads !== undefined &&
        priorLeads > 0
      ) {
        const spendChange = pctChange(spend, priorSpend)!;
        const leadChange = pctChange(leads, priorLeads)!;
        if (spendChange > 0.1 && leadChange < 0.02) {
          lines.push({
            text: `Watch: marketing spend rose ${fmtPct(spendChange)} while lead volume was ${leadChange < -0.02 ? 'down ' + fmtPct(leadChange) : 'flat'}.`,
            tone: 'watch',
          });
        } else {
          const cpl = spend / leads;
          const priorCpl = priorSpend / priorLeads;
          lines.push({
            text: `The marketing funnel generated ${leads.toLocaleString()} leads${customers !== undefined ? ` and ${customers.toLocaleString()} new customers` : ''} at ${formatCurrency(cpl)} per lead (${cpl <= priorCpl ? 'improved from' : 'up from'} ${formatCurrency(priorCpl)}).`,
            tone: cpl <= priorCpl ? 'positive' : 'watch',
          });
        }
      } else {
        lines.push({
          text: `The marketing funnel generated ${leads.toLocaleString()} leads${customers !== undefined ? ` and ${customers.toLocaleString()} new customers` : ''} in ${monthName(latest.period)}.`,
          tone: 'neutral',
        });
      }
    }
  }

  // ── 7. Expense watch item (only if room remains) ────────────────────────
  if (prior && lines.length < 7) {
    const mover = biggestMover(ws.accounts, ws.values, 'expense', latest.period, prior.period);
    if (mover && mover.prev > 0 && mover.delta > 0) {
      const change = mover.delta / mover.prev;
      // Only worth a sentence when it moved meaningfully AND is material.
      if (change >= 0.15 && mover.delta >= latest.operatingExpenses * 0.05) {
        lines.push({
          text: `Watch: ${mover.account.name} rose ${fmtPct(change)} month over month (${formatCurrency(mover.prev)} → ${formatCurrency(mover.prev + mover.delta)}).`,
          tone: 'watch',
        });
      }
    }
  }

  return lines.slice(0, 7);
}

// Local import-cycle-free formatter for target sentences.
function formatMetric(value: number, format: string): string {
  if (format === 'percent') return formatPercent(value);
  if (format === 'currency') return formatCurrency(value);
  if (format === 'ratio') return value.toFixed(2);
  return value.toFixed(2);
}
