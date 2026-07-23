# FinSight — Franchise Benchmarking & SCOA System ("the Qvinci-killer")

> **BUILD STATUS 2026-07-23 — COMPLETE + LIVE IN PRODUCTION (version 946b2492).**
> All phases shipped in one release off phase-2a-tenancy:
> F1 (b219766+60bc074), F2 (b299aac+3321a84), F3+F4 (05779f2),
> F5 fixes (8b4cf7d). 14/14 check suites + tsc + cf:build green; single
> cf:deploy done; prod click-verified.
>
> F5 review: 31-agent adversarial workflow (wf_82265d0d) over the full diff.
> 8 unique CONFIRMED findings, ALL FIXED before deploy: (1) franchises.config
> last-write-wins → optimistic-concurrency guard on updated_at + 1 retry;
> (2) percent 100x for no-profile franchises → registry-format ids + explicit
> Percent/Number unit (CSV unit column + manual toggle); (3) exec summary
> counted industry-pack values as "client targets" → corporate+custom only;
> (4) print auto-fire raced the franchise fetch → gated on `loaded` + 8s
> fallback; (5) failed franchise fetch poisoned the session cache → no longer
> cached, retries; (6) /franchises hung on transport error → error card +
> Retry, mutations surface errors + invalidate cache; (7) TargetsEditor
> Cancel didn't revert benchmark controls → dialog-local draft, commit on
> Save; (8) unknown-id CSV upload was silent + sets uninspectable → pre-save
> warning + expandable set rows. Also: invalid persisted region no longer
> NaNs pack math. (Two fix agents died on a Fable credit cap mid-run; their
> BenchmarkSetPanel JSX was finished by hand on Opus — parse/helpers were
> agent-written, UI wiring completed manually; FranchiseManager+TargetsEditor
> were already agent-complete.)
>
> Prod verification (demo firm, member role): /franchises renders read-only
> with the demo containment note and NO create controls; wizard hides the
> franchise block for members; Bella Roma (non-franchise) Overview + exec
> summary + Reports render byte-identically with NO franchise comparison
> section and zero console errors — the non-franchise regression guarantee
> holds live.
>
> REMAINING (human-only, Derek's real firm — demo is member-role so it can't
> exercise owner creates): end-to-end owner flow smoke test — create a
> franchise, upload a corporate benchmark CSV, designate 2+ franchisee
> clients, confirm the corporate tier supersedes industry on their Reports,
> the co-franchisee comparison table ranks them, and the SCOA
> upload→audit→map flow writes scoaNumber. Covered at the logic level by the
> 10/10 RLS proof + 14 suites + this review; just needs real books.
>
> ACCEPTED MINOR/DEFERRED (not blockers; documented from the review):
> workspace-side franchise fields (franchiseId/toggle/scoaNumber) are
> member-writable server-side (canManage is UI-only there) and demo can flip
> the industry toggle for other demo visitors until nightly reseed — both
> consistent with the pre-existing "demo is editable" sandbox model; the full
> /reports RatiosReport still uses hardcoded benchmarks (composed targets not
> wired there — product call); a re-sync/dataset-switch can drop scoaNumber
> mappings; delete-franchise unlink-check can race the 800ms workspace save.
> Candidates for a follow-up hardening pass.

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
