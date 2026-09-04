import { DATA_OP } from '@shared/protocol/data-ops';
import type { ControlSnapshot, PortSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { gridCell } from './support/grid';
import { IPC } from './support/ipcChannels';
import {
  COMPOSITE_PK_COLUMNS,
  COMPOSITE_PK_PATH,
  compositePkConnectAndOpen,
  postgresConnectionSummary,
} from './support/postgresFixture';
import { connectionRow, expandRow, findRow, openRowMenu } from './support/tree';

// P15 §6.1: follows tests/ui/mutations.spec.ts end to end — same fixture, same relaunch shape,
// same grid-cell assertions. F13 governs the whole design here: mockStreamBrowser.js's own
// matchKey is the exact request payload, so every scenario that asserts a payload (3, 4, 5) sets
// every column's recipe to `sequence`/`constant`, whose output is fixed by the app and not by
// faker's RNG — faker-backed *content* is covered by tests/unit/fake-data-recipes.spec.ts instead,
// this tier covers the *wiring* (P19's own dependency bump would otherwise break an exact-payload
// assertion on faker output on purpose, OQ-6).

const CONNECTION_ID = 'conn-fakedata';
const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Fake Data DB', 'green');
const FIXTURE = compositePkConnectAndOpen(CONNECTION_ID);

const RO_CONNECTION_ID = 'conn-fakedata-ro';
const RO_CONNECTION_SUMMARY = {
  ...postgresConnectionSummary(RO_CONNECTION_ID, 'Fake Data DB (RO)', 'red'),
  readOnly: true,
};
const RO_FIXTURE = compositePkConnectAndOpen(RO_CONNECTION_ID);

// Scenario 3/4's exact three-row plan: both PK columns on `sequence` starting at 100, `name` a
// `constant` — deterministic, not faker-backed (F13).
const GENERATED_OPS = [
  {
    kind: 'insert' as const,
    values: { tenant_id: '100', entity_id: '100', name: 'generated row' },
  },
  {
    kind: 'insert' as const,
    values: { tenant_id: '101', entity_id: '101', name: 'generated row' },
  },
  {
    kind: 'insert' as const,
    values: { tenant_id: '102', entity_id: '102', name: 'generated row' },
  },
];

// Scenario 5: a single-row plan colliding with the fixture's own (1,1) row — the real captured
// duplicate-key text mutations.spec.ts:180-186 already uses.
const DUPLICATE_OPS = [
  { kind: 'insert' as const, values: { tenant_id: '1', entity_id: '1', name: 'duplicate key' } },
];

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Fake Data DB',
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
      name: 'Fake Data DB (RO)',
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
  // scenario 3: Preview, through the existing data:preview op.
  {
    op: DATA_OP.preview,
    payload: { connectionId: CONNECTION_ID, path: COMPOSITE_PK_PATH, ops: GENERATED_OPS },
    response: {
      kind: 'preview',
      statements: [
        `INSERT INTO "app"."composite_pk" ("tenant_id", "entity_id", "name") VALUES ('100', '100', 'generated row')`,
        `INSERT INTO "app"."composite_pk" ("tenant_id", "entity_id", "name") VALUES ('101', '101', 'generated row')`,
        `INSERT INTO "app"."composite_pk" ("tenant_id", "entity_id", "name") VALUES ('102', '102', 'generated row')`,
      ],
    },
  },
  // scenario 4: Generate — one data.mutate carrying the same three ops (D6: 3 rows is one batch,
  // far below the 500-row boundary), then reloadAfterMutation's own invalidate + read pair.
  {
    op: DATA_OP.mutate,
    payload: { connectionId: CONNECTION_ID, path: COMPOSITE_PK_PATH, ops: GENERATED_OPS },
    response: { kind: 'mutate', affectedRows: 3 },
  },
  {
    op: DATA_OP.invalidate,
    payload: { connectionId: CONNECTION_ID, path: COMPOSITE_PK_PATH, scope: 'pages' },
    response: { kind: 'invalidate' },
  },
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
          ['1', '1', 'tenant 1 / entity 1'],
          ['1', '2', 'tenant 1 / entity 2'],
          ['2', '1', 'tenant 2 / entity 1'],
          ['100', '100', 'generated row'],
          ['101', '101', 'generated row'],
          ['102', '102', 'generated row'],
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
  // scenario 5: a failed batch — the real captured duplicate-key text, committing nothing.
  {
    op: DATA_OP.mutate,
    payload: { connectionId: CONNECTION_ID, path: COMPOSITE_PK_PATH, ops: DUPLICATE_OPS },
    error: {
      code: 'E_QUERY',
      message: 'duplicate key value violates unique constraint "composite_pk_pkey"',
    },
  },
  ...RO_FIXTURE.port,
];

