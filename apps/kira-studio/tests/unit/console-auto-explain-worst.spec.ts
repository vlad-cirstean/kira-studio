// P12 round 2 finding #13: worstIndex used to be plans.findIndex(...) — the *first* flagged
// statement in a Run-all, not the worst one. On a multi-statement run where an early statement
// trips a mild warning and a later one is far more expensive, the strip's "Show plan" action
// pointed at the mild one. This drives run() end to end (same style as
// console-auto-explain-race.spec.ts) with two flagged postgres statements, the first far cheaper
// than the second, and asserts worstIndex lands on the expensive one.
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { ConnectionSummary } from '@shared/domain/connection';
import type { ExecuteResponse } from '@shared/protocol/data-ops';
import { createTabularPageBuilder, type Page, unpagedPosition } from '@shared/protocol/page';

const { data } = await import('../../frontend/src/bridge/data');
const { connectionsState } = await import('../../frontend/src/state/connections');
const { openConsoleTab } = await import('../../frontend/src/state/tabs');
const { run, runtime } = await import('../../frontend/src/views/console/state');

// Both clear the default 100,000-row threshold (packages/shared/domain/settings.ts) — flagged, but
// by a wide margin apart, so worstIndex has a real "which one is actually worse" to get right.
function scanPlanPage(rows: number): Page {
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
  builder.appendRow([
    JSON.stringify([
      { Plan: { 'Node Type': 'Seq Scan', 'Relation Name': 't', 'Plan Rows': rows } },
    ]),
  ]);
  return builder.finish(unpagedPosition(1));
}

function fakeResultPage(): Page {
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake page, real run() only reads kind/rowCount
  return { kind: 'tabular', rowCount: 0 } as any;
}

describe('auto-explain worstIndex points at the worst flagged plan, not the first (P12 round 2 F13)', () => {
  test('a cheap-but-flagged statement first, a far more expensive one second', async () => {
    const connectionId = 'conn-auto-explain-worst';
    connectionsState.records.push({
      id: connectionId,
      // biome-ignore lint/suspicious/noExplicitAny: a minimal fixture, not a real ConnectionSummary
      ...({ kind: 'postgres', autoExplain: true, name: 'x', color: 'blue' } as any),
    } as ConnectionSummary);
    const tabId = openConsoleTab(connectionId, 'db');

    // biome-ignore lint/suspicious/noExplicitAny: a minimal stub, not the real data.execute
    (data as any).execute = (): Promise<ExecuteResponse> =>
      Promise.resolve({
        pages: [
          scanPlanPage(150_000), // statement 0: flagged, mild
          scanPlanPage(9_000_000), // statement 1: flagged, far worse
          fakeResultPage(), // the real run's own result
        ],
      });

    await run(tabId, ['SELECT * FROM small_but_over', 'SELECT * FROM huge']);

    const state = runtime[tabId]?.autoExplain;
    expect(state?.kind).toBe('plans');
    if (state?.kind !== 'plans') throw new Error('expected a plans state');
    expect(state.plans).toHaveLength(2);
    expect(state.worstIndex).toBe(1);
    expect(state.plans[1]?.plan.estimatedRowsRead).toBe(9_000_000);
  });
});
