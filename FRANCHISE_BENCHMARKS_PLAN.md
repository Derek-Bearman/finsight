# FinSight — Franchise Benchmarking & SCOA System ("the Qvinci-killer")

> **BUILD STATUS 2026-07-23 (mid-build, autonomous session):**
> F0 ✅ (prod at 7da63d77 pre-build). F1 ✅ commits b219766+60bc074 (table
> RLS-proven 10/10, manager page, wizard designation, link control).
> F2 ✅ commits b299aac+3321a84 (composition+packs core, upload panel,
> TargetsEditor benchmarks section, wiring across all surfaces,
> benchmarks.check.ts; 13/13 suites green at commit time).
> F3+F4 IN FLIGHT: pure layers + actions DONE in working tree (peer-metrics,
> franchise-peer-actions, scoa-audit, saveScoaAction/clearScoaAction,
> Account.scoaNumber, franchise.check.ts passing); UI workflow
> wf_6b94bf50-dc1 running 3 agents (C1 FranchiseComparison + ReportsTab
> mount, C2 ScoaPanel + FranchiseManager, C3 ScoaMappingSection + mapping
> page). After it lands: tsc + all suites, commit F3+F4, then F5 per §2
> (adversarial review workflow → fixes → cf:build → ONE cf:deploy → prod
> click-verify → docs/memory). Known F5 review feeds: B1's notes (reports-tab
> MetricRow hardcoded benchmarks not wired — product call; exec-summary
> "client targets" copy with pack targets counted), B2's note (config
> read-modify-write last-write-wins), C-round reports pending.

**Created:** 2026-07-23 · **Requested by:** Derek (verbatim requirements below) ·
**Decisions locked:** curated built-in benchmark packs (no external data feed);
autonomous build, adversarial review per phase, ONE deploy at the end.

> Positioning: everything Qvinci does for franchise comparison, but readable and
> navigable. Built with Volpe Consulting in mind. Second-highest priority of the
> app: compare a franchisee not only to its own history or generic industry, but
> to corporate franchise expectations and to co-franchisees.

## 0. Derek's requirements (do not drop any of these)

1. **Corporate benchmark upload** — easily upload whatever corporate benchmarks
   are (file), compare to individual franchisee clients.
2. **Industry-benchmark fallback** — when no corporate benchmark applies to a
   franchisee, standard industry benchmarks are available as an OPT-IN TOGGLE
   (default off). Scoped as close to the client as possible: industry ×
   size × region. Updatable "with a button click".
3. **Disclaimer UX** — asterisk and/or on-hover info box on industry benchmarks:
   general data scoped to the client's industry — NOT necessarily what this
   client's goals ought to be.
4. **Precedence** — an uploaded corporate benchmark automatically supersedes
   industry benchmarks. (Per-client custom targets, which already exist, stay
   ABOVE corporate — an accountant's explicit per-client override wins; the
   provenance label always says which tier is showing.)
5. **Franchise entity** (Derek's preferred model of the two he floated): each
   client workspace can be designated a franchisee → select an existing
   franchise or create a new one. The franchise carries franchise-wide data:
   benchmark sets, SCOA, etc. (The alternative — a bare dropdown of uploaded
   benchmark files — is subsumed by this; the franchise IS the dropdown.)
6. **Co-franchisee comparison** — compare a franchisee to the other franchisees
   in the same franchise (rankings, medians), Qvinci-style but legible.
7. **SCOA tooling** — upload a corporate SCOA per franchise; audit a
   franchisee's COA against it (missing accounts, extras, number/name
   discrepancies); MAP franchisee COA → corporate SCOA for consistency in
   analysis, benchmarking, forecasting.

## 1. Architecture

