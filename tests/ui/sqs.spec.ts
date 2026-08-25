import type { Page } from '@playwright/test';
import { DRAIN_QUEUE, EMPTY_QUEUE, ORDERS_QUEUE } from '../db/fixtures/0006_sqs_seed';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type SqsFixture,
  startSqs,
} from './support/sqs';
import { expandRow, findRow, openRowMenu } from './support/tree';

// The sixth engine through the real UI (P10, mirrors kafka.spec.ts's discipline for the fifth):
// SQS's 'batch' pagination is the point of this spec — it proves the view never auto-loads and
// requires an explicit Poll click (D10/D12), unlike every other read-only view in the app.
test.describe.configure({ timeout: 240_000 });

let sqs: SqsFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  sqs = await startSqs();
});

test.afterAll(async () => {
  await sqs?.stop();
});

const ORDERS_QUEUE_PATH = `queue:${ORDERS_QUEUE}`;
const EMPTY_QUEUE_PATH = `queue:${EMPTY_QUEUE}`;

function getOps(page: Page): Promise<{ id: string; kind: string; status: string }[]> {
  return page.evaluate(() => window.kira.opsRecent({ limit: 1000 }));
}

test('sqs — connect, flat queue tree, stream tab (batch, Poll-only)', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!sqs) throw new Error('sqs fixture did not start');
  const { window: page } = kira;

  const cfg = sqs.config;
  await page.evaluate(
    (c) =>
      window.kira.connectionsCreate({
        name: 'SQS',
        kind: 'sqs',
        color: 'amber',
        mode: 'uri',
        readOnly: false,
        host: null,
        port: null,
        database: null,
        username: null,
        password: null,
        uri: c.uri,
        options: c.options,
        preconnect: null,
        preconnectSidecar: false,
      }),
    { uri: cfg.uri, options: cfg.options },
  );

  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });

  // --- tree: root is a flat queue list, no nested level under any queue -------------------------
  await expandRow(page, '');
  const drainRow = await findRow(page, `queue:${DRAIN_QUEUE}`);
  await expect(drainRow).toBeVisible();
  await expect(drainRow).toHaveAttribute('data-kind', 'queue');
  await expect(drainRow.locator('.twisty')).toHaveClass(/invisible/);
  const emptyQueueRow = await findRow(page, EMPTY_QUEUE_PATH);
  await expect(emptyQueueRow).toBeVisible();
  const ordersQueueRow = await findRow(page, ORDERS_QUEUE_PATH);
  await expect(ordersQueueRow).toBeVisible();

  await page.screenshot({ path: 'test-results/screenshots/sqs.png' });

  // --- open the orders queue: batch pagination never auto-loads (D10/D12) ------------------------
  await ordersQueueRow.dblclick();
  const view = page.locator(`[data-testid="stream-view"][data-path="${ORDERS_QUEUE_PATH}"]`);
  await expect(view).toBeVisible();
  await expect(view.locator('[data-testid="stream-target"]')).toHaveText(ORDERS_QUEUE);
  await expect(view.locator('[data-testid="stream-next"]')).toHaveCount(0);
  await expect(view.locator('[data-testid="stream-poll"]')).toBeVisible();
  await expect(view.locator('[data-testid="stream-poll-warning"]')).toContainText(
    'consumes messages',
  );
  await expect(view.locator('.no-rows')).toContainText('Click Poll to fetch messages');
  await expect(view.locator('[data-testid="stream-row"]')).toHaveCount(0);

  // --- Poll: fetches a real batch, populates the visibility-timeout badge and rows ---------------
  await view.locator('[data-testid="stream-poll"]').click();
  await expect(view.locator('[data-testid="stream-row"]').first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(view.locator('[data-testid="stream-visibility-timeout"]')).toContainText(
    /visibility \d+s/,
  );

  const firstRow = view.locator('[data-testid="stream-row"]').first();
  await expect(firstRow.locator('[data-testid="stream-key"]')).not.toHaveText('(none)');
  await expect(firstRow.locator('[data-testid="stream-headers"]')).toContainText('seed');
  await expect(firstRow.locator('[data-testid="stream-body"]')).toContainText('seq');

  // --- P43 iter2 F20/D27: a Poll clears the cell editor rather than leaving it showing the
  // previous batch's message body. ----------------------------------------------------------
  await firstRow.locator('[data-testid="stream-body"]').click();
  const streamCellEditorPanel = page.locator('[data-testid="cell-editor-panel"]');
  await expect(streamCellEditorPanel).toBeVisible();
  await view.locator('[data-testid="stream-poll"]').click();
  await expect(streamCellEditorPanel).toHaveCount(0);

  // --- row context menu: copy-key + copy-body, read-only -----------------------------------------
  await firstRow.click({ button: 'right' });
  const menu = page.locator('[data-testid="context-menu"]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-testid="menu-item-copy-key"]')).toBeVisible();
  await expect(menu.locator('[data-testid="menu-item-copy-body"]')).toBeVisible();
  await page.keyboard.press('Escape');

  // --- approximate count (sqsCaps.exactCount === false): the status line carries a "~" -----------
  await emptyQueueRow.dblclick();
  const emptyView = page.locator(`[data-testid="stream-view"][data-path="${EMPTY_QUEUE_PATH}"]`);
  await expect(emptyView).toBeVisible();
  await emptyView.locator('[data-testid="stream-count"]').click();
  await expect(emptyView.locator('[data-testid="stream-status"]')).toContainText('~0 total', {
    timeout: 10_000,
  });

  // --- SQS is read-only with no console (D13); Open definition is offered instead (P23 D9) -------
  await openRowMenu(page, ORDERS_QUEUE_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="menu-item-open-definition"]')).toBeVisible();

  // --- a queue's definition shows its attributes, no console button ------------------------------
  // (D9's "no message is received or made invisible by opening it" is verified at the adapter
  // level — tests/db/sqs.spec.ts scenario 6, against the queue's ApproximateNumberOfMessages
  // before/after — since that is where the actual SDK call this makes can be checked precisely.)
  await page.click('[data-testid="menu-item-open-definition"]');
  const queueDef = page.locator('[data-testid="definition-view"]');
  await expect(queueDef).toBeVisible();
  await expect(queueDef).toHaveAttribute('data-path', ORDERS_QUEUE_PATH);
  await expect(queueDef.locator('[data-testid="definition-open-console"]')).toHaveCount(0);
  const attributesSection = queueDef.locator(
    '[data-testid="definition-properties"][data-title="Attributes"]',
  );
  await expect(attributesSection).toBeVisible({ timeout: 10_000 });
  await expect(attributesSection.locator('.def-row')).not.toHaveCount(0);

  // --- P31 item 1: caps.describe is false for SQS, so opening (and refreshing) a queue's
  // definition tab must never issue a describe op or leave an error row behind (F1-F4). ---------
  const opsAfterQueueDef = await getOps(page);
  expect(opsAfterQueueDef.filter((o) => o.kind === 'describe')).toHaveLength(0);
  expect(opsAfterQueueDef.filter((o) => o.status === 'error')).toHaveLength(0);
  await queueDef.locator('[data-testid="definition-refresh"]').click();
  await expect(attributesSection).toBeVisible({ timeout: 10_000 });
  const opsAfterQueueRefresh = await getOps(page);
  expect(opsAfterQueueRefresh.filter((o) => o.kind === 'describe')).toHaveLength(0);
  expect(opsAfterQueueRefresh.filter((o) => o.status === 'error')).toHaveLength(0);

  expect(consoleErrors).toEqual([]);
});
