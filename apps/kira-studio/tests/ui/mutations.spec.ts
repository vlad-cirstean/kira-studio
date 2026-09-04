import { DATA_OP } from '@shared/protocol/data-ops';
import type { ControlSnapshot, PortSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { cellText, gridCell, gutterCell } from './support/grid';
import { IPC } from './support/ipcChannels';
import {
  COMPOSITE_PK_COLUMNS,
  COMPOSITE_PK_PATH,
  compositePkConnectAndOpen,
  postgresConnectionSummary,
} from './support/postgresFixture';
import { connectionRow, expandRow, findRow, openRowMenu } from './support/tree';

const RO_CONNECTION_ID = 'conn-mutations-ro';
const RO_CONNECTION_SUMMARY = {
  ...postgresConnectionSummary(RO_CONNECTION_ID, 'Mutations DB (RO)', 'red'),
  readOnly: true,
};
const RO_FIXTURE = compositePkConnectAndOpen(RO_CONNECTION_ID);

// Ported from tests/e2e/mutations.spec.ts (P57 D16), against real captures of app.composite_pk's
// preview/mutate/count responses (scripts/capture-postgres-tree.ts, including the real
// "duplicate key value violates unique constraint" error text — not invented). Every scenario
// here is single-session (no relaunch), so all of it ports; the one thing genuinely new to this
// tier is that `data:preview` and a failed `data:mutate` had no mock support at all before this —
// see tests/ipc/support/types.ts's PortSnapshot.error and the new 'preview' LogicalPortResponse
// kind, both added getting this file green.

const CONNECTION_ID = 'conn-mutations';
const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Mutations DB', 'green');
const FIXTURE = compositePkConnectAndOpen(CONNECTION_ID);

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Mutations DB',
      kind: 'postgres',
      color: 'green',
      mode: 'fields',
      readOnly: false,
      host: '127.0.0.1',
      port: 5432,
      database: 'kira_test',
      username: 'postgres',
      password: null,
      uri: null,
      options: {},
      preconnect: null,
      preconnectSidecar: false,
      autoExplain: false,
      throttlePerSec: 0,
    },
    response: CONNECTION_SUMMARY,
  },
  ...FIXTURE.control,
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Mutations DB (RO)',
      kind: 'postgres',
      color: 'red',
      mode: 'fields',
      readOnly: true,
      host: '127.0.0.1',
      port: 5432,
      database: 'kira_test',
      username: 'postgres',
      password: null,
      uri: null,
      options: {},
      preconnect: null,
      preconnectSidecar: false,
      autoExplain: false,
      throttlePerSec: 0,
    },
    response: RO_CONNECTION_SUMMARY,
  },
  ...RO_FIXTURE.control,
];

