HANDYPRO HOME SERVICES — franchise upload-practice pack
=======================================================
These are STANDALONE files. Nothing is seeded into FinSight. Upload them
yourself to practice the full setup, in this order:

1. Franchises page (top nav) -> create a franchise, e.g. "HandyPro Home Services".
   Set its industry profile to "Trades Contractor".
2. On that franchise: Benchmarks -> Add benchmark set -> Upload CSV ->
   corporate-benchmark.csv  (gross margin, net margin, current ratio,
   debt/equity, ROE). Make it active.
3. On that franchise: SCOA -> upload corporate-scoa.csv (31 accounts).
4. For each of the 5 franchisees, create a client workspace (New Workspace),
   profile "Trades Contractor", and designate it a franchisee of "HandyPro
   Home Services":
     - On the P&L Upload step, import franchisee-<id>-pnl.csv
     - On the Balance Sheet step, import franchisee-<id>-balancesheet.csv
   (Or create the workspace empty and use "Import data" on the Statements tab.)
5. Open any franchisee -> Reports tab -> Franchise comparison ranks all five
   against each other and the corporate benchmarks (green = meets target).
6. Open #203 or #204 -> Mapping tab -> Corporate SCOA mapping: #203 is missing
   the Maintenance Plan Revenue account, #204 renamed "Materials & Parts" to
   "Parts & Supplies" (number 5100 matches, name drifts) and has an extra
   "Warranty Reserve" account not in the SCOA. Use "Apply suggested mappings"
   then map the rest.

The statement CSVs carry QBO-style section headers (Income / Cost of Goods
Sold / Expenses / Assets / Liabilities / Equity) so FinSight classifies every
account automatically on import.

Franchisees (varied on purpose):
  HandyPro #201 (Metro): 32 accounts, FY2025 revenue ~$3,407,116 — Star: high margins, strong growth.
  HandyPro #202 (Lakeside): 32 accounts, FY2025 revenue ~$2,119,532 — Solid: meets most corporate targets.
  HandyPro #203 (Riverside): 31 accounts, FY2025 revenue ~$1,371,959 — Average; no maintenance-plan line (SCOA shows a missing account).
  HandyPro #204 (Hilltop): 33 accounts, FY2025 revenue ~$1,230,833 — Struggling + COA drift (renamed materials account, extra warranty-reserve liability).
  HandyPro #205 (Grove): 32 accounts, FY2025 revenue ~$2,054,140 — Turnaround: low base, strongest growth.
