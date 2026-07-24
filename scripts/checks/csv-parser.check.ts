/**
 * CSV parser regressions, runnable headless:
 *   npx tsx scripts/checks/csv-parser.check.ts
 *
 * Guards the header→index resolution (audit fix: blank/duplicate header cells
 * collided in headerToIndex with last-wins semantics; on the standard QBO
 * header shape — blank first cell + trailing blank cells — the account-name
 * column resolved to a trailing empty column and EVERY data row was silently
 * dropped).
 */

import { parseCSV, parseAmount, parsePeriodHeader } from '../../src/lib/parsers/csv-parser';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

// 1. QBO multi-month shape: blank account-name header + trailing blank header
//    cells. Must parse the data rows, not drop them.
{
  const csv = [
    'Arktos Inc',
    'Profit and Loss',
    'January - March 2024',
    ',Jan 2024,Feb 2024,Mar 2024,Total,,',
    'Income,,,,,,',
    'Sales,100.00,200.00,300.00,600.00,,',
    'Total Income,100.00,200.00,300.00,600.00,,',
  ].join('\n');
  const result = parseCSV(csv, 'pnl');
  check(result.rows.length === 1, `QBO blank-header fixture: expected 1 row, got ${result.rows.length}`);
  const row = result.rows[0];
  check(row?.accountName === 'Sales', `QBO blank-header fixture: name '${row?.accountName}' != 'Sales'`);
  check(row?.values['2024-01'] === 100, `Jan value ${row?.values['2024-01']} != 100`);
  check(row?.values['2024-02'] === 200, `Feb value ${row?.values['2024-02']} != 200`);
  check(row?.values['2024-03'] === 300, `Mar value ${row?.values['2024-03']} != 300`);
}

// 2. Duplicate NAMED header: the first occurrence must win for the name column.
{
  const csv = ['Account,Jan 2024,Account', 'Sales,100.00,note'].join('\n');
  const result = parseCSV(csv, 'pnl');
  check(
    result.rows[0]?.accountName === 'Sales',
    `duplicate-header fixture: name '${result.rows[0]?.accountName}' != 'Sales'`
  );
}

// 3. Value extraction is positional — duplicate period headers must still
//    accumulate BOTH columns (guards against an over-eager "fix").
{
  const csv = [',Jan 2024,Feb 2024,Jan 2024,Feb 2024', 'Sales,1,2,3,4'].join('\n');
  const result = parseCSV(csv, 'pnl');
  const row = result.rows[0];
  check(row?.values['2024-01'] === 4, `dup-period fixture: Jan ${row?.values['2024-01']} != 4`);
  check(row?.values['2024-02'] === 6, `dup-period fixture: Feb ${row?.values['2024-02']} != 6`);
}

// 4. parseAmount: trailing-minus negatives (non-QBO exports) sign correctly.
check(parseAmount('1,234-') === -1234, `trailing-minus '1,234-' should be -1234, got ${parseAmount('1,234-')}`);
check(parseAmount('1234.56-') === -1234.56, `trailing-minus '1234.56-' should be -1234.56, got ${parseAmount('1234.56-')}`);
check(parseAmount('(500)') === -500, `parens negative still works, got ${parseAmount('(500)')}`);
check(parseAmount('-42') === -42, `leading-minus preserved, got ${parseAmount('-42')}`);
check(parseAmount('100.50') === 100.5, `positive unchanged, got ${parseAmount('100.50')}`);

// 5. Full month-name headers ("January 2024") and "Sept" parse to a period.
check(JSON.stringify(parsePeriodHeader('January 2024')) === JSON.stringify({ year: 2024, month: 1 }), 'parsePeriodHeader full "January 2024"');
check(JSON.stringify(parsePeriodHeader('September 2024')) === JSON.stringify({ year: 2024, month: 9 }), 'parsePeriodHeader full "September 2024"');
check(JSON.stringify(parsePeriodHeader('Sept 2024')) === JSON.stringify({ year: 2024, month: 9 }), 'parsePeriodHeader "Sept 2024"');
check(parsePeriodHeader('Marketing 2024') === null, 'non-month word must NOT parse as a period');
{
  const csv = ['Account,January 2024,February 2024', 'Revenue,1000,2000'].join('\n');
  const r = parseCSV(csv, 'pnl');
  check(r.columnMapping.periodColumns.length === 2, `full-month cols: expected 2, got ${r.columnMapping.periodColumns.length}`);
  check(r.rows[0]?.values['2024-01'] === 1000, `full-month value Jan should be 1000, got ${r.rows[0]?.values['2024-01']}`);
}

