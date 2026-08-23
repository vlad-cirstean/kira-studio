import type { Locator, Page } from '@playwright/test';
import {
  CONSUMER_GROUP,
  EMPTY_TOPIC,
  ORDERS_MESSAGE_COUNT,
  ORDERS_PARTITION_COUNT,
  ORDERS_TOPIC,
} from '../db/fixtures/0005_kafka_seed';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type KafkaFixture,
  startKafka,
} from './support/kafka';

// The fifth engine through the real UI (P10, mirrors redis.spec.ts's discipline for the fourth):
// stream-shaped pages, not tabular grids/documents/key-values, are the point of this spec — it
// proves StreamView.vue's offsetWindow auto-load/Next paging and the topic+consumerGroup tree
// against a live broker. SQS's batch/Poll half of P10 lives in sqs.spec.ts.
test.describe.configure({ timeout: 240_000 });

let kafka: KafkaFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  kafka = await startKafka();
});

test.afterAll(async () => {
  await kafka?.stop();
});

const ORDERS_TOPIC_PATH = `topic:${ORDERS_TOPIC}`;
const EMPTY_TOPIC_PATH = `topic:${EMPTY_TOPIC}`;
const CONSUMER_GROUP_PATH = `consumerGroup:${CONSUMER_GROUP}`;
const ORDERS_PARTITION_0_PATH = `${ORDERS_TOPIC_PATH}/partition:0`;

function treeContainer(page: Page): Locator {
  return page.locator('[data-testid="tree-background"] .virtual-list');
}

async function findRow(page: Page, path: string): Promise<Locator> {
  const container = treeContainer(page);
  const target = page.locator(`[data-testid="tree-row"][data-path="${path}"]`);
  await container.evaluate((el) => {
    el.scrollTop = 0;
  });
  for (let i = 0; i < 80; i++) {
    if ((await target.count()) > 0) return target;
    const atBottom = await container.evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    );
    if (atBottom) break;
    await container.evaluate((el) => {
      el.scrollTop += Math.max(200, el.clientHeight);
    });
    await page.waitForTimeout(30);
  }
  return target;
}

async function expandRow(page: Page, path: string): Promise<Locator> {
  const row = await findRow(page, path);
  await expect(row).toBeVisible();
  await row.locator('.twisty').click();
  await expect(row.locator('.twisty .spin')).toHaveCount(0, { timeout: 15_000 });
  return row;
}

async function openRowMenu(page: Page, path: string): Promise<void> {
  const row = await findRow(page, path);
  await row.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
}

test('kafka — connect, tree, stream tab (offsetWindow), console-free', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!kafka) throw new Error('kafka fixture did not start');
  const { window: page } = kira;

  const cfg = kafka.config;
  await page.evaluate(
    (c) =>
      window.kira.connectionsCreate({
        name: 'Kafka',
        kind: 'kafka',
        color: 'orange',
        mode: 'fields',
        readOnly: false,
        host: c.host,
        port: c.port,
        database: c.database,
        username: c.username,
        password: c.password,
        uri: null,
        options: {},
        preconnect: null,
        preconnectSidecar: false,
      }),
    {
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      username: cfg.username,
      password: cfg.password,
    },
  );

  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });

  // --- tree: topics and consumer groups are root-level siblings (P10's design) -----------------
  await expandRow(page, '');
  const emptyTopicRow = await findRow(page, EMPTY_TOPIC_PATH);
  await expect(emptyTopicRow).toBeVisible();
  await expect(emptyTopicRow).toHaveAttribute('data-kind', 'topic');
  const ordersTopicRow = await findRow(page, ORDERS_TOPIC_PATH);
  await expect(ordersTopicRow).toBeVisible();
  await expect(ordersTopicRow).toHaveAttribute('data-kind', 'topic');
  const groupRow = await findRow(page, CONSUMER_GROUP_PATH);
  await expect(groupRow).toBeVisible();
  await expect(groupRow).toHaveAttribute('data-kind', 'consumerGroup');

  // --- partitions nest under the topic, not the consumer group ---------------------------------
  await expandRow(page, ORDERS_TOPIC_PATH);
  const partition0Row = await findRow(page, ORDERS_PARTITION_0_PATH);
  await expect(partition0Row).toBeVisible();
  await expect(partition0Row).toHaveAttribute('data-kind', 'partition');
  const partitionRows = page.locator(
    `[data-testid="tree-row"][data-path^="${ORDERS_TOPIC_PATH}/partition:"]`,
  );
  await expect(partitionRows).toHaveCount(ORDERS_PARTITION_COUNT);

  await page.screenshot({ path: 'test-results/screenshots/kafka.png' });

  // --- open the orders topic: offsetWindow auto-loads on mount, no Poll button needed ----------
  await ordersTopicRow.dblclick();
  const view = page.locator(`[data-testid="stream-view"][data-path="${ORDERS_TOPIC_PATH}"]`);
  await expect(view).toBeVisible();
  await expect(view.locator('[data-testid="stream-target"]')).toHaveText(ORDERS_TOPIC);
  await expect(view.locator('[data-testid="stream-poll"]')).toHaveCount(0);
  await expect(view.locator('[data-testid="stream-row"]')).toHaveCount(ORDERS_MESSAGE_COUNT, {
    timeout: 15_000,
  });
  await expect(view.locator('[data-testid="stream-next"]')).toBeDisabled();

  const firstRow = view.locator('[data-testid="stream-row"]').first();
  await expect(firstRow.locator('[data-testid="stream-key"]')).toHaveText(/^key-\d$/);
  await expect(firstRow.locator('[data-testid="stream-headers"]')).toContainText('seed');
  await expect(firstRow.locator('[data-testid="stream-body"]')).toContainText('seq');

  // --- row context menu: copy-key + copy-body, read-only (no delete/edit anywhere) -------------
  await firstRow.click({ button: 'right' });
  const menu = page.locator('[data-testid="context-menu"]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-testid="menu-item-copy-key"]')).toBeVisible();
  await expect(menu.locator('[data-testid="menu-item-copy-body"]')).toBeVisible();
  await page.keyboard.press('Escape');

  // --- exact count (kafkaCaps.exactCount): no "~" prefix in the status line --------------------
  await view.locator('[data-testid="stream-count"]').click();
  await expect(view.locator('[data-testid="stream-status"]')).toContainText(
    `${ORDERS_MESSAGE_COUNT} total`,
    { timeout: 10_000 },
  );
  await expect(view.locator('[data-testid="stream-status"]')).not.toContainText('~');

  // --- an empty topic renders the placeholder, not an error -------------------------------------
  await emptyTopicRow.dblclick();
  const emptyView = page.locator(`[data-testid="stream-view"][data-path="${EMPTY_TOPIC_PATH}"]`);
  await expect(emptyView).toBeVisible();
  await expect(emptyView.locator('[data-testid="stream-row"]')).toHaveCount(0, { timeout: 15_000 });
  await expect(emptyView.locator('.no-rows')).toContainText('No messages');

  // --- consumer groups/partitions are browse-only leaves — Kafka has no console (D13) -----------
  await openRowMenu(page, CONSUMER_GROUP_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  expect(consoleErrors).toEqual([]);
});
