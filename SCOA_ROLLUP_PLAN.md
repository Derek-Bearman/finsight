# SCOA Roll-up + Corporate-Line Comparison — Plan

**Goal:** turn the SCOA feature from a 1-to-1 audit into a real many-to-one
roll-up so a franchisee's granular COA (3 checking accounts, 5 marketing
accounts, 2 buildings) folds into the franchisor's generic corporate lines
(Cash, Marketing Expense, Rent) for cross-franchisee comparison — with a
visual, smooth mapping UX. Complements (does not replace) the existing
ratio/metric benchmarking, which stays type-based.

## Problem (verified in code, 2026-07-23)

- `auditScoa` (`lib/franchise/scoa-audit.ts`) is strictly 1-to-1: each SCOA row
  claims at most one client account (`claimed` set), so surplus granular
  accounts land in "Extra".
- `Account.scoaNumber` is written by the mapping UI but read by **nothing else**
  — no calc/projection/comparison module aggregates by it (grep-confirmed: only
  types, scoa-audit, ScoaMappingSection, mapping page reference it).
- Co-franchisee comparison (`peer-metrics.ts`) compares 7 ratios + T12
  revenue/net-income, all aggregated by account **type**, never by SCOA. So
  comparison already works across COA granularities, but there is **no
  corporate-line comparison** (e.g. Rent as a corporate line across peers).

## Design decisions (locked)

- **Data model: unchanged.** `Account.scoaNumber?: string` already allows many
  accounts to share one corporate number (many-to-one). No migration.
- **Roll-up groups by `scoaNumber`.** Excluded accounts skipped. An "Unmapped"
  bucket holds accounts with no `scoaNumber`. Coverage = mapped / non-excluded.
- **% of revenue** is the comparison-friendly normalizer for P&L lines (dollars
  aren't comparable across franchisees of different sizes); balance-sheet lines
  compare on dollars. Revenue = sum of revenue-type accounts (matches computePnL).
- **Comparison stays server-side** (mirrors `getFranchisePeersAction`): peers'
  whole-workspace blobs never reach the browser. Only this franchisee's own
  underlying accounts are shown expandable (its blob is already local).
- **Auto-match stays conservative** (exact number, then guarded name); the
  many-to-one work is user-driven in the bucket mapper. No fuzzy keyword magic.
- **Mapping UX:** a two-column bucket mapper — unmapped client accounts (left)
  drag/click onto SCOA lines (right), each line showing its mapped accounts as
  removable chips (many per line). Reuses `@dnd-kit` (already a dep). Auto-match
  pre-fills; coverage bar; the missing/discrepancy summary is retained.

## Phasing

**Phase 1 — Engine + checks (pure logic, no UI).**
- `lib/franchise/scoa-rollup.ts`:
  - `rollupByScoa(scoa, accounts, values, periods)` → per SCOA line
    `{ number, name, statementType, accountIds[], accountNames[], total }`,
    plus `unmapped*`, `coveragePct`, `revenueTotal`.
  - `scoaLineSnapshot(ws, scoa, periods)` → `{ lineTotals: Record<number,
    {total, pctRevenue}>, revenue }` (one franchisee's comparable line values).
- `scripts/checks/scoa-rollup.check.ts` pins: 3 accounts → one line sums;
  unmapped bucket; coverage; % of revenue; excluded skipped; median.

**Phase 2 — Corporate-line comparison surface.**
- `lib/data/franchise-scoa-comparison-actions.ts` (`'use server'`): roll up this
  workspace + peers over T12, per SCOA line → `{ thisTotal, thisPct,
  peerMedianTotal, peerMedianPct, peerCount }`. Names + numbers only.
- `components/franchise/ScoaLineComparison.tsx`: table (SCOA line | This
  franchisee | Peer median | Δ | expand → this franchisee's underlying
  accounts), $ / %-of-revenue toggle. Rendered on the Reports tab (embedded +
  standalone), franchise-linked + SCOA-present only. New data-tour anchor.

**Phase 3 — Bucket mapper UX.**
- `components/mapping/ScoaBucketMapper.tsx`: dnd two-column many-to-one mapper.
  Reworks / supersedes `ScoaMappingSection` on the mapping surfaces (standalone
  `/mapping` today; also surface on the embedded Mapping tab for discoverability).
  `auditScoa` extended to many-to-one aware (SCOA line → set of accounts;
  `missing` = lines with zero; `unmapped` = accounts with no number). Keep
  testids stable where tests/tours depend on them; add new ones.

**Phase 4 — Verify + ship.**
- tsc + all checks + cf:build green; adversarial review; one cf:deploy; prod
  click-verify on the franchise practice firm surfaces; update SESSION_NOTES +
  the plan doc + memory.

## Non-goals (v1)

- No fuzzy/AI auto-bucketing (exact-number + guarded-name only).
- No editing the corporate SCOA from the mapping UI (that stays on /franchises).
- Roll-up does not change projections/what-if (those remain per-account).