// 6. Monthly + quarter subtotal columns must NOT double-count (finest wins).
{
  const csv = ['Account,Jan 2024,Feb 2024,Mar 2024,Q1 2024', 'Rent,1000,1000,1000,3000'].join('\n');
  const r = parseCSV(csv, 'pnl');
  const row = r.rows[0];
  check(row?.values['2024-01'] === 1000, `mixed monthly+Q: Jan should be 1000 (not 2000), got ${row?.values['2024-01']}`);
  check(row?.values['2024-03'] === 1000, `mixed monthly+Q: Mar should be 1000 (not 2000), got ${row?.values['2024-03']}`);
}

// 7. Pure quarterly (no monthly) still spreads a P&L flow across the 3 months.
{
  const csv = ['Account,Q1 2024', 'Rent,3000'].join('\n');
  const r = parseCSV(csv, 'pnl');
  check(r.rows[0]?.values['2024-01'] === 1000, `pure Q1 P&L: Jan should be 1000, got ${r.rows[0]?.values['2024-01']}`);
}

// 8. Balance-sheet quarter column = ENDING balance (assigned to quarter-end
//    month), NOT divided across the 3 months.
{
  const csv = [',Q1 2024', 'ASSETS,', '  Cash,30000'].join('\n');
  const r = parseCSV(csv, 'balance_sheet');
  const cash = r.rows.find((x) => x.accountName === 'Cash');
  check(cash?.values['2024-03'] === 30000, `BS Q1 ending balance should be 30000 at Mar, got ${cash?.values['2024-03']}`);
  check(cash?.values['2024-01'] === undefined, `BS Q1 must NOT write Jan (no /3 spread), got ${cash?.values['2024-01']}`);
}

// 9. Balance sheet: the QBO Equity "Net Income" leaf is KEPT (not dropped as a
//    total) and the sheet balances. Also exercises deduplicateParentRows on a
//    balanced BS (an asset leaf must NOT be dropped just because deeper
//    liability/equity rows happen to sum to it).
{
  const csv = [
    ',Jan 2024',
    'ASSETS,',
    '  Checking,41500',
    'Total ASSETS,41500',
    'LIABILITIES AND EQUITY,',
    '  Liabilities,',
    '    SBA Loan,11500',
    '  Total Liabilities,11500',
    '  Equity,',
    "    Owner's Equity,20000",
    '    Retained Earnings,5000',
    '    Net Income,5000',
    '  Total Equity,30000',
    'Total LIABILITIES AND EQUITY,41500',
  ].join('\n');
  const r = parseCSV(csv, 'balance_sheet');
  const names = r.rows.map((x) => x.accountName);
  check(names.includes('Net Income'), `BS 'Net Income' equity leaf must be kept; rows: ${names.join(', ')}`);
  check(r.rows.find((x) => x.accountName === 'Net Income')?.values['2024-01'] === 5000, 'BS Net Income = 5000');
  check(names.includes('Checking'), `BS asset leaf 'Checking' must NOT be dropped; rows: ${names.join(', ')}`);
  check(!names.includes('Total Equity'), "'Total Equity' dropped as a total");
  // Balances: assets (Checking 41500) == liab (11500) + equity (20000+5000+5000=30000).
  const eqSum = ['Owner\'s Equity', 'Retained Earnings', 'Net Income']
    .reduce((s, n) => s + (r.rows.find((x) => x.accountName === n)?.values['2024-01'] ?? 0), 0);
  check(eqSum === 30000, `BS equity leaves sum to 30000, got ${eqSum}`);
}

// 10. deduplicateParentRows keeps a real leaf that precedes a deeper sibling.
//     "Undeposited Funds" (asset) before "Checking" (deeper, asset) must survive.
{
  const csv = [
    ',Jan 2024',
    'ASSETS,',
    '  Undeposited Funds,1500',
    '  Bank Accounts,',
    '    Checking,5000',
  ].join('\n');
  const r = parseCSV(csv, 'balance_sheet');
  const names = r.rows.map((x) => x.accountName);
  check(names.includes('Undeposited Funds'), `leaf 'Undeposited Funds' must be kept; rows: ${names.join(', ')}`);
  check(r.rows.find((x) => x.accountName === 'Undeposited Funds')?.values['2024-01'] === 1500, 'Undeposited Funds = 1500');
}

