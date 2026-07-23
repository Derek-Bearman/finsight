/**
 * Tutorial content invariants, runnable headless:
 *   npx tsx scripts/checks/tutorial-content.check.ts
 *
 * Pins the page tours + FAQ + main tours so the in-app help can't silently rot:
 *  - every page-tour id has a real tour (center welcome + center closing, >= 3 steps)
 *  - every surface (home + each page-tour id) has FAQ entries
 *  - Derek's house style: NO em dashes in any user-facing tour/FAQ copy
 *  - every [data-tour="..."] a page tour points at actually EXISTS in the source
 *    (catches invented anchors — the thing that would make a step silently skip)
 *  - every [data-testid="..."] target resolves to a literal OR a known dynamic
 *    testid template in the source
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_TOURS } from '../../src/components/tutorial/content/pageTours';
import { PAGE_FAQ } from '../../src/components/tutorial/content/faq';
import { PAGE_TOUR_IDS } from '../../src/components/tutorial/keys';
import { HOME_TOUR_STEPS, WORKSPACE_TOUR_STEPS } from '../../src/components/tutorial/TourSteps';
import type { TourStep } from '../../src/components/tutorial/TourSteps';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

const EM_DASH = '—';
const VALID_POSITIONS = new Set(['above', 'below', 'left', 'right', 'center']);

// ── Load the source tree once (for anchor-existence checks) ─────────────────
const SRC = join(__dirname, '..', '..', 'src');
function walk(dir: string, acc: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) acc.push(p);
  }
  return acc;
}
const SOURCE_BLOB = walk(SRC, [])
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

// Testids that are built from a template literal, e.g. data-testid={`source-filter-${f}`}.
// A tour target `[data-testid="source-filter-needs_review"]` is valid if the template
// prefix appears in the source (the exact suffix is produced at runtime).
const DYNAMIC_TESTID_PREFIXES = [
  'source-filter-',
  'mixed-split-slider-',
  'whatif-live-metric-',
];

/** Is a tour target selector backed by a real element in the source? */
function targetExists(selector: string): boolean {
  // [data-tour="X"] — always a static literal attribute we author.
  const tour = selector.match(/^\[data-tour="([^"]+)"\]$/);
  if (tour) return SOURCE_BLOB.includes(`data-tour="${tour[1]}"`);

  // [data-testid="X"] or [data-testid^="X"] (prefix match).
  const testid = selector.match(/^\[data-testid\^?="([^"]+)"\]$/);
  if (testid) {
    const value = testid[1]!;
    if (SOURCE_BLOB.includes(`data-testid="${value}"`)) return true; // static
    // dynamic: prove the generating prefix exists in a template literal
    return DYNAMIC_TESTID_PREFIXES.some(
      (pre) => value.startsWith(pre) && SOURCE_BLOB.includes(pre)
    );
  }
  return false;
}

function hasEmDash(s: string): boolean {
  return s.includes(EM_DASH);
}

// ── Page tours ──────────────────────────────────────────────────────────────
for (const id of PAGE_TOUR_IDS) {
  const steps = PAGE_TOURS[id];
  check(Array.isArray(steps) && steps.length >= 3, `[${id}] has >= 3 tour steps`);
  if (!Array.isArray(steps) || steps.length === 0) continue;

  const first = steps[0]!;
  const last = steps[steps.length - 1]!;
  check(
    first.position === 'center' && !first.target,
    `[${id}] first step is a center welcome with no target`
  );
  check(
    last.position === 'center' && !last.target,
    `[${id}] last step is a center closing with no target`
  );

  const seenIds = new Set<string>();
  for (const step of steps as TourStep[]) {
    check(!!step.id && !seenIds.has(step.id), `[${id}] step id "${step.id}" is present and unique`);
    seenIds.add(step.id);
    check(!!step.title && step.title.length <= 48, `[${id}/${step.id}] title present and <= 48 chars`);
    check(!!step.body && step.body.length > 0, `[${id}/${step.id}] body present`);
    check(VALID_POSITIONS.has(step.position ?? 'center'), `[${id}/${step.id}] valid position`);
    check(!hasEmDash(step.title), `[${id}/${step.id}] title has no em dash`);
    check(!hasEmDash(step.body), `[${id}/${step.id}] body has no em dash`);
    if (step.target) {
      check(targetExists(step.target), `[${id}/${step.id}] target ${step.target} exists in source`);
    }
  }
}

// ── Main tours (home + workspace) also follow the no-em-dash house rule ──────
for (const [label, steps] of [
  ['HOME_TOUR', HOME_TOUR_STEPS],
  ['WORKSPACE_TOUR', WORKSPACE_TOUR_STEPS],
] as const) {
  for (const step of steps) {
    check(!hasEmDash(step.title), `[${label}/${step.id}] title has no em dash`);
    check(!hasEmDash(step.body), `[${label}/${step.id}] body has no em dash`);
    if (step.target) {
      check(targetExists(step.target), `[${label}/${step.id}] target ${step.target} exists in source`);
    }
  }
}

// ── FAQ coverage ──────────────────────────────────────────────────────────────
const FAQ_KEYS = ['home', ...PAGE_TOUR_IDS];
for (const key of FAQ_KEYS) {
  const entries = PAGE_FAQ[key];
  check(Array.isArray(entries) && entries.length >= 3, `[faq/${key}] has >= 3 entries`);
  if (!Array.isArray(entries)) continue;
  for (const [i, e] of entries.entries()) {
    check(!!e.q && e.q.trim().endsWith('?'), `[faq/${key}#${i}] question present and ends with "?"`);
    check(!!e.a && e.a.length > 0, `[faq/${key}#${i}] answer present`);
    check(!hasEmDash(e.q) && !hasEmDash(e.a), `[faq/${key}#${i}] no em dash`);
  }
}

// No stray FAQ keys beyond the known surfaces.
for (const key of Object.keys(PAGE_FAQ)) {
  check(FAQ_KEYS.includes(key), `[faq] key "${key}" is a known surface`);
}

if (failures > 0) {
  console.error(`\n${failures} tutorial-content check(s) FAILED`);
  process.exit(1);
}
console.log('All tutorial-content checks passed.');
