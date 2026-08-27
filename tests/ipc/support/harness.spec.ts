import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { TreeNode } from '@shared/domain/tree';
import { DATA_OP } from '@shared/protocol/data-ops';
import { ENGINE_OP } from '@shared/protocol/engine-ops';
import { type SqliteFixture, startSqlite } from '../../db/support/sqlite';
import { writeFixtureModule } from './capture';
import { decodePage } from './decode';
import { openHarness } from './harness';
import type { ControlSnapshot, PortSnapshot } from './types';

// P50 §5 commit 1: the one Docker-free proof this sandbox can give for the whole tests/ipc/
// harness (capture -> assert -> decode, plus the real TreeService/handleFrame/dispatch loop) —
// against tests/db/support/sqlite.ts's temp-file fixture, the same shape the plan's own F8 probe
// measured. This is harness coverage, not adapter coverage: every actual adapter split
// (mariadb.backend.spec.ts and siblings) still needs a real container and is Docker-gated.

const CONTAINER_START_TIMEOUT_MS = 60_000;

let sqlite: SqliteFixture;

before(
  async () => {
    // seedBigTable stays at its default (true): the sqlite adapter's catalog code reads
    // sqlite_stat1 for a table's row estimate, and that table only exists once ANALYZE has run
    // at least once — support/sqlite.ts's own seedBigTable branch is what runs it.
    sqlite = await startSqlite();
  },
  { timeout: CONTAINER_START_TIMEOUT_MS },
);

after(async () => {
  await sqlite?.stop();
});

function findNode(nodes: TreeNode[], name: string): TreeNode {
  const node = nodes.find((n) => n.name === name);
  assert.ok(node, `expected a node named ${name}, got ${JSON.stringify(nodes.map((n) => n.name))}`);
  return node;
}

describe('tests/ipc/support harness (Docker-free, sqlite)', () => {
  test('connect, tree enumeration, cache transition, a real read, and the fixture round trip', async () => {
    const harness = await openHarness();
    try {
      const { serverVersion, caps } = await harness.connect(sqlite.config);
      assert.equal(typeof serverVersion, 'string');
      assert.ok(caps);

      const root = await harness.children(sqlite.config.id, '');
      assert.equal(root.source, 'server');
      const dbNode = findNode(root.nodes, 'main');

      const dbChildren = await harness.children(sqlite.config.id, dbNode.path);
      assert.equal(dbChildren.source, 'server');
      const orderItems = findNode(dbChildren.nodes, 'order_items');

      // The cache transition the plan's F8 calls out by name: tests/db/ instantiates the adapter
      // directly and never reaches this layer at all.
      const dbChildrenAgain = await harness.children(sqlite.config.id, dbNode.path);
      assert.equal(dbChildrenAgain.source, 'cache');
      // The cached copy round-tripped through JSON (storage/repos/metadata-cache.ts), which drops
      // any key whose value is `undefined` (e.g. a table node's `detail`) — round-trip the
      // pre-cache copy through JSON too before comparing, rather than asserting the two are
      // identical objects.
      assert.deepEqual(dbChildrenAgain.nodes, JSON.parse(JSON.stringify(dbChildren.nodes)));

      const readPayload = {
        opId: 'harness-self-test-1',
        tabId: null,
        connectionId: sqlite.config.id,
        path: orderItems.path,
        projection: null,
        filter: null,
        sort: null,
        pageSize: 100 as const,
        cursor: { mode: 'offset' as const, offset: 0 },
      };
      const firstRead = await harness.dataOp<{ page: unknown; source: string }>(
        DATA_OP.read,
        readPayload,
      );
      assert.equal(firstRead.source, 'server');
      const logicalPage = decodePage(firstRead.page as Parameters<typeof decodePage>[0]);
      assert.equal(logicalPage.kind, 'tabular');
      assert.ok(logicalPage.kind === 'tabular' && logicalPage.rows.length > 0);

      const secondRead = await harness.dataOp<{ page: unknown; source: string }>(
        DATA_OP.read,
        readPayload,
      );
      assert.equal(secondRead.source, 'cache');

      // The capture -> write -> read-back loop the real adapter fixtures depend on (D5) — proven
      // here against a scratch path, never against a committed tests/ipc/<adapter>/*.fixture.ts.
      const controlSnapshots: ControlSnapshot[] = [
        { channel: 'kira:tree:children', args: { path: '' }, response: root },
      ];
      const portSnapshots: PortSnapshot[] = [
        {
          op: DATA_OP.read,
          payload: readPayload,
          response: { kind: 'read', page: logicalPage, source: 'server' },
        },
      ];
      const scratchDir = await mkdtemp(join(tmpdir(), 'kira-ipc-fixture-'));
      const scratchPath = join(scratchDir, 'scratch.fixture.ts');
      try {
        writeFixtureModule(scratchPath, 'scratch', controlSnapshots, portSnapshots);
        const written = await readFile(scratchPath, 'utf8');
        assert.ok(written.includes('export const controlSnapshots'));
        assert.ok(written.includes('export const portSnapshots'));
        assert.ok(written.includes(orderItems.path));
      } finally {
        await rm(scratchDir, { recursive: true, force: true });
      }

      await harness.engineOp(ENGINE_OP.disconnect, { connectionId: sqlite.config.id });
    } finally {
      await harness.close();
    }
  });
});