// 11. "Liabilities and Equity" spanning header resets the running section, so a
//     liability directly under it is NOT tagged with the previous asset section.
{
  const csv = [
    ',Jan 2024',
    'Assets,',
    '  Cash,5000',
    'Liabilities and Equity,',
    '  Accounts Payable,2000',
  ].join('\n');
  const r = parseCSV(csv, 'balance_sheet');
  const ap = r.rows.find((x) => x.accountName === 'Accounts Payable');
  check(ap?.section !== 'asset', `AP under 'Liabilities and Equity' must not inherit 'asset' section, got '${ap?.section}'`);
}

// 12. deduplicateParentRows: a NESTED rollup drops the true parent (via
//     leaf-descendant sum), keeps the leaves, and does NOT double-count.
{
  const csv = [
    ',Jan 2024',
    'Income,',
    '  Sales,1000',
    '    Product Lines,',
    '      Hardware,600',
    '      Software,400',
  ].join('\n');
  const r = parseCSV(csv, 'pnl');
  const names = r.rows.map((x) => x.accountName);
  check(!names.includes('Sales'), `nested rollup: 'Sales' (=600+400) should be dropped; rows: ${names.join(', ')}`);
  check(names.includes('Hardware') && names.includes('Software'), 'nested rollup: leaf accounts kept');
  const total = r.rows.reduce((s, x) => s + (x.values['2024-01'] ?? 0), 0);
  check(total === 1000, `nested rollup: total should be 1000 (no double-count), got ${total}`);
}

// 13. deduplicateParentRows: a WIDE-indent (4 spaces/level) rollup still drops
//     the parent (relative depth, not a hardcoded indentLevel+1).
{
  const csv = [
    ',Jan 2024',
    'Income,',
    '    Sales,1000',
    '        Hardware,600',
    '        Software,400',
  ].join('\n');
  const r = parseCSV(csv, 'pnl');
  const names = r.rows.map((x) => x.accountName);
  check(!names.includes('Sales'), `wide-indent rollup: 'Sales' should be dropped; rows: ${names.join(', ')}`);
  const total = r.rows.reduce((s, x) => s + (x.values['2024-01'] ?? 0), 0);
  check(total === 1000, `wide-indent rollup: total should be 1000 (no double-count), got ${total}`);
}

// 14. A P&L (auto-detect, no explicit type) whose accounts merely CONTAIN
//     'assets'/'equity' as a substring must NOT be mis-typed as a balance sheet
//     and must still SPREAD its quarter columns across the months.
{
  const csv = ['Account,Q1 2024,Q2 2024', 'Consulting Revenue,30000,30000', 'Gain on Sale of Assets,3000,0'].join('\n');
  const r = parseCSV(csv); // no statementType → auto-detect
  const rev = r.rows.find((x) => x.accountName === 'Consulting Revenue');
  check(
    rev?.values['2024-01'] === 10000 && rev?.values['2024-02'] === 10000 && rev?.values['2024-03'] === 10000,
    `P&L auto-detect with an 'assets' leaf must SPREAD quarter columns (10000/mo), got Jan=${rev?.values['2024-01']} Mar=${rev?.values['2024-03']}`
  );
}

// 15. A bare "December 2024" date SUBTITLE in the preamble must not be picked as
//     the header row (full-month-name support must not break header detection).
{
  const csv = [
    'Arktos Inc',
    'Profit and Loss',
    'December 2024',
    ',Dec 2024,Total,,',
    'Income,,,,',
    '  Sales,1000,1000,,',
    'Total Income,1000,1000,,',
  ].join('\n');
  const r = parseCSV(csv, 'pnl');
  const sales = r.rows.find((x) => x.accountName === 'Sales');
  check(sales?.values['2024-12'] === 1000, `bare-month subtitle: header scan must skip it; Sales Dec should be 1000, got ${sales?.values['2024-12']}`);
}

// 16. A BS subtotal that starts with "Net" but is NOT current-year earnings
//     (e.g. "Net Fixed Assets") is still dropped as a total; "Net Income" kept.
{
  const csv = [
    ',Jan 2024',
    'ASSETS,',
    '  Equipment,10000',
    '  Accumulated Depreciation,-2000',
    '  Net Fixed Assets,8000',
  ].join('\n');
  const r = parseCSV(csv, 'balance_sheet');
  const names = r.rows.map((x) => x.accountName);
  check(!names.includes('Net Fixed Assets'), `'Net Fixed Assets' subtotal must be dropped on a BS; rows: ${names.join(', ')}`);
}

if (failures > 0) {
  console.error(`\n${failures} csv-parser check(s) FAILED`);
  process.exit(1);
}
console.log('All csv-parser checks passed.');
