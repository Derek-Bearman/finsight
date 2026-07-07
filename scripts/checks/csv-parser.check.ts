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

import { parseCSV } from '../../src/lib/parsers/csv-parser';

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

if (failures > 0) {
  console.error(`\n${failures} csv-parser check(s) FAILED`);
  process.exit(1);
}
console.log('All csv-parser checks passed.');
