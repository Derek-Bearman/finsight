/**
 * Cloud-sync post-save watermark checks:
 *   npx tsx scripts/checks/cloud-sync.check.ts
 *
 * Regression for the 2026-07-22 merge-readiness finding (sync-stamp race):
 * onNextSuccessfulSave used to fire on the success of ANY workspace save —
 * including a debounced save whose payload was captured BEFORE the QBO commit
 * mutated the store. That stamped last_synced_at for a commit that rode the
 * NEXT save, which could still lose the optimistic-concurrency conflict.
 *
 * Registrations now carry an updatedAt watermark; a save only releases the
 * callbacks whose watermark its payload covers. This suite pins the pure
 * decision logic (saveCoversWatermark / partitionNextSaveEntries) that
 * fireNextSaveCallbacks routes through.
 */

import {
  partitionNextSaveEntries,
  saveCoversWatermark,
  type NextSaveEntry,
} from '../../src/lib/data/cloud-sync';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

const T1 = '2026-07-23T04:30:00.000Z'; // pre-commit snapshot (already on the wire)
const T2 = '2026-07-23T04:30:05.000Z'; // post-commit updatedAt (the watermark)
const T3 = '2026-07-23T04:30:09.000Z'; // user kept editing after the commit

// ── saveCoversWatermark matrix ───────────────────────────────────────────────
{
  check(saveCoversWatermark(T1, null), 'null watermark (workspace not in store) always releases');
  check(saveCoversWatermark(T2, T2), 'identical updatedAt releases');
  check(saveCoversWatermark(T3, T2), 'a fresher save releases an older watermark');
  check(!saveCoversWatermark(T1, T2), 'THE RACE: a pre-commit payload must NOT release a post-commit watermark');
  check(saveCoversWatermark('not-a-date', T2), 'unparseable saved side fails open (never strand the callback)');
  check(saveCoversWatermark(T2, 'not-a-date'), 'unparseable watermark side fails open');
}

// ── partitionNextSaveEntries ─────────────────────────────────────────────────
{
  const mk = (notBefore: string | null): NextSaveEntry => ({ cb: () => {}, notBefore });
  const preCommit = mk(T1);
  const atCommit = mk(T2);
  const postCommit = mk(T3);

  // The pre-commit save lands: only the entry that predates the commit fires.
  const first = partitionNextSaveEntries([preCommit, atCommit, postCommit], T1);
  check(
    first.ready.length === 1 && first.ready[0] === preCommit,
    `pre-commit save releases only the pre-commit entry, got ${first.ready.length} ready`
  );
  check(
    first.waiting.length === 2 && first.waiting[0] === atCommit && first.waiting[1] === postCommit,
    'entries registered after the payload was captured keep waiting, in order'
  );

  // The follow-up save (payload includes the commit) releases the rest.
  const second = partitionNextSaveEntries(first.waiting, T3);
  check(
    second.ready.length === 2 && second.waiting.length === 0,
    `the commit-carrying save releases the waiting entries, got ${second.ready.length} ready / ${second.waiting.length} waiting`
  );

  // Same-save registrations all release together, in registration order.
  const a = mk(T2);
  const b = mk(T2);
  const both = partitionNextSaveEntries([a, b], T2);
  check(
    both.ready.length === 2 && both.ready[0] === a && both.ready[1] === b,
    'multiple registrations on one save release in registration order'
  );
}

if (failures > 0) {
  console.error(`\n${failures} cloud-sync check(s) FAILED`);
  process.exit(1);
}
console.log('All cloud-sync checks passed.');