const PORT: PortSnapshot[] = [
  ...FIXTURE.port,
  {
    op: DATA_OP.preview,
    payload: {
      connectionId: CONNECTION_ID,
      path: COMPOSITE_PK_PATH,
      ops: [{ kind: 'insert', values: { tenant_id: '9', entity_id: '1', name: 'inserted row' } }],
    },
    response: {
      kind: 'preview',
      statements: [
        `INSERT INTO "app"."composite_pk" ("tenant_id", "entity_id", "name") VALUES ('9', '1', 'inserted row')`,
      ],
    },
  },
  // The committed batch: delete (1,2), then update (1,1)'s name (buildPlan's own order —
  // deletes, then edits, then inserts).
  {
    op: DATA_OP.mutate,
    payload: {
      connectionId: CONNECTION_ID,
      path: COMPOSITE_PK_PATH,
      ops: [
        { kind: 'delete', key: { tenant_id: '1', entity_id: '2' } },
        {
          kind: 'update',
          key: { tenant_id: '1', entity_id: '1' },
          changes: { name: 'committed value' },
        },
      ],
    },
    response: { kind: 'mutate', affectedRows: 2 },
  },
  // reloadAfterMutation()'s own data.invalidate() call, before it reloads the page below —
  // must be answered or the whole async function throws and the reload read never runs.
  {
    op: DATA_OP.invalidate,
    payload: { connectionId: CONNECTION_ID, path: COMPOSITE_PK_PATH, scope: 'pages' },
    response: { kind: 'invalidate' },
  },
  // reloadAfterMutation()'s own reload, at the tab's current page/pageSize.
  {
    op: DATA_OP.read,
    payload: {
      connectionId: CONNECTION_ID,
      path: COMPOSITE_PK_PATH,
      projection: null,
      filter: null,
      sort: null,
      pageSize: 100,
      cursor: { mode: 'offset', offset: 0 },
    },
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: COMPOSITE_PK_COLUMNS,
        rows: [
          ['1', '1', 'committed value'],
          ['2', '1', 'tenant 2 / entity 1'],
        ],
        position: {
          offset: 0,
          pageSize: 100,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  },
  // Count sequence (all share one (op, {filter, refresh}) key when refresh matches — see
  // mockStreamBrowser.js's own cursor replay): (1) the "establish a known count" click,
  // (2) reloadAfterMutation()'s own automatic re-count (still refresh:false — the local `stale`
  // flag flips only once *this* response lands), both refresh:false, replayed in that order;
  // (3) the user's own "click it through" recount, refresh:true.
  {
    op: DATA_OP.count,
    payload: { connectionId: CONNECTION_ID, path: COMPOSITE_PK_PATH, filter: null, refresh: false },
    response: { kind: 'count', value: 3, exact: true, stale: false, source: 'server' },
  },
  {
    op: DATA_OP.count,
    payload: { connectionId: CONNECTION_ID, path: COMPOSITE_PK_PATH, filter: null, refresh: false },
    response: { kind: 'count', value: 3, exact: true, stale: true, source: 'cache' },
  },
  {
    op: DATA_OP.count,
    payload: { connectionId: CONNECTION_ID, path: COMPOSITE_PK_PATH, filter: null, refresh: true },
    response: { kind: 'count', value: 2, exact: true, stale: false, source: 'server' },
  },
  // The duplicate-key insert: (1,1) already exists after the commit above.
  {
    op: DATA_OP.mutate,
    payload: {
      connectionId: CONNECTION_ID,
      path: COMPOSITE_PK_PATH,
      ops: [{ kind: 'insert', values: { tenant_id: '1', entity_id: '1', name: 'duplicate key' } }],
    },
    error: {
      code: 'E_QUERY',
      message: 'duplicate key value violates unique constraint "composite_pk_pkey"',
    },
  },
  ...RO_FIXTURE.port,
];

async function editCell(
  page: import('@playwright/test').Page,
  row: number,
  column: string,
  value: string,
) {
  await gridCell(page, row, column).dblclick();
  const input = page.locator('[data-testid="grid-cell-input"]');
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press('Enter');
}

test('mutations — edit, add, delete, preview, commit, discard, read-only guard', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Mutations DB');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click('[data-testid="color-green"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const connRow = connectionRow(page);
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await expandRow(page, '');
  await expandRow(page, 'database:kira_test');
  await expandRow(page, 'database:kira_test/schema:app');

  const compositeRow = await findRow(page, COMPOSITE_PK_PATH);
  await compositeRow.dblclick();
  const grid = page.locator('[data-testid="data-grid"]');
  await expect(grid).toBeVisible();
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="name"]')).toBeVisible();

  // --- scenario 1: editing a cell stages it (tinted, not yet sent) ------------------------
  const originalName = await cellText(page, 0, 'name');
  await editCell(page, 0, 'name', 'edited via UI');
  await expect(gridCell(page, 0, 'name')).toHaveClass(/pending-edit/);
  expect(await cellText(page, 0, 'name')).toBe('edited via UI');
  await expect(page.locator('[data-testid="toolbar-commit-changes"]')).toBeVisible();
  await expect(page.locator('[data-testid="toolbar-discard-changes"]')).toBeVisible();

  // --- scenario 2: discard reverts every pending change -------------------------------------
  await page.click('[data-testid="toolbar-discard-changes"]');
  await expect(page.locator('[data-testid="toolbar-commit-changes"]')).toHaveCount(0);
  expect(await cellText(page, 0, 'name')).toBe(originalName);

  // --- scenario 3: add row appends an always-editable insert row ---------------------------
  await page.click('[data-testid="toolbar-add-row"]');
  const insertRow = page.locator('[data-testid="grid-row-insert"]');
  await expect(insertRow).toHaveCount(1);
  const insertId = await insertRow.getAttribute('data-insert-id');
  expect(insertId).not.toBeNull();
  const insertInputs = insertRow.locator('[data-testid="grid-cell-insert"] input');
  await insertInputs.nth(0).fill('9');
  await insertInputs.nth(1).fill('1');
  await insertInputs.nth(2).fill('inserted row');

  // --- scenario 4: preview command shows the exact SQL for pending changes -----------------
  await page.click('[data-testid="toolbar-preview-command"]');
  const previewPanel = page.locator('[data-testid="preview-command-panel"]');
  await expect(previewPanel).toBeVisible();
  await expect(previewPanel.locator('.cm-content')).toBeVisible({ timeout: 10_000 });
  const previewText = await previewPanel.locator('.cm-content').innerText();
  expect(previewText).toContain('INSERT INTO');
  expect(previewText).toContain('composite_pk');
  await page.click('[data-testid="preview-command-close"]');
  await expect(previewPanel).toHaveCount(0);

  // Discard the insert before moving to the delete/commit scenarios below, so they start clean.
  await page.click('[data-testid="toolbar-discard-changes"]');
  await expect(insertRow).toHaveCount(0);

  // --- scenario 5: delete-row marks a row struck-through, non-committed until commit -------
  // P22 Pass B — page-row-scoped (support/grid.ts's own gutterCell), not a raw DOM-order `.nth(1)`:
  // SlickGrid recycles row DOM nodes as it renders (F2), so their physical DOM order does not
  // track visual/page-row order the way the incumbent's own always-append-in-order rows did.
  await gutterCell(page, 1).click();
  await page.click('[data-testid="toolbar-delete-row"]');
  const deletedRow = page.locator('[data-testid="grid-row"][data-row="1"]');
  await expect(deletedRow).toHaveClass(/pending-delete/);

  // --- scenario 6: commit sends the batch and reloads the tab ------------------------------
  const countButton = page.locator('[data-testid="toolbar-count"]');
  await countButton.click();
  await expect(countButton).toHaveAttribute('data-kira-tip', /Count all rows — Σ \d/, {
    timeout: 10_000,
  });
  const countBeforeCommit = await countButton.getAttribute('data-kira-tip');

  const deletedRowName = await cellText(page, 1, 'name');
  await editCell(page, 0, 'name', 'committed value');
  await page.click('[data-testid="toolbar-commit-changes"]');
  await expect(page.locator('[data-testid="toolbar-commit-changes"]')).toHaveCount(0);
  await expect(gridCell(page, 0, 'name')).not.toHaveClass(/pending-edit/);
  await expect(gridCell(page, 0, 'name')).toHaveText('committed value', { timeout: 10_000 });
  const remainingNames = await page
    .locator('[data-testid="grid-cell"][data-column="name"]')
    .allInnerTexts();
  expect(remainingNames).not.toContain(deletedRowName);

  // §7/F21/D18: a local mutation greys the count instead of blanking it.
  await expect(countButton).toHaveAttribute('data-kira-tip', /stale, click to refresh/, {
    timeout: 10_000,
  });
  expect(await countButton.getAttribute('data-kira-tip')).toBe(
    `${countBeforeCommit} (stale, click to refresh)`,
  );

  // Clicking it through produces a real recount and clears the stale mark.
  await countButton.click();
  await expect(countButton).not.toHaveAttribute('data-kira-tip', /stale/, { timeout: 10_000 });
  expect(await countButton.getAttribute('data-kira-tip')).not.toBe(countBeforeCommit);

  // --- P43 F5/D7: a failed commit reports the server's own error, not an unhandled rejection —
  // (1, 1) is the surviving row from scenario 6's own edit, so a fresh insert of the same
  // composite key violates the PK. -----------------------------------------------------------
  await page.click('[data-testid="toolbar-add-row"]');
  const dupInsertRow = page.locator('[data-testid="grid-row-insert"]');
  await expect(dupInsertRow).toHaveCount(1);
  const dupInsertInputs = dupInsertRow.locator('[data-testid="grid-cell-insert"] input');
  await dupInsertInputs.nth(0).fill('1');
  await dupInsertInputs.nth(1).fill('1');
  await dupInsertInputs.nth(2).fill('duplicate key');
  await page.click('[data-testid="toolbar-commit-changes"]');
  const actionError = page.locator('[data-testid="data-action-error"]');
  await expect(actionError).toBeVisible();
  await expect(actionError).toContainText(/duplicate key|unique/i);
  await expect(dupInsertRow).toHaveCount(1); // the staged insert survives the failure
  await page.click('[data-testid="toolbar-discard-changes"]');
  await expect(dupInsertRow).toHaveCount(0);
  await expect(actionError).toHaveCount(0);

  // --- scenario 7: a read-only connection disables every mutation button ------------------
  const firstConnRow = connectionRow(page, 'Mutations DB');
  await expect(firstConnRow).toHaveCount(1);
  await firstConnRow.locator('.twisty').click();

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Mutations DB (RO)');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click('[data-testid="color-red"]');
  await page.click('[data-testid="connection-tab-advanced"]');
  await page.click('[data-testid="connection-readonly"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const roConnRow = connectionRow(page, 'Mutations DB (RO)');
  await expect(roConnRow).toBeVisible();
  await roConnRow.click({ button: 'right' });
  await page.click('[data-testid="menu-item-connect"]');
  await expect(roConnRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await roConnRow.locator('.twisty').click();
  await expandRow(page, 'database:kira_test');
  await expandRow(page, 'database:kira_test/schema:app');
  const roCompositeRow = await findRow(page, COMPOSITE_PK_PATH);
  await roCompositeRow.dblclick();
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="name"]')).toBeVisible();

  for (const testId of ['toolbar-add-row', 'toolbar-delete-row']) {
    await expect(page.locator(`[data-testid="${testId}"]`)).toBeDisabled();
  }
  await expect(page.locator('[data-testid="toolbar-preview-command"]')).toHaveCount(0);
});
