// P21 round 3 performance finding 13: onOpUpdate's own findIndex scan (up to 500 comparisons per
// op:start/op:end) used to compare plain OpRecord objects read out of opsState's deep-reactive
// array — each read wraps the record in its own nested reactive proxy (cached, but still a proxy
// trap on every subsequent `.id` read), the same cost round 2 already fixed for the gRPC message
// buffer via markRaw. This pins that hydrateOps/onOpUpdate now markRaw every incoming record: a
// markRaw'd object is never wrapped when read back out of a reactive container, so the exact same
// reference comes back out — the observable, testable consequence of the fix.
// state/ops.ts's own bridge/control.ts import reaches `window.kira` at module scope, hence the
// shared window stub, same as run-state.spec.ts.
import './support/window';

import { describe, expect, test } from 'bun:test';
import { isReactive } from 'vue';
import type { OpRecord } from '../../../../packages/shared/domain/ops';

const { control } = await import('../../frontend/src/bridge/control');
const { opsState, hydrateOps } = await import('../../frontend/src/state/ops');

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

describe('state/ops.ts markRaw (finding 13)', () => {
  test('a hydrated record is not wrapped in a reactive proxy when read back out of opsState', async () => {
    const seed = record({ id: 'seed-1', tabId: 't1', status: 'running' });
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real control surface
    (control as any).opsRecent = async () => [seed];
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real control surface
    (control as any).onOpUpdate = () => () => {};

    await hydrateOps();

    expect(isReactive(opsState.records[0])).toBe(false);
  });

  test('a record delivered via onOpUpdate (new op) is not wrapped either', async () => {
    let deliver: (r: OpRecord) => void = () => {};
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real control surface
    (control as any).opsRecent = async () => [];
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real control surface
    (control as any).onOpUpdate = (cb: (r: OpRecord) => void) => {
      deliver = cb;
      return () => {};
    };

    await hydrateOps();
    const incoming = record({ id: 'new-1', tabId: 't2', status: 'running' });
    deliver(incoming);

    const stored = opsState.records.find((r) => r.id === 'new-1');
    expect(stored).toBeDefined();
    expect(isReactive(stored)).toBe(false);
  });

  test('a record replacing an existing one (op:end) is also not wrapped', async () => {
    let deliver: (r: OpRecord) => void = () => {};
    const running = record({ id: 'op-1', tabId: 't3', status: 'running' });
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real control surface
    (control as any).opsRecent = async () => [running];
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real control surface
    (control as any).onOpUpdate = (cb: (r: OpRecord) => void) => {
      deliver = cb;
      return () => {};
    };

    await hydrateOps();
    const finished = record({ id: 'op-1', tabId: 't3', status: 'ok', durationMs: 12 });
    deliver(finished);

    const stored = opsState.records.find((r) => r.id === 'op-1');
    expect(stored?.status).toBe('ok');
    expect(isReactive(stored)).toBe(false);
  });
});