### Data model (additive only — house rule)
- **New table `public.franchises`** (migration mirrors workspaces' RLS pattern):
  `id uuid PK, firm_id → firms ON DELETE CASCADE, name text NOT NULL,
  industry_profile_id text, config jsonb NOT NULL DEFAULT '{}', created_by uuid,
  created_at/updated_at (+set_updated_at trigger), UNIQUE(firm_id, name)`.
  RLS: SELECT for firm members via `auth_firm_ids()`; INSERT/UPDATE/DELETE for
  owner/admin via `auth_has_firm_role()`; BEFORE UPDATE trigger pins
  firm_id + created_by (house pattern). DEMO_FIRM_ID blocked from franchise
  creation in server actions. **SQL impersonation proofs BEFORE any UI** (cross-
  firm SELECT=0, member write=denied, admin write=ok, pin trigger blocks moves).
- **`franchises.config` jsonb**:
  - `benchmarkSets: [{ id, label, effectiiveDate, uploadedAt, uploadedBy,
    active: boolean, metrics: [{ metricId, target, direction, notes? }] }]`
    (multiple sets kept; exactly one active; history preserved)
  - `scoa: { uploadedAt, uploadedBy, accounts: [{ number, name, type?,
    statementType?, parentNumber? }] }`
- **Workspace linkage — jsonb only, no migration**: `workspace.data.franchiseId`
  (+ cached `franchiseName`), `industryBenchmarksEnabled: boolean` (default
  false), `benchmarkRegion?: string` (US region select, default national),
  `benchmarkPackVersion` snapshot.
- **`Account.scoaNumber?: string`** — SCOA mapping stored per account (same
  additive pattern as `externalId`; CSV/QBO imports leave it undefined).

### Benchmark resolution (extends `src/lib/targets/`, keeps its provenance API)
Per-metric precedence:
1. per-client custom target (existing) — provenance "Custom target"
2. franchise active benchmark set — "Corporate benchmark — <Franchise>"
3. industry pack value, ONLY if workspace toggle on — "Industry benchmark*"
   (asterisk + hover disclaimer; footnote on Print)
4. FinSight profile default (existing) — "FinSight default benchmark"
Industry pack scoping: nearest of profile×size×region → profile×size →
profile×national. Size band derived from trailing-12 revenue. Region from the
workspace field.

### Curated packs (`src/lib/benchmarks/packs/`)
Data-only versioned modules (house profile-system style): per industry profile,
values per size band and region multiplier where defensible, `PACK_VERSION` +
`PACK_UPDATED` + source notes in each file. "Refresh benchmarks" button
re-resolves the workspace against the currently shipped pack and stamps
`benchmarkPackVersion` (UI shows "pack v3 · Jun 2026"). Numbers are illustrative
general aggregates — the disclaimer copy makes this explicit; never presented
as authoritative.

### Corporate benchmark upload
Downloadable CSV/XLSX template (metric id, label, target, direction) + parse via
the existing import-pipeline infra + a manual editor fallback (TargetsEditor
patterns). Upload lives on the FRANCHISE (firm-level), not the workspace.

### Co-franchisee comparison
Server action (read-only): given a franchise-linked workspace → fetch sibling
workspaces (same firm + franchiseId; RLS makes this safe), compute the existing
ratio/metric registry per sibling (reuse calc libs; respects isExcluded), return
NAMED results (same-firm data — Bob sees all his clients anyway).
UI: "Franchise" comparison surface on the workspace (rank table metric ×
franchisee w/ this-client highlight, median + quartile rows; median available as
a provenance tier "Peer median (n=N)"). Read-only — no version-guard concerns.
Account-LEVEL rollups align via scoaNumber when mapped; metric-level comparison
works without SCOA mapping.

### SCOA audit + mapping
- COA Audit view (franchise-linked workspaces): three buckets — SCOA accounts
  with no client match (missing), client accounts absent from SCOA (extra),
  matched-with-discrepancy (number match/name drift and vice versa). Reuse the
  import matcher's structural guards (statement-side guard, no name-matching of
  summary rows).
- Mapping mode: extend the existing Mapping tab with a "Corporate SCOA" section
  when linked — auto-map pass (number exact → guarded name), then manual
  assignment with the existing bulk-select UX. Writes `Account.scoaNumber`.

## 2. Phases (autonomous; adversarial workflow review per phase; deploy ONCE at end)

- **F0 — gate:** wait for the two in-flight sessions (wizard discoverability:
  committed 5d01ae5, session finishing; QBO polish: idle @05:25 with UNCOMMITTED
  changes in the main checkout — must land or be resolved first). Then full
  check suites + tsc → deploy pending work → clean tree.
- **F1 — franchise entity:** migration + RLS proofs; franchise service/actions;
  designation UI (new-client wizard step + workspace settings); firm-level
  Franchises manager (list/create/rename; shows linked franchisee count).
- **F2 — benchmarks:** upload template/parser/editor + versioned sets on the
  franchise; resolution precedence + provenance labels + disclaimer tooltip +
  asterisk; packs + region field + size derivation + toggle + refresh button.
- **F3 — co-franchisee comparison:** sibling metrics action + rank/median UI +
  peer-median provenance tier.
- **F4 — SCOA:** upload + audit view + mapping mode + scoaNumber-aligned
  rollups in the comparison surface.
- **F5 — review + ship:** cross-feature adversarial workflow (targets ↔
  franchise benchmarks ↔ datasets/QBO sync ↔ exec summary ↔ print; demo-firm
  containment; RLS re-proof; empty states), fix CONFIRMED, regression checks,
  `npm run cf:build` green, ONE `cf:deploy`, prod click-verify as Derek's real
  firm + demo untouched, update SESSION_NOTES/memory/this doc.

## 3. Guardrails (house rules — bind on every phase)
- DB strictly additive; impersonation-test RLS before UI; service-role writes
  only where the pattern already demands it.
- Demo firm: no franchise UI leakage (member role hides manage surfaces; server
  actions block DEMO_FIRM_ID creates).
- `'use server'` modules export ONLY async fns (Next 16 gotcha, cost us a day).
- Dev flags in `.env.development.local` ONLY. No wrangler secret changes.
- Respect the workspace jsonb version guard; peer comparison is read-only.
- Exec summary/targets/print must keep working for NON-franchise workspaces
  byte-identically (regression checks).
- Read `node_modules/next/dist/docs/` before new route/middleware code.
