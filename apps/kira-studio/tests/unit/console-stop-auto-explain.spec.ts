// P12 round 1 finding #5: Stop was a no-op while auto-explain's pre-run EXPLAIN batch was in
// flight — rt.opId held the *real* run's future id, which the backend had never registered, so
// stopOp's control.opsCancel(rt.opId) call landed on nothing. The EXPLAIN batch then always ran to
// completion and the real (possibly expensive) query fired regardless of the Stop press. This
// drives run()/stop() end to end (same style as console-result-cap.spec.ts) to prove: pressing
// Stop while the EXPLAIN batch is in flight cancels *that* op, and the real query is never issued
// at all — the one ordering guarantee no non-Docker Playwright test can force deterministically.
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { ConnectionSummary } from '@shared/domain/connection';
import type { ExecuteResponse } from '@shared/protocol/data-ops';

const { control } = await import('../../frontend/src/bridge/control');
const { data } = await import('../../frontend/src/bridge/data');
const { connectionsState } = await import('../../frontend/src/state/connections');
const { openConsoleTab } = await import('../../frontend/src/state/tabs');
const { run, stop, runtime } = await import('../../frontend/src/views/console/state');

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('console Stop during the auto-explain pre-run batch (P12 round 1 F5)', () => {
  test('cancels the EXPLAIN batch and never issues the real run', async () => {
    const connectionId = 'conn-stop-auto-explain';
    connectionsState.records.push({
      id: connectionId,
      // biome-ignore lint/suspicious/noExplicitAny: a minimal fixture, not a real ConnectionSummary
      ...({ kind: 'postgres', autoExplain: true, name: 'x', color: 'blue' } as any),
    } as ConnectionSummary);
    const tabId = openConsoleTab(connectionId, 'db');

    const explainCall = deferred<ExecuteResponse>();
    const executeCalls: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: a minimal stub, not the real data.execute
    (data as any).execute = (req: { opId: string; statements: string[] }) => {
      executeCalls.push(req.opId);
      // Only the EXPLAIN batch's own call should ever happen in this test.
      return explainCall.promise;
    };
    const cancelledOpIds: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: a minimal stub, not the real control.opsCancel
    (control as any).opsCancel = (opId: string) => {
      cancelledOpIds.push(opId);
      return Promise.resolve(true);
    };

    const running = run(tabId, ['SELECT 1']);
    // Let run() reach the point where the EXPLAIN batch's own op id is registered.
    await sleep(10);
    expect(runtime[tabId]?.explainOpId).not.toBeNull();
    const explainOpId = runtime[tabId]?.explainOpId as string;

    const runOpId = runtime[tabId]?.opId as string;
    stop(tabId);
    // Both the EXPLAIN batch's own op id and the real run's (not-yet-issued, unregistered on the
    // backend) opId are cancelled, best-effort — the explain one is what actually stops anything.
    expect(cancelledOpIds).toEqual([explainOpId, runOpId]);

    // Simulates the backend's cancellation response reaching the EXPLAIN batch's own execute call.
    explainCall.reject(Object.assign(new Error('cancelled'), { code: 'E_CANCELLED' }));
    await running;

    expect(executeCalls).toEqual([explainOpId]); // the real run's own execute() never fired
    expect(runtime[tabId]?.status).toBe('cancelled');
    expect(runtime[tabId]?.opId).toBeNull();
    expect(runtime[tabId]?.explainOpId).toBeNull();
  });
});
