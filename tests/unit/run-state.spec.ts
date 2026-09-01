import { describe, expect, test } from 'bun:test';
import type { OpRecord } from '../../packages/shared/domain/ops';

// P43 iter3 D37: state/runState.ts is a plain computed() over state/ops.ts's reactive() store —
// no container, no Electron main process, nothing DOM-shaped read by either module. Vue's
// reactivity core (ref/computed/watchEffect) runs the same anywhere with no DOM. The one obstacle
// is bridge/control.ts:33's `const kira = window.kira;` at module scope (state/ops.ts's own
// import), which the shared stub below satisfies — state/ops.ts imports nothing else DOM-shaped.
// Both modules under test are imported dynamically, after the stub is installed: a static import
// is hoisted and would run before this file's own code has a chance to set `globalThis.window`.
import './support/window';

const { opsState } = await import('../../apps/kira-studio/frontend/src/state/ops');
const { useRunState } = await import('../../apps/kira-studio/frontend/src/state/runState');

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

describe('useRunState — the toolbar ring (P43 iter2 D19/F14, iter3 D37)', () => {
  test('1. a running op wins over a newer finished one on the same tab (F14 race)', () => {
    // opsState.records is newest-started-first — B is the newer record, A the older, but only A
    // is still running.
    opsState.records = [
      record({ id: 'B', tabId: 't1', status: 'ok', durationMs: 12 }),
      record({ id: 'A', tabId: 't1', status: 'running' }),
    ];
    const vm = useRunState(() => 't1');
    expect(vm.value.status).toBe('running');
  });

  test('2. with no running record, the newest finished one supplies the idle duration (LAW 12)', () => {
    opsState.records = [
      record({ id: 'B', tabId: 't1', status: 'ok', durationMs: 42 }),
      record({ id: 'A', tabId: 't1', status: 'ok', durationMs: 7 }),
    ];
    const vm = useRunState(() => 't1');
    expect(vm.value).toEqual({ status: 'idle', elapsedMs: 42 });
  });

  test('3. an error record reports error, not idle', () => {
    opsState.records = [record({ id: 'C', tabId: 't1', status: 'error', durationMs: 5 })];
    const vm = useRunState(() => 't1');
    expect(vm.value).toEqual({ status: 'error', elapsedMs: 5 });
  });

  test('4. a tab with no records at all reads idle', () => {
    opsState.records = [];
    const vm = useRunState(() => 't1');
    expect(vm.value).toEqual({ status: 'idle', elapsedMs: null });
  });

  test("5. another tab's running op does not light this tab's ring", () => {
    opsState.records = [
      record({ id: 'X', tabId: 'other', status: 'running' }),
      record({ id: 'A', tabId: 't1', status: 'ok', durationMs: 3 }),
    ];
    const vm = useRunState(() => 't1');
    expect(vm.value).toEqual({ status: 'idle', elapsedMs: 3 });
    // Leaves no record running anywhere, so the shared ticker's watchEffect stops its interval
    // rather than leaving a handle open past this file's own tests.
    opsState.records = [];
  });
});
