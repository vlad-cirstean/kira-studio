// P21 round 1 functional finding F2 (second half): a staged edit/delete whose row has no
// resolvable primary key in the current projection (the PK column got hidden, or a
// saved/restored tab's own stored projection happens to exclude it — F1's "hide-column" case)
// used to be dropped silently by buildPlan. commitPending then saw zero ops, returned null
// without ever calling data.mutate, and the caller (DataView.vue's onCommit, whose try/catch
// only distinguishes success from a thrown rejection) reported success — no error, the pending
// badge cleared, nothing changed on the server. This pins that it now throws instead.
//
// pendingChanges.ts transitively reaches bridge/data.ts -> '/wails/runtime.js' at module scope,
// so this has to be a dynamic import() after ./support/window's mock.module registration has run
// (the same pattern row-values-visible-span.spec.ts already uses).
import './support/window';

import { describe, expect, test } from 'bun:test';
import {
  createTabularPageBuilder,
  unpagedPosition,
} from '../../../../packages/shared/protocol/page';

const { setPage } = await import('../../frontend/src/views/grid/page');
const { data } = await import('../../frontend/src/bridge/data');
const { stageNull, commitPending, previewPending } = await import(
  '../../frontend/src/views/grid/pendingChanges'
);

function pkLessPage() {
  const columns = [
    {
      name: 'name',
      dataType: 'text',
      typeClass: 'text' as const,
      nullable: true,
      isPrimaryKey: false,
      generated: false,
    },
  ];
  const builder = createTabularPageBuilder(columns);
  builder.appendRow(['alice']);
  return builder.finish(unpagedPosition(1));
}

describe('a staged change with no resolvable primary key fails loudly instead of silently no-opping', () => {
  test('commitPending throws rather than returning null after a silent no-op', async () => {
    const tabId = 'pkless-tab-1';
    setPage(tabId, pkLessPage());
    stageNull(tabId, 0, 'name');

    let mutateCalled = false;
    (data as unknown as { mutate: typeof data.mutate }).mutate = async () => {
      mutateCalled = true;
      return { affectedRows: 1 };
    };

    await expect(commitPending('conn-1', 'db:x/table:t', tabId)).rejects.toThrow();
    expect(mutateCalled).toBe(false);
  });

  test("previewPending throws the same way, surfaced by PreviewCommandPanel.vue's own try/catch", async () => {
    const tabId = 'pkless-tab-2';
    setPage(tabId, pkLessPage());
    stageNull(tabId, 0, 'name');

    await expect(previewPending('conn-1', 'db:x/table:t', tabId)).rejects.toThrow();
  });
});