test('fake data generator — gate, defaults, preview, generate, failure', async ({ relaunch }) => {
  const { window: page, stream } = await relaunch({ control: CONTROL, stream: PORT });

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Fake Data DB');
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

  const dialog = page.locator('[data-testid="generate-data-dialog"]');

  // --- scenario 2: the default plan is schema-derived ---------------------------------------
  await page.click('[data-testid="toolbar-generate-data"]');
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-testid="generate-data-recipe-tenant_id"]')).toHaveValue(
    'sequence',
  );
  await expect(page.locator('[data-testid="generate-data-recipe-entity_id"]')).toHaveValue(
    'sequence',
  );
  const nameRecipe = await page.locator('[data-testid="generate-data-recipe-name"]').inputValue();
  expect(nameRecipe).not.toBe('skip'); // a nullable text column always proposes something real
  // This is the assertion most likely to be deleted later by someone who thinks the strip is
  // noise — it guards F11: a fresh sequence starting at 1 can still collide with rows already in
  // the table (composite_pk's own seed data proves it), so both PK columns are named here even
  // though their proposed recipe is already unique-by-construction.
  const warningsText = await page.locator('[data-testid="generate-data-warnings"]').innerText();
  expect(warningsText).toContain('tenant_id');
  expect(warningsText).toContain('entity_id');

  // --- scenario 3: preview shows the real dialect SQL for the first rows --------------------
  await page.fill('[data-testid="generate-data-sequence-start-tenant_id"]', '100');
  await page.fill('[data-testid="generate-data-sequence-start-entity_id"]', '100');
  await page.selectOption('[data-testid="generate-data-recipe-name"]', 'constant');
  await page.fill('[data-testid="generate-data-constant-name"]', 'generated row');
  await page.fill('[data-testid="generate-data-row-count"]', '3');

  await page.click('[data-testid="generate-data-preview-toggle"]');
  const previewBody = page.locator('[data-testid="generate-data-preview"]');
  await expect(previewBody.locator('.cm-content')).toBeVisible({ timeout: 10_000 });
  const previewText = await previewBody.locator('.cm-content').innerText();
  expect(previewText).toContain('INSERT INTO "app"."composite_pk"');

  // --- scenario 4: generate commits in one batch and the grid reloads -----------------------
  const mutatesBefore = (await stream.ops()).filter((o) => o.op === DATA_OP.mutate).length;
  await page.click('[data-testid="generate-data-submit"]');
  await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  const mutatesAfter = (await stream.ops()).filter((o) => o.op === DATA_OP.mutate);
  expect(mutatesAfter.length).toBe(mutatesBefore + 1);
  expect(mutatesAfter.at(-1)?.payload).toMatchObject({ ops: GENERATED_OPS });
  await expect(gridCell(page, 3, 'name')).toHaveText('generated row', { timeout: 10_000 });
  await expect(gridCell(page, 5, 'name')).toHaveText('generated row');

  // --- scenario 5: a failed batch reports what was committed --------------------------------
  await page.click('[data-testid="toolbar-generate-data"]');
  await expect(dialog).toBeVisible();
  await page.fill('[data-testid="generate-data-row-count"]', '1');
  await page.selectOption('[data-testid="generate-data-recipe-name"]', 'constant');
  await page.fill('[data-testid="generate-data-constant-name"]', 'duplicate key');
  // Both PK sequences already default to start 1 on this fresh open — (1,1) collides with the
  // fixture's own first row.
  await page.click('[data-testid="generate-data-submit"]');
  const runErrorStrip = page.locator('[data-testid="generate-data-error"]');
  await expect(runErrorStrip).toBeVisible();
  await expect(runErrorStrip).toContainText(/duplicate key|unique/i);
  await expect(runErrorStrip).toContainText(/0 rows committed/i);
  await expect(runErrorStrip).toContainText(/rolled back/i);
  await expect(dialog).toBeVisible(); // stays open — the run did not succeed

  await page.click('[data-testid="generate-data-close"]');
  await expect(dialog).toHaveCount(0);

  // --- scenario 1: the button's gate on a read-only connection ------------------------------
  const firstConnRow = connectionRow(page, 'Fake Data DB');
  await expect(firstConnRow).toHaveCount(1);
  await firstConnRow.locator('.twisty').click();

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Fake Data DB (RO)');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click('[data-testid="color-red"]');
  await page.click('[data-testid="connection-tab-advanced"]');
  await page.click('[data-testid="connection-readonly"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const roConnRow = connectionRow(page, 'Fake Data DB (RO)');
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

  const roGenerateButton = page.locator('[data-testid="toolbar-generate-data"]');
  await expect(roGenerateButton).toBeVisible();
  await expect(roGenerateButton).toBeDisabled();
  await expect(roGenerateButton).toHaveAttribute('data-kira-tip', /read-only/i);
});
