// P21 round 3 performance finding 13: onOpUpdate's own findIndex scan (up to 500 comparisons per
// op:start/op:end) used to compare plain records read out of opsState's deep-reactive array — each
// read wraps the record in its own nested reactive proxy (cached, but still a proxy trap on every
// subsequent `.id` read), the same cost round 2 already fixed for the gRPC message buffer via
// markRaw. This pins that hydrateOps/onUpdate now markRaw every incoming record: a markRaw'd
// object is never wrapped when read back out of a reactive container, so the exact same reference
// comes back out — the observable, testable consequence of the fix.
//
// P132 Part 1 (§0.7/§4.2): moved from apps/kira-studio/tests/unit/ops-markraw.spec.ts onto
// createOpLogStore directly — a fake OpLogControl replaces the window/bridge stub, and each test
// gets its own Pinia instance instead of one shared module-level store.
import { describe, expect, test } from 'bun:test';
import type { OpLogRecord } from '@shared/domain/ops';
import { createPinia, setActivePinia } from 'pinia';
import { isReactive } from 'vue';
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

describe('createOpLogStore markRaw (finding 13)', () => {
  test('a hydrated record is not wrapped in a reactive proxy when read back out of state', async () => {
    const seed = record({ id: 'seed-1', status: 'running' });
    const opsStore = useTestStore({
      recent: async () => [seed],
      onUpdate: () => () => {},
      cancel: async () => {},
    });

    await opsStore.hydrateOps();

    expect(isReactive(opsStore.records[0])).toBe(false);
  });

  test('a record delivered via onUpdate (new op) is not wrapped either', async () => {
    let deliver: (r: OpLogRecord) => void = () => {};
    const opsStore = useTestStore({
      recent: async () => [],
      onUpdate: (cb) => {
        deliver = cb;
        return () => {};
      },
      cancel: async () => {},
    });

    await opsStore.hydrateOps();
    const incoming = record({ id: 'new-1', status: 'running' });
    deliver(incoming);

    const stored = opsStore.records.find((r) => r.id === 'new-1');
    expect(stored).toBeDefined();
    expect(isReactive(stored)).toBe(false);
  });

  test('a record replacing an existing one (op:end) is also not wrapped', async () => {
    let deliver: (r: OpLogRecord) => void = () => {};
    const running = record({ id: 'op-1', status: 'running' });
    const opsStore = useTestStore({
      recent: async () => [running],
      onUpdate: (cb) => {
        deliver = cb;
        return () => {};
      },
      cancel: async () => {},
    });

    await opsStore.hydrateOps();
    const finished = record({ id: 'op-1', status: 'ok', durationMs: 12 });
    deliver(finished);

    const stored = opsStore.records.find((r) => r.id === 'op-1');
    expect(stored?.status).toBe('ok');
    expect(isReactive(stored)).toBe(false);
  });
});
