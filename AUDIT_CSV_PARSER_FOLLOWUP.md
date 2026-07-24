# CSV Parser — deferred audit findings (2026-07-18)

> **RESOLVED 2026-07-24** (version `e98e3e82`, commit `8e3f6c2`). All three were
> fixed exactly along the "Suggested approach" below: statement type is resolved
> BEFORE the value loop (via BS section-header detection, not a substring, so a
> P&L with a "…Assets" leaf isn't mis-typed); #1 keeps the Net-Income equity
> family on a BS; #2 assigns the ending balance to the period-end month for BS
> stock columns (no /divisor); #3 drops a parent only when it equals the sum of
> its same-section LEAF descendants (relative depth). Fixtures added in
> `scripts/checks/csv-parser.check.ts` (16 groups). A self-verify pass caught +
> corrected an over-narrow first attempt at #3 before deploy. Kept for history.

Three real balance-sheet import bugs surfaced in the overnight audit. They were
**not fixed** because a correct fix needs statement-type awareness threaded into
row-building plus regression tests, and rushing a change to the live financial
parser risks introducing new data-corruption. They only affect users importing
their **own** QBO/Excel data (the seeded demo is unaffected).

All three live in `src/lib/parsers/csv-parser.ts`.

### 1. QBO "Net Income" equity line dropped on balance sheets
`classifyRowKind` (~line 360) matches `/^(total|subtotal|net|grand\s+total)\b/i`
with no statement-type awareness, so a Balance Sheet's **"Net Income"** equity
line (current-year earnings) is classified `total` and discarded at ~line 630.
Total equity is then understated by YTD earnings. On a P&L, "Net Income" *is* a
total and should stay dropped — so the fix must be statement-type-aware.

### 2. Quarterly / annual columns divide balance-sheet balances
`perMonth = divisor > 1 ? total / divisor : total` (~line 657) runs for every
row regardless of statement type: a `Q1 2024` column divides by 3, `FY2024` by
12. For a **balance sheet** (stocks, not flows) this reports Cash/AR/AP at 1/3
or 1/12 of reality. Ratios survive (num+denom scale together) but every dollar
figure is wrong. Only flow statements (P&L, cash flow) should be divided.

### 3. `deduplicateParentRows` drops a parent's own postings
(~line 401) drops any row whose next row is more indented, without checking
whether the parent carries its own direct value. A QBO parent account with both
direct postings **and** sub-accounts loses its direct amount, understating
revenue/expense. Only drop the parent when its value equals the sum of its
children (a true double-count), not whenever a child follows.

## Suggested approach
- Detect statement type **before** the value-building loop (headers/structure
  are enough) and pass it in, so #1 and #2 can branch on
  `balance_sheet` vs flow.
- For #3, compare parent value to the sum of immediate children before
  dropping.
- Add fixtures: a QBO Balance Sheet with a Net Income equity line and a `Q1`
  column; a P&L parent with direct postings + sub-accounts. Assert exact totals.
