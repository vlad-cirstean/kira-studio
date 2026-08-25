import type { Page } from '@playwright/test';
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
import { expandRow, findRow, openRowMenu } from './support/tree';

// The fifth engine through the real UI (P10, mirrors redis.spec.ts's discipline for the fourth):
// stream-shaped pages, not tabular grids/documents/key-values, are the point of this spec — it
// proves StreamView.vue's offsetWindow auto-load/Next paging and the topic+consumerGroup tree
// against a live broker. SQS's batch/Poll half of P10 lives in sqs.spec.ts.
// 0005_kafka_seed.ts's exec()-based seed retries its first admin call to cover a narrow gap between
// the broker's listener port opening and its self-managed KRaft metadata quorum actually being
// ready to serve admin calls — each retry can itself take a beat (the CLI's own connection backoff)
// before giving up, so this budget has room for a few of those on top of container start.
test.describe.configure({ timeout: 300_000 });

let kafka: KafkaFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(300_000);
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

function getOps(page: Page): Promise<{ id: string; kind: string; status: string }[]> {
  return page.evaluate(() => window.kira.opsRecent({ limit: 1000 }));
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

  // --- tree: topics stay at the root, ungrouped, same as SQL tables (P23 D1 revised) — only the
  // auxiliary consumer-group kind folders ------------------------------------------------------
  await expandRow(page, '');
  const emptyTopicRow = await findRow(page, EMPTY_TOPIC_PATH);
  await expect(emptyTopicRow).toBeVisible();
  await expect(emptyTopicRow).toHaveAttribute('data-kind', 'topic');
  const ordersTopicRow = await findRow(page, ORDERS_TOPIC_PATH);
  await expect(ordersTopicRow).toBeVisible();
  await expect(ordersTopicRow).toHaveAttribute('data-kind', 'topic');
  const groupsFolder = await findRow(page, '#consumerGroup');
  await expect(groupsFolder).toBeVisible();
  await expect(groupsFolder).toHaveAttribute('data-kind', 'group');
  await expect(groupsFolder).toContainText('Consumer groups');

  // P19 D1-D3's own acceptance bar: expanding a folder is a pure render over already-fetched
  // children — zero IPC calls, zero op-log rows, asserted rather than assumed.
  const opsBeforeFolderExpand = await getOps(page);
  await groupsFolder.locator('.twisty').click();
  const groupRow = await findRow(page, CONSUMER_GROUP_PATH);
  await expect(groupRow).toBeVisible();
  await expect(groupRow).toHaveAttribute('data-kind', 'consumerGroup');
  expect(await getOps(page)).toHaveLength(opsBeforeFolderExpand.length);

  // --- P23 D3: a topic no longer expands — its twisty is hidden, no partition rows exist --------
  await expect(ordersTopicRow.locator('.twisty')).not.toBeVisible();
  const partitionRows = page.locator(
    `[data-testid="tree-row"][data-path^="${ORDERS_TOPIC_PATH}/partition:"]`,
  );
  await expect(partitionRows).toHaveCount(0);

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

  // --- P23 F4/D4: the partition filter still reads children() even though the tree no longer
  // does — this is the single most important regression check in this phase.
  await view.locator('[data-testid="stream-filter-partition"]').click();
  const partitionMenu = page.locator('[data-testid="stream-partition-menu"]');
  await expect(partitionMenu).toBeVisible();
  await expect(partitionMenu.locator('.partition-option')).toHaveCount(ORDERS_PARTITION_COUNT);
  await partitionMenu.locator('[data-testid="stream-filter-partition-option-0"]').click();
  await expect(view.locator('[data-testid="stream-row"]')).not.toHaveCount(ORDERS_MESSAGE_COUNT, {
    timeout: 10_000,
  });
  // Clear the filter again — the scenarios below assume the topic's full message set.
  await partitionMenu.locator('[data-testid="stream-filter-partition-option-0"]').click();
  await expect(view.locator('[data-testid="stream-row"]')).toHaveCount(ORDERS_MESSAGE_COUNT, {
    timeout: 10_000,
  });
  await page.keyboard.press('Escape');

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

  // --- Kafka has no console (D13); a consumer group's menu now offers Open definition (P23 D7) --
  await openRowMenu(page, CONSUMER_GROUP_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="menu-item-open-definition"]')).toBeVisible();
  await page.keyboard.press('Escape');

  // --- P23: a topic's definition shows Partitions + Configuration, no console button ------------
  await openRowMenu(page, ORDERS_TOPIC_PATH);
  await page.click('[data-testid="menu-item-open-definition"]');
  const topicDef = page.locator('[data-testid="definition-view"]');
  await expect(topicDef).toBeVisible();
  await expect(topicDef).toHaveAttribute('data-path', ORDERS_TOPIC_PATH);
  await expect(topicDef.locator('[data-testid="definition-open-console"]')).toHaveCount(0);
  const partitionsSection = topicDef.locator(
    '[data-testid="definition-properties"][data-title="Partitions"]',
  );
  await expect(partitionsSection).toBeVisible({ timeout: 10_000 });
  await expect(partitionsSection.locator('.def-row')).toHaveCount(ORDERS_PARTITION_COUNT);
  const configSection = topicDef.locator(
    '[data-testid="definition-properties"][data-title="Configuration"]',
  );
  await expect(configSection).toBeVisible();
  // kafka/definition.ts (P32 D14/F11): this client has no describeConfigs call (not on the compat
  // Admin, not on the native AdminClient) — the section stays, rendered empty, with a note on the
  // Source pane explaining why, rather than failing the whole tab over one missing capability.
  await expect(configSection.locator('.def-row')).toHaveCount(0);

  // --- P31 item 1: caps.describe is false for Kafka, so opening (and refreshing) a topic's
  // definition tab must never issue a describe op or leave an error row behind (F1-F4). ---------
  const opsAfterTopicDef = await getOps(page);
  expect(opsAfterTopicDef.filter((o) => o.kind === 'describe')).toHaveLength(0);
  expect(opsAfterTopicDef.filter((o) => o.status === 'error')).toHaveLength(0);
  await topicDef.locator('[data-testid="definition-refresh"]').click();
  await expect(partitionsSection).toBeVisible({ timeout: 10_000 });
  const opsAfterTopicRefresh = await getOps(page);
  expect(opsAfterTopicRefresh.filter((o) => o.kind === 'describe')).toHaveLength(0);
  expect(opsAfterTopicRefresh.filter((o) => o.status === 'error')).toHaveLength(0);

  // --- a consumer group's definition shows Group/Members/Committed offsets -----------------------
  await openRowMenu(page, CONSUMER_GROUP_PATH);
  await page.click('[data-testid="menu-item-open-definition"]');
  const groupDef = page.locator('[data-testid="definition-view"]');
  await expect(groupDef).toBeVisible();
  await expect(groupDef).toHaveAttribute('data-path', CONSUMER_GROUP_PATH);
  const offsetsSection = groupDef.locator(
    '[data-testid="definition-properties"][data-title="Committed offsets"]',
  );
  await expect(offsetsSection).toBeVisible({ timeout: 10_000 });
  await expect(offsetsSection.locator('.def-row')).toHaveCount(ORDERS_PARTITION_COUNT);

  const opsAfterGroupDef = await getOps(page);
  expect(opsAfterGroupDef.filter((o) => o.kind === 'describe')).toHaveLength(0);
  expect(opsAfterGroupDef.filter((o) => o.status === 'error')).toHaveLength(0);

  expect(consoleErrors).toEqual([]);
});
