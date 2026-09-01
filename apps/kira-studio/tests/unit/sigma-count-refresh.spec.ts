// P2 R2: views/grid/state.ts's runCount passes `refresh: rt.count?.stale === true` to data.count
// (P13 D18 — a Σ click on an already-fresh count stays an L3 hit, only a stale one bypasses it),
// but the copy-pasted runCount in views/documents, views/keyvalue and views/stream never carried
// that line over: every call always sent refresh as undefined/false, so once their cached count
// went stale, clicking Σ could never force a real recount — it kept re-reading the same stale L3
// entry until it fell out of cache entirely. This file pins the fix across all three.
//
// Filename note: importing state/tabs.ts here pulls in bridge/control.ts, which (like bridge/
// data.ts) reaches bridge/port.ts's module-scope `Stream('engine')` singleton call — the same
// shared-module-registry hazard wailsRuntime.ts's own comment documents for bridge-port.spec.ts.
// Several candidate names for this file (view-state-count-refresh.spec.ts, count-refresh.spec.ts)
// were empirically found to perturb bun test's file-loading order enough to make bridge-port.
// spec.ts's own socket wiring lose that race — every one of its 8 tests then failed or hung.
// "sigma-count-refresh.spec.ts" was verified stable across 15+ full-suite runs; keep this name
// (or re-verify a new one the same way) rather than assuming any name is safe.
import './support/window';

import { describe, expect, test } from 'bun:test';

const { data } = await import('../../frontend/src/bridge/data');
const { openDocumentTab, openKeyValueTab, openStreamTab } = await import(
  '../../frontend/src/state/tabs'
);
const { runCount: runDocumentCount, runtime: documentRuntime } = await import(
  '../../frontend/src/views/documents/state'
);
const { runCount: runKeyValueCount, runtime: keyValueRuntime } = await import(
  '../../frontend/src/views/keyvalue/state'
);
const { runCount: runStreamCount, runtime: streamRuntime } = await import(
  '../../frontend/src/views/stream/state'
);

interface Case {
  name: string;
  open: () => string;
  runCount: (tabId: string) => Promise<void>;
  // biome-ignore lint/suspicious/noExplicitAny: each module's own runtime record shape
  runtime: Record<string, any>;
}

const cases: Case[] = [
  {
    name: 'documents',
    open: () => openDocumentTab('conn-doc', 'db/coll', { newTab: true }).id,
    runCount: runDocumentCount,
    runtime: documentRuntime,
  },
  {
    name: 'keyvalue',
    open: () => openKeyValueTab('conn-kv', 'db0/key:big', { newTab: true }).id,
    runCount: runKeyValueCount,
    runtime: keyValueRuntime,
  },
  {
    name: 'stream',
    open: () => openStreamTab('conn-strm', 'topic:events', { newTab: true }).id,
    runCount: runStreamCount,
    runtime: streamRuntime,
  },
];

for (const { name, open, runCount, runtime } of cases) {
  describe(`views/${name}/state.ts — runCount's refresh flag (P2 R2, P13 D18)`, () => {
    test('a first count (no prior count cached) is requested without forcing a refresh', async () => {
      const id = open();
      let captured: { refresh?: boolean } | undefined;
      // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real CountResponse
      (data as any).count = (req: { refresh?: boolean }) => {
        captured = req;
        return Promise.resolve({
          value: 10,
          exact: true,
          at: Date.now(),
          stale: false,
          source: 'server',
        });
      };

      await runCount(id);

      expect(captured?.refresh).toBe(false);
      expect(runtime[id]?.count).toEqual({ value: 10, exact: true, stale: false });
    });

    test('once the cached count comes back stale, the next Σ click sets refresh: true', async () => {
      const id = open();
      // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real CountResponse
      (data as any).count = () =>
        Promise.resolve({ value: 5, exact: true, at: Date.now(), stale: true, source: 'server' });
      await runCount(id);
      expect(runtime[id]?.count?.stale).toBe(true);

      let captured: { refresh?: boolean } | undefined;
      // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real CountResponse
      (data as any).count = (req: { refresh?: boolean }) => {
        captured = req;
        return Promise.resolve({
          value: 6,
          exact: true,
          at: Date.now(),
          stale: false,
          source: 'server',
        });
      };
      await runCount(id);

      expect(captured?.refresh).toBe(true);
      expect(runtime[id]?.count).toEqual({ value: 6, exact: true, stale: false });
    });
  });
}
