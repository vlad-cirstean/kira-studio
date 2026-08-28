import { expect, test } from '../../e2e/fixtures';
import { connectionRow, expandRow, findRow, openRowMenu } from '../../e2e/support/tree';
import { installControlMocks } from '../support/mockControl';
import { installMockPort } from '../support/mockPort';
import type { ControlSnapshot } from '../support/types';
import { controlSnapshots, portSnapshots } from './rabbitmq.fixture';

// P50 §4.4 — rabbitmq's frontend half. The Add-Connection-dialog flow is left to
// tests/e2e/connections.spec.ts (kept, unchanged) — this spec starts from an already-listed
// connection.

interface TreeNodeLike {
  name: string;
  path: string;
  kind: string;
}

function nodePathByName(name: string, kind?: string): string {
  for (const snap of controlSnapshots as ControlSnapshot[]) {
    if (snap.channel !== 'kira:tree:children') continue;
    const nodes = (snap.response as { nodes?: TreeNodeLike[] } | undefined)?.nodes ?? [];
    const node = nodes.find((n) => n.name === name && (!kind || n.kind === kind));
    if (node) return node.path;
  }
  throw new Error(`no captured tree node named ${name} in rabbitmq.fixture.ts`);
}

const VHOST_PATH = nodePathByName('kira', 'database');
const ORDERS_QUEUE_PATH = nodePathByName('orders', 'queue');
const ORDERS_EXCHANGE_PATH = nodePathByName('orders.direct', 'exchange');

test('rabbitmq (frontend, mocked IPC) — tree, poll (requeue warning), publish, exchange definition', async ({
  kira,
  consoleErrors,
}) => {
  const { app, window: page } = kira;

  await installControlMocks(app, controlSnapshots);
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');
  await installMockPort(page, portSnapshots);

  const connRow = connectionRow(page);
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  const statusDot = connRow.locator('.status-dot');
  await expect(statusDot).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expect(statusDot).toHaveAttribute('data-kira-tip', /^RabbitMQ 4\./);

  await expandRow(page, '');
  const vhostRow = await expandRow(page, VHOST_PATH);
  await expect(vhostRow).toHaveAttribute('data-kind', 'database');
  const ordersQueueRow = await findRow(page, ORDERS_QUEUE_PATH);
  await expect(ordersQueueRow).toHaveAttribute('data-kind', 'queue');
  // D30/mysql's "Routines" precedent: "Exchanges" is a frontend-only grouping heading over the
  // real exchange-kind nodes the fixture carries.
  const exchangesFolder = page.locator('[data-testid="tree-row"]', { hasText: 'Exchanges' });
  await expect(exchangesFolder).toBeVisible();
  await exchangesFolder.locator('.twisty').click();

  // --- opening the orders queue never auto-loads; requeue warning, not "consumes" ------------
  await ordersQueueRow.dblclick();
  const view = page.locator(`[data-testid="stream-view"][data-path="${ORDERS_QUEUE_PATH}"]`);
  await expect(view).toBeVisible();
  await expect(view.locator('[data-testid="stream-target"]')).toHaveText('orders');
  await expect(view.locator('[data-testid="stream-next"]')).toHaveCount(0);
  await expect(view.locator('[data-testid="stream-poll"]')).toBeVisible();
  await expect(view.locator('[data-testid="stream-poll-warning"]')).toContainText('requeues');
  await expect(view.locator('[data-testid="stream-poll-warning"]')).not.toContainText('consumes');
  await expect(view.locator('.no-rows')).toContainText('Click Poll to fetch messages');
  await expect(view.locator('[data-testid="stream-row"]')).toHaveCount(0);

  // caps.maxPageSize (500) caps the picker to 10/100 — a frontend-only rendering of the caps
  // this connection's connectionsConnect response already carries.
  await expect(view.locator('[data-testid="stream-page-size-10"]')).toBeVisible();
  await expect(view.locator('[data-testid="stream-page-size-100"]')).toBeVisible();
  await expect(view.locator('[data-testid="stream-page-size-1000"]')).toHaveCount(0);
  await expect(view.locator('[data-testid="stream-page-size-10000"]')).toHaveCount(0);

  // --- Poll renders rows whose key column holds the routing key -----------------------------
  await view.locator('[data-testid="stream-poll"]').click();
  const firstRow = view.locator('[data-testid="stream-row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 15_000 });
  await expect(firstRow.locator('[data-testid="stream-key"]')).toHaveText('orders');

  // --- Delete message is absent (canDelete permanently false); Add message publishes --------
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

  // --- an exchange's context menu offers Open definition and no Open data --------------------
  await openRowMenu(page, ORDERS_EXCHANGE_PATH);
  await expect(page.locator('[data-testid="menu-item-open-definition"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-item-open-data"]')).toHaveCount(0);
  await page.click('[data-testid="menu-item-open-definition"]');
  const exchangeDef = page.locator('[data-testid="definition-view"]');
  await expect(exchangeDef).toBeVisible();
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
