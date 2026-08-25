import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type RabbitMqFixture,
  startRabbitMq,
} from './support/rabbitmq';
import { expandRow, findRow, openRowMenu } from './support/tree';

// P37 D39: a small, deliberate subset of tests/ui/sqs.spec.ts — Docker-gated like every engine's
// UI spec except SQLite's own unconditional one (P35 D35). Its three load-bearing assertions are
// the seams where a missing branch fails silently rather than loudly: the queue tab never
// auto-loads and shows the requeue-worded warning strip (not SQS's "consumes" one), Poll renders
// the routing key in the key column, and the Delete-message button is absent (canDelete is
// permanently false here, unlike SQS).
test.describe.configure({ timeout: 240_000 });

let rabbitmq: RabbitMqFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  rabbitmq = await startRabbitMq();
});

test.afterAll(async () => {
  await rabbitmq?.stop();
});

test('rabbitmq — engine picker, connect, tree, poll (requeue warning), publish, exchange definition', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!rabbitmq) throw new Error('rabbitmq fixture did not start');
  const { window: page } = kira;
  const cfg = rabbitmq.config;
  const vhostPath = `database:${cfg.database}`;
  const ordersQueuePath = `${vhostPath}/queue:orders`;
  const exchangesFolderPath = `${vhostPath}#exchange`;
  const ordersExchangePath = `${vhostPath}/exchange:orders.direct`;

  // --- 1. the engine picker shows a real RabbitMQ tile, port prefilled to 15672 (D10) -----------
  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  const rabbitmqTile = page.locator('[data-testid="connection-kind-rabbitmq"]');
  await expect(rabbitmqTile).toBeVisible();
  const markHtml = await rabbitmqTile.locator('svg').innerHTML();
  expect(markHtml.trim().length).toBeGreaterThan(0);
  await rabbitmqTile.click();
  await expect(page.locator('[data-testid="connection-port"]')).toHaveValue('15672');

  await page.fill('[data-testid="connection-name"]', 'Test RabbitMQ');
  await page.fill('[data-testid="connection-host"]', cfg.host ?? '');
  await page.fill('[data-testid="connection-port"]', String(cfg.port ?? ''));
  await page.fill('[data-testid="connection-database"]', cfg.database ?? '');
  await page.fill('[data-testid="connection-username"]', cfg.username ?? '');
  await page.fill('[data-testid="connection-password"]', cfg.password ?? '');
  await page.click('[data-testid="color-blue"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  // --- 2. connecting shows the green dot and a RabbitMQ 4.x server version ----------------------
  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]').filter({
    hasText: 'Test RabbitMQ',
  });
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  const statusDot = connRow.locator('.status-dot');
  await expect(statusDot).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expect(statusDot).toHaveAttribute('data-kira-tip', /^RabbitMQ 4\./);

  // --- 3. the seeded vhost, queues ungrouped, an Exchanges folder, no default-exchange row -------
  await expandRow(page, '');
  const vhostRow = await expandRow(page, vhostPath);
  await expect(vhostRow).toHaveAttribute('data-kind', 'database');
  const ordersQueueRow = await findRow(page, ordersQueuePath);
  await expect(ordersQueueRow).toHaveAttribute('data-kind', 'queue');
  const exchangesFolder = await findRow(page, exchangesFolderPath);
  await expect(exchangesFolder).toBeVisible();
  await expect(exchangesFolder).toContainText('Exchanges');
  await exchangesFolder.locator('.twisty').click();
  const ordersExchangeRow = await findRow(page, ordersExchangePath);
  await expect(ordersExchangeRow).toHaveAttribute('data-kind', 'exchange');
  // D16: the nameless default exchange never appears as a row at all — its path segment would be
  // the empty string, "exchange:" with nothing after the colon.
  await expect(
    page.locator(`[data-testid="tree-row"][data-path="${vhostPath}/exchange:"]`),
  ).toHaveCount(0);

  await page.screenshot({ path: 'test-results/screenshots/rabbitmq.png' });

  // --- 4. opening the orders queue never auto-loads, and the warning strip mentions requeue, ----
  //        not "consumes" (D32) -------------------------------------------------------------------
  await ordersQueueRow.dblclick();
  const view = page.locator(`[data-testid="stream-view"][data-path="${ordersQueuePath}"]`);
  await expect(view).toBeVisible();
  await expect(view.locator('[data-testid="stream-target"]')).toHaveText('orders');
  await expect(view.locator('[data-testid="stream-next"]')).toHaveCount(0);
  await expect(view.locator('[data-testid="stream-poll"]')).toBeVisible();
  await expect(view.locator('[data-testid="stream-poll-warning"]')).toContainText('requeues');
  await expect(view.locator('[data-testid="stream-poll-warning"]')).not.toContainText('consumes');
  await expect(view.locator('.no-rows')).toContainText('Click Poll to fetch messages');
  await expect(view.locator('[data-testid="stream-row"]')).toHaveCount(0);

  // --- 5. Poll renders rows whose key column holds the routing key -------------------------------
  await view.locator('[data-testid="stream-poll"]').click();
  const firstRow = view.locator('[data-testid="stream-row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 15_000 });
  await expect(firstRow.locator('[data-testid="stream-key"]')).toHaveText('orders');
  await expect(firstRow.locator('[data-testid="stream-headers"]')).toContainText('seed');
  await expect(firstRow.locator('[data-testid="stream-body"]')).toContainText('seq');

  // --- 6. Add message publishes (routing key prefilled with the queue's own name); Delete -------
  //        message is absent (canDelete permanently false, D26/D32) ------------------------------
  await expect(view.locator('[data-testid="stream-delete-message"]')).toHaveCount(0);
  await view.locator('[data-testid="stream-add-message"]').click();
  const composePanel = page.locator('[data-testid="stream-add-message-panel"]');
  await expect(composePanel).toBeVisible();
  await composePanel.locator('[data-testid="stream-add-message-body"]').fill('hello from the UI');
  await composePanel.locator('[data-testid="stream-add-message-submit"]').click();
  await expect(composePanel).toHaveCount(0);
  await view.locator('[data-testid="stream-poll"]').click();
  await expect(
    view.locator('[data-testid="stream-row"]', { hasText: 'hello from the UI' }),
  ).toBeVisible({ timeout: 15_000 });

  // --- 7. an exchange's context menu offers Open definition and no Open data; the definition -----
  //        tab shows an Exchange section and a Bindings from this exchange section (D30/D33) ------
  await openRowMenu(page, ordersExchangePath);
  await expect(page.locator('[data-testid="menu-item-open-definition"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-open-data"]')).toHaveCount(0);
  await page.click('[data-testid="menu-item-open-definition"]');
  const exchangeDef = page.locator('[data-testid="definition-view"]');
  await expect(exchangeDef).toBeVisible();
  await expect(exchangeDef).toHaveAttribute('data-path', ordersExchangePath);
  const exchangeSection = exchangeDef.locator(
    '[data-testid="definition-properties"][data-title="Exchange"]',
  );
  await expect(exchangeSection).toBeVisible({ timeout: 10_000 });
  await expect(exchangeSection).toContainText('direct');
  const bindingsFromSection = exchangeDef.locator(
    '[data-testid="definition-properties"][data-title="Bindings from this exchange"]',
  );
  await expect(bindingsFromSection).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
