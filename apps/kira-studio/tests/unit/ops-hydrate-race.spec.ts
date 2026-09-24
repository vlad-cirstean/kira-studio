// P108 Part 12 F7: hydrateOps used to subscribe to onOpUpdate only AFTER opsRecent's own snapshot
// await resolved — an op that both started and finished in that gap left a permanently 'running'
// row in the snapshot, since the old subscribe never saw its update at all. state/ops.ts's own
// bridge/control.ts import reaches `window.kira` at module scope, hence the shared window stub,
// same as ops-markraw.spec.ts/run-state.spec.ts.
import '@workbench/testing/unit/window';

import { describe, expect, test } from 'bun:test';
import { deferred } from '@workbench/testing/unit/async';
import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import type { OpRecord } from '../../../../packages/shared/domain/ops';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
const { useOpsStore } = await import('../../frontend/src/state/ops');
restoreAfterEach(control);

const opsStore = useOpsStore();

function record(partial: Partial<OpRecord> & Pick<OpRecord, 'id' | 'tabId' | 'status'>): OpRecord {
  return {
    connectionId: null,
    startedAt: new Date().toISOString(),
    durationMs: null,
    kind: 'read',
    rows: null,
    command: null,
    error: null,
    ...partial,
  };
}

describe('state/ops.ts hydrateOps subscribe/snapshot race (F7)', () => {
  test('an op that starts and finishes between subscribe and snapshot is not stuck running', async () => {
    const snapshotGate = deferred<OpRecord[]>();
    let deliver: (r: OpRecord) => void = () => {};
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real control surface
    (control as any).opsRecent = () => snapshotGate.promise;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real control surface
    (control as any).onOpUpdate = (cb: (r: OpRecord) => void) => {
      deliver = cb;
      return () => {};
    };

    const hydrating = opsStore.hydrateOps();

    // The snapshot itself is still in flight (opsRecent not yet resolved) — this is the exact gap
    // the old code had no subscription open for yet. Deliver a start, then a finish, for an op the
    // snapshot below never saw at all (it started after the snapshot's own DB read).
    deliver(record({ id: 'op-race', tabId: 't1', status: 'running' }));
    deliver(record({ id: 'op-race', tabId: 't1', status: 'ok', durationMs: 5 }));

    // The snapshot resolves with no knowledge of op-race — a real op_log read that ran before it
    // started.
    snapshotGate.resolve([record({ id: 'seed', tabId: 't0', status: 'ok', durationMs: 1 })]);
    await hydrating;

    const stored = opsStore.records.find((r) => r.id === 'op-race');
    expect(stored?.status).toBe('ok');
    expect(stored?.durationMs).toBe(5);
    expect(opsStore.runningCount).toBe(0);
  });

  test('a snapshot row finished in the same gap replaces the stale running row from the snapshot', async () => {
    const snapshotGate = deferred<OpRecord[]>();
    let deliver: (r: OpRecord) => void = () => {};
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real control surface
    (control as any).opsRecent = () => snapshotGate.promise;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real control surface
    (control as any).onOpUpdate = (cb: (r: OpRecord) => void) => {
      deliver = cb;
      return () => {};
    };

    const hydrating = opsStore.hydrateOps();

    // op-2 is 'running' in the snapshot the DB read is about to return (below) — but it finishes
    // for real before that snapshot promise settles here.
    deliver(record({ id: 'op-2', tabId: 't2', status: 'ok', durationMs: 9 }));
    snapshotGate.resolve([record({ id: 'op-2', tabId: 't2', status: 'running' })]);
    await hydrating;

    const stored = opsStore.records.find((r) => r.id === 'op-2');
    expect(stored?.status).toBe('ok');
    expect(opsStore.runningCount).toBe(0);
  });
});
