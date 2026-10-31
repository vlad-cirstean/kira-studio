// Background records keep their own 300-row lane, so a burst of reads never evicts a foreground op;
// hidden until shown, and never counted as running.
import { describe, expect, test } from 'bun:test';
import type { OpLogRecord } from '@shared/domain/ops';
import { createPinia, setActivePinia } from 'pinia';
import { createOpLogStore } from './createOpLogStore';

type R = OpLogRecord & { background: boolean };

function rec(id: string, background: boolean, status: R['status'] = 'ok'): R {
  return {
    id,
    background,
    status,
    startedAt: '',
    durationMs: null,
    kind: 'k',
    command: null,
    error: null,
  };
}

function setup() {
  let update: (r: R) => void = () => {};
  let batch: (rs: R[]) => void = () => {};
  setActivePinia(createPinia());
  const store = createOpLogStore<R>({
    background: (r) => r.background,
    control: {
      recent: async () => [],
      onUpdate: (cb) => {
        update = cb;
        return () => {};
      },
      onBatch: (cb) => {
        batch = cb;
        return () => {};
      },
      cancel: async () => {},
    },
  })();
  store.showBackground = false;
  return { store, update: (r: R) => update(r), batch: (rs: R[]) => batch(rs) };
}

describe('op log lanes', () => {
  test('a background burst past 300 never evicts foreground rows', async () => {
    const { store, update, batch } = setup();
    await store.hydrateOps();
    update(rec('fg-1', false));
    batch(Array.from({ length: 350 }, (_, i) => rec(`bg-${i}`, true)));
    expect(store.records.filter((r) => r.background)).toHaveLength(300);
    expect(store.records.some((r) => r.id === 'fg-1')).toBe(true);
    expect(store.records.some((r) => r.id === 'bg-0')).toBe(false);
  });

  test('background rows are hidden until shown and never count as running', async () => {
    const { store, update, batch } = setup();
    await store.hydrateOps();
    update(rec('fg', false, 'running'));
    batch([rec('bg', true, 'running')]);
    expect(store.visibleOps.map((r) => r.id)).toEqual(['fg']);
    expect(store.runningCount).toBe(1);
    store.showBackground = true;
    expect(store.visibleOps.map((r) => r.id)).toEqual(['bg', 'fg']);
    expect(store.runningCount).toBe(1);
  });
});
