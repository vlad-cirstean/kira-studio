// P12 round 2 finding #5: even with finding #4's identity-guarded explainOpId clear, nothing
// recorded that Stop was pressed if the in-flight EXPLAIN `data.execute` call happened to resolve
// normally before the cancel signal reached it (rather than rejecting with E_CANCELLED) — rt.status
// was still 'running', rt.opId was still this run's, so run()'s post-await guard passed and the
// real (possibly expensive) query fired anyway despite the Stop press. This drives run()/stop() end
// to end (same style as console-stop-auto-explain.spec.ts) with exactly that ordering: Stop is
// pressed while the EXPLAIN batch is in flight, and *then* the batch resolves successfully instead
// of rejecting — the real query must still never be issued.
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { ConnectionSummary } from '@shared/domain/connection';
import type { ExecuteResponse } from '@shared/protocol/data-ops';
import { createTabularPageBuilder, type Page, unpagedPosition } from '@shared/protocol/page';

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

function explainPage(): Page {
  const builder = createTabularPageBuilder([
    {
      name: 'QUERY PLAN',
      dataType: 'json',
      typeClass: 'text',
      nullable: false,
      isPrimaryKey: false,
      generated: false,
    },
  ]);
  builder.appendRow([JSON.stringify([{ Plan: { 'Node Type': 'Seq Scan', 'Plan Rows': 1 } }])]);
  return builder.finish(unpagedPosition(1));
}

describe('console Stop wins even when the in-flight EXPLAIN batch resolves anyway (P12 round 2 F5)', () => {
  test('the real query is never issued once Stop has been pressed', async () => {
    const connectionId = 'conn-stop-explain-resolves';
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
      return explainCall.promise;
    };

    const running = run(tabId, ['SELECT * FROM big']);
    await sleep(10);
    expect(runtime[tabId]?.explainOpId).not.toBeNull();

    stop(tabId);
    // Set synchronously, not left to the batch's own eventual rejection.
    expect(runtime[tabId]?.status).toBe('cancelled');

    // The batch resolves successfully instead of rejecting with E_CANCELLED — the race finding #5
    // describes: the cancel signal lost to the backend actually finishing the EXPLAIN in time.
    explainCall.resolve({ pages: [explainPage()] });
    await running;

    expect(executeCalls).toHaveLength(1); // the real run's own execute() must never have fired
    expect(runtime[tabId]?.status).toBe('cancelled');
    expect(runtime[tabId]?.autoExplain).toBeNull();
  });
});
