// P108 Part 12 F7: hydrateOps used to subscribe to onOpUpdate only AFTER opsRecent's own snapshot
// await resolved — an op that both started and finished in that gap left a permanently 'running'
// row in the snapshot, since the old subscribe never saw its update at all.
//
// P132 Part 1 (§0.7/§4.2): moved from apps/kira-studio/tests/unit/ops-hydrate-race.spec.ts onto
// createOpLogStore directly — a fake OpLogControl replaces the window/bridge stub, and each test
// gets its own Pinia instance instead of one shared module-level store.
import { describe, expect, test } from 'bun:test';
import type { OpLogRecord } from '@shared/domain/ops';
import { createPinia, setActivePinia } from 'pinia';
import { deferred } from '../testing/unit/async';
import { createOpLogStore, type OpLogControl } from './createOpLogStore';

function record(partial: Partial<OpLogRecord> & Pick<OpLogRecord, 'id' | 'status'>): OpLogRecord {
  return {
    startedAt: new Date().toISOString(),
    durationMs: null,
    kind: 'read',
    command: null,
    error: null,
    ...partial,
  };
}

function useTestStore(control: OpLogControl<OpLogRecord>) {
  setActivePinia(createPinia());
  return createOpLogStore<OpLogRecord>({ control })();
}

describe('createOpLogStore hydrateOps subscribe/snapshot race (F7)', () => {
  test('an op that starts and finishes between subscribe and snapshot is not stuck running', async () => {
    const snapshotGate = deferred<OpLogRecord[]>();
    let deliver: (r: OpLogRecord) => void = () => {};
    const opsStore = useTestStore({
      recent: () => snapshotGate.promise,
      onUpdate: (cb) => {
        deliver = cb;
        return () => {};
      },
      cancel: async () => {},
    });

    const hydrating = opsStore.hydrateOps();

    // The snapshot itself is still in flight (recent() not yet resolved) — this is the exact gap
    // the old code had no subscription open for yet. Deliver a start, then a finish, for an op the
    // snapshot below never saw at all (it started after the snapshot's own DB read).
    deliver(record({ id: 'op-race', status: 'running' }));
    deliver(record({ id: 'op-race', status: 'ok', durationMs: 5 }));

    // The snapshot resolves with no knowledge of op-race — a real op-log read that ran before it
    // started.
    snapshotGate.resolve([record({ id: 'seed', status: 'ok', durationMs: 1 })]);
    await hydrating;

    const stored = opsStore.records.find((r) => r.id === 'op-race');
    expect(stored?.status).toBe('ok');
    expect(stored?.durationMs).toBe(5);
    expect(opsStore.runningCount).toBe(0);
  });

  test('a snapshot row finished in the same gap replaces the stale running row from the snapshot', async () => {
    const snapshotGate = deferred<OpLogRecord[]>();
    let deliver: (r: OpLogRecord) => void = () => {};
    const opsStore = useTestStore({
      recent: () => snapshotGate.promise,
      onUpdate: (cb) => {
        deliver = cb;
        return () => {};
      },
      cancel: async () => {},
    });

    const hydrating = opsStore.hydrateOps();

    // op-2 is 'running' in the snapshot the DB read is about to return (below) — but it finishes
    // for real before that snapshot promise settles here.
    deliver(record({ id: 'op-2', status: 'ok', durationMs: 9 }));
    snapshotGate.resolve([record({ id: 'op-2', status: 'running' })]);
    await hydrating;

    const stored = opsStore.records.find((r) => r.id === 'op-2');
    expect(stored?.status).toBe('ok');
    expect(opsStore.runningCount).toBe(0);
  });
});
