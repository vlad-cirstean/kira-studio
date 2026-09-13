// P21 round 2 functional finding 2: hiding one column of a *composite* primary key
// (legitimately allowed per round 1's own bace7a2 revert — COMPOSITE_PK_COLUMNS coverage in
// tests/ui/interaction.spec.ts) used to stage a real update/delete op with a *partial* key,
// because primaryKeyOf only returned null when *zero* PK columns were projected. Committing that
// op reached AssertKeyIsPrimaryKey server-side, refusing with an opaque, table-agnostic
// "row key must be exactly the primary key columns" — round 1's own UnaddressableRowError
// (grid-commit-pkless-guard.spec.ts) never fired for this half of the same bug class.
//
// Mirrors grid-commit-pkless-guard.spec.ts's own dynamic-import pattern (pendingChanges.ts
// transitively reaches bridge/data.ts -> '/wails/runtime.js' at module scope).
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { ObjectMeta } from '@shared/domain/tree';
import {
  type ColumnDescriptor,
  createTabularPageBuilder,
  unpagedPosition,
} from '../../../../packages/shared/protocol/page';
import { restoreAfterEach } from './support/restoreAfterEach';

const { setPage } = await import('../../frontend/src/views/grid/page');
const { runtime } = await import('../../frontend/src/views/grid/state');
const { data } = await import('../../frontend/src/bridge/data');
restoreAfterEach(data);
const { stageEdit, stageDelete, commitPending, previewPending } = await import(
  '../../frontend/src/views/grid/pendingChanges'
);

function pkColumn(name: string): ColumnDescriptor {
  return {
    name,
    dataType: 'text',
    typeClass: 'text',
    nullable: false,
    isPrimaryKey: true,
    generated: false,
  };
}

function metaWithCompositeKey(): ObjectMeta {
  return {
    path: 'schema:app/table:orders',
    kind: 'table',
    name: 'orders',
    qualifiedName: 'app.orders',
    columns: [],
    primaryKey: ['tenant_id', 'entity_id'],
    foreignKeys: [],
    referencedBy: [],
    indexes: [],
    rowEstimate: null,
    comment: null,
  };
}

// Only `tenant_id` is projected — entity_id, the other half of the composite key, was hidden via
// the header context menu's Hide column (round 1's own bace7a2: legitimate, still tested
// elsewhere). The old `.some(isPrimaryKey)`-style detection sees a non-empty key and proceeds.
function compositeKeyPageWithOneColumnHidden() {
  const columns = [pkColumn('tenant_id'), { ...pkColumn('name'), isPrimaryKey: false } as never];
  const builder = createTabularPageBuilder(columns as ColumnDescriptor[]);
  builder.appendRow(['t1', 'alice']);
  return builder.finish(unpagedPosition(1));
}

describe('a staged change against a partially-hidden composite primary key fails loudly (P21 round 2 functional finding 2)', () => {
  test('commitPending throws UnaddressableRowError naming the hidden PK column, instead of staging a partial key', async () => {
    const tabId = 'composite-pk-tab-1';
    runtime[tabId] = {
      status: 'idle',
      error: null,
      actionError: null,
      opId: null,
      count: null,
      countOpId: null,
      meta: metaWithCompositeKey(),
      lastStrategy: 'offset',
      nextToken: null,
      prevToken: null,
      hasMore: false,
      selection: null,
      searchOpen: false,
    };
    setPage(tabId, compositeKeyPageWithOneColumnHidden());
    stageEdit(tabId, 0, 'name', 'alice2');

    let mutateCalled = false;
    (data as unknown as { mutate: typeof data.mutate }).mutate = async () => {
      mutateCalled = true;
      return { affectedRows: 1 };
    };

    await expect(commitPending('conn-1', 'db:app/table:orders', tabId)).rejects.toThrow(
      /entity_id/,
    );
    expect(mutateCalled).toBe(false);
  });

  test('a staged delete against the same partial key also throws, naming the hidden column', async () => {
    const tabId = 'composite-pk-tab-2';
    runtime[tabId] = {
      status: 'idle',
      error: null,
      actionError: null,
      opId: null,
      count: null,
      countOpId: null,
      meta: metaWithCompositeKey(),
      lastStrategy: 'offset',
      nextToken: null,
      prevToken: null,
      hasMore: false,
      selection: null,
      searchOpen: false,
    };
    setPage(tabId, compositeKeyPageWithOneColumnHidden());
    stageDelete(tabId, [0]);

    // Explicitly mocked (never expected to be reached) rather than left to the real bridge,
    // which would otherwise hang against the fake window mock instead of failing fast if this
    // regressed.
    (data as unknown as { preview: typeof data.preview }).preview = () => {
      throw new Error('previewPending must throw before ever calling data.preview');
    };

    await expect(previewPending('conn-1', 'db:app/table:orders', tabId)).rejects.toThrow(
      /entity_id/,
    );
  });

  test('a complete composite key (both columns projected) still commits normally', async () => {
    const tabId = 'composite-pk-tab-3';
    runtime[tabId] = {
      status: 'idle',
      error: null,
      actionError: null,
      opId: null,
      count: null,
      countOpId: null,
      meta: metaWithCompositeKey(),
      lastStrategy: 'offset',
      nextToken: null,
      prevToken: null,
      hasMore: false,
      selection: null,
      searchOpen: false,
    };
    const columns = [pkColumn('tenant_id'), pkColumn('entity_id')];
    const builder = createTabularPageBuilder(columns);
    builder.appendRow(['t1', 'e1']);
    setPage(tabId, builder.finish(unpagedPosition(1)));
    stageDelete(tabId, [0]);

    let mutateCalled = false;
    let sentKey: unknown;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real MutateRequestWire
    (data as any).mutate = async (req: any) => {
      mutateCalled = true;
      sentKey = req.ops[0]?.key;
      return { affectedRows: 1 };
    };

    await commitPending('conn-1', 'db:app/table:orders', tabId);
    expect(mutateCalled).toBe(true);
    expect(sentKey).toEqual({ tenant_id: 't1', entity_id: 'e1' });
  });
});
