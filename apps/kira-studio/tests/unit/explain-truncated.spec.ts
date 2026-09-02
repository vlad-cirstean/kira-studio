// P12 round 1 finding #8: Postgres/MySQL/MariaDB's JSON-format EXPLAIN returns the whole plan as
// one cell. A plan over MAX_CELL_BYTES (64 KiB) arrives clipped mid-JSON on the wire, with
// `isTruncated` set on the cell — parseExplainPages used to ignore that flag entirely and hand
// the (invalid, truncated) JSON straight to JSON.parse, which fails with an opaque "Unexpected end
// of JSON input" instead of a real, actionable message.
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { ConnectionSummary } from '@shared/domain/connection';
import { createTabularPageBuilder, MAX_CELL_BYTES } from '@shared/protocol/page';
import { ExplainTruncatedError, parseExplainPages } from '../../frontend/src/views/console/plan';

const { data } = await import('../../frontend/src/bridge/data');
const { connectionsState } = await import('../../frontend/src/state/connections');
const { openConsoleTab } = await import('../../frontend/src/state/tabs');
const { run, runtime, explain } = await import('../../frontend/src/views/console/state');

const PLAN_COLUMN = [
  {
    name: 'QUERY PLAN',
    dataType: 'json',
    typeClass: 'text' as const,
    nullable: false,
    isPrimaryKey: false,
    generated: false,
  },
];

// Deliberately not valid JSON once truncated — a well-formed plan under the limit stays whole and
// parses normally; this is what a real over-the-wire clip looks like.
function truncatedPlanPage() {
  const builder = createTabularPageBuilder(PLAN_COLUMN);
  const oversized = `[{"Plan":${JSON.stringify({ x: 'y'.repeat(MAX_CELL_BYTES) })}}]`;
  builder.appendRow([oversized]);
  return builder.finish({
    offset: 0,
    pageSize: 1,
    hasMore: false,
    nextToken: null,
    prevToken: null,
    strategy: 'offset',
  });
}

describe('parseExplainPages — truncated cell (P12 round 1 F8)', () => {
  for (const kind of ['postgres', 'mysql', 'mariadb'] as const) {
    test(`${kind}: a truncated plan cell throws ExplainTruncatedError, not a JSON parse error`, () => {
      const page = truncatedPlanPage();
      expect(page.truncatedCells).toBe(1); // sanity: the fixture really did clip on the wire
      expect(() => parseExplainPages(kind, [page], 100_000)).toThrow(ExplainTruncatedError);
    });
  }
});

describe('a truncated plan end to end (P12 round 1 F8)', () => {
  test('auto-explain shows a "could not check" strip instead of nothing, and the real run still executes', async () => {
    const connectionId = 'conn-explain-truncated-auto';
    connectionsState.records.push({
      id: connectionId,
      // biome-ignore lint/suspicious/noExplicitAny: a minimal fixture, not a real ConnectionSummary
      ...({ kind: 'postgres', autoExplain: true, name: 'x', color: 'blue' } as any),
    } as ConnectionSummary);
    const tabId = openConsoleTab(connectionId, 'db');

    let call = 0;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal stub, not the real data.execute
    (data as any).execute = () => {
      call++;
      // The pre-run EXPLAIN batch's own page comes back truncated; the real run's own page
      // (issued afterward, since D19 rule 5 says a check failure never blocks the query) is fine.
      if (call === 1) return Promise.resolve({ pages: [truncatedPlanPage()] });
      return Promise.resolve({ pages: [{ kind: 'tabular', rowCount: 0 }] });
    };

    await run(tabId, ['SELECT * FROM big']);

    expect(runtime[tabId]?.autoExplain).toEqual({ kind: 'truncated' });
    expect(runtime[tabId]?.status).toBe('idle'); // the real query still ran
    expect(call).toBe(2);
  });

  test('the manual Explain button surfaces a real message, not a raw JSON parse error', async () => {
    const connectionId = 'conn-explain-truncated-manual';
    connectionsState.records.push({
      id: connectionId,
      // biome-ignore lint/suspicious/noExplicitAny: a minimal fixture, not a real ConnectionSummary
      ...({ kind: 'postgres', autoExplain: false, name: 'y', color: 'blue' } as any),
    } as ConnectionSummary);
    const tabId = openConsoleTab(connectionId, 'db');

    // biome-ignore lint/suspicious/noExplicitAny: a minimal stub, not the real data.execute
    (data as any).execute = () => Promise.resolve({ pages: [truncatedPlanPage()] });

    const result = await explain(tabId, 'postgres', 'SELECT * FROM big');
    expect(result).toEqual({ ok: false, reason: 'The query plan was too large to display.' });
  });
});
