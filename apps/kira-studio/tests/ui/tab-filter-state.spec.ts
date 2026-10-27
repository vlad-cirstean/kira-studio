import { DATA_OP } from '@shared/protocol/dataOps';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { connectAndExpand, connectionCreateArgs } from './support/connect';
import { acceptConfirm } from './support/dialogs';
import { IPC } from './support/ipcChannels';
import type { StudioPortSnapshot } from './support/mockStream';
import {
  BIG_ROWS_PATH,
  bigRowsFixture,
  NULLS_AND_UNICODE_PAGE,
  NULLS_META,
  NULLS_PATH,
  postgresConnectionSummary,
} from './support/postgresFixture';
import { readOnlySqsSnapshots, SQS_QUEUE_PATH } from './support/sqsFixture';
import { connectionRow, expandRow, findRow, openRowMenu } from './support/tree';

// P375: tab views unmount on switch; filter inputs and filtered results live in per-tab runtime
// stores, so switching away and back restores them. Frontend half only: no IPC change.

const CONNECTION_ID = 'conn-tab-filter';
const FIXTURE = bigRowsFixture(CONNECTION_ID);

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: connectionCreateArgs('Tab Filter DB', 'green'),
    response: postgresConnectionSummary(CONNECTION_ID, 'Tab Filter DB', 'green'),
  },
  ...FIXTURE.control,
  {
    channel: IPC.treeDescribe,
    args: { connectionId: CONNECTION_ID, path: NULLS_PATH, refresh: false, tabId: null },
    response: { meta: NULLS_META, source: 'server' },
  },
];

const PORT: StudioPortSnapshot[] = [
  ...FIXTURE.port,
  {
    op: DATA_OP.read,
    payload: {
      connectionId: CONNECTION_ID,
      path: NULLS_PATH,
      projection: null,
      filter: null,
      sort: null,
      pageSize: 100,
      cursor: { mode: 'offset', offset: 0 },
    },
    response: { kind: 'read', page: NULLS_AND_UNICODE_PAGE, source: 'server' },
  },
];

test('grid find: query, options and filtered rows survive a tab switch; closing clears them', async ({
  relaunch,
}) => {
  test.setTimeout(90_000);
  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await connectAndExpand(page, 'Tab Filter DB', 'green');

  const tabs = page.locator('[data-testid="tab"]');
  await (await findRow(page, BIG_ROWS_PATH)).dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await (await findRow(page, NULLS_PATH)).dblclick();
  await expect(tabs).toHaveCount(2);

  await tabs.nth(0).click();
  await page.click('[data-testid="toolbar-search"]');
  await page.click('[data-testid="search-regex"]');
  await page.fill('[data-testid="search-input"]', '^(2|5|9)$');
  await expect(page.locator('[data-testid="search-count"]')).toContainText('1 of 3');
  await page.click('[data-testid="search-filter-rows"]');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(3);

  await tabs.nth(1).click();
  await expect(page.locator('[data-testid="search-bar"]')).toHaveCount(0);
  await tabs.nth(0).click();

  await expect(page.locator('[data-testid="search-input"]')).toHaveValue('^(2|5|9)$');
  await expect(page.locator('[data-testid="search-regex"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('[data-testid="search-filter-rows"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('[data-testid="search-count"]')).toContainText('1 of 3');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(3);
  await expect(page.locator('[data-testid="search-scope"]')).toContainText(
    'Showing 3 of 100 loaded rows',
  );

  // Esc closes: rows return and the next open starts empty.
  await page.press('[data-testid="search-input"]', 'Escape');
  await expect(page.locator('[data-testid="search-bar"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="grid-gutter-cell"]').nth(9)).toBeVisible();
  await page.click('[data-testid="toolbar-search"]');
  await expect(page.locator('[data-testid="search-input"]')).toHaveValue('');
  await expect(page.locator('[data-testid="search-filter-rows"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  // Closing the tab drops the state: a reopened table starts with the bar closed.
  await page.fill('[data-testid="search-input"]', '7');
  await page.click('[data-testid="search-filter-rows"]');
  await tabs.nth(0).hover();
  await tabs.nth(0).locator('[data-testid="tab-close"]').click();
  await expect(tabs).toHaveCount(1);
  await (await findRow(page, BIG_ROWS_PATH)).dblclick();
  await expect(tabs).toHaveCount(2);
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="search-bar"]')).toHaveCount(0);
  await page.click('[data-testid="toolbar-search"]');
  await expect(page.locator('[data-testid="search-input"]')).toHaveValue('');
  await expect(page.locator('[data-testid="search-filter-rows"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('stream find: query and filtered rows survive a tab switch', async ({ relaunch }) => {
  test.setTimeout(90_000);
  const { control, stream: port } = readOnlySqsSnapshots([1]);
  const { window: page } = await relaunch({ control, stream: port });
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connectionRow(page).locator('.status-dot')).toHaveAttribute(
    'data-status',
    'connected',
    { timeout: 10_000 },
  );
  await expandRow(page, '');

  const tabs = page.locator('[data-testid="tab"]');
  await (await findRow(page, SQS_QUEUE_PATH)).dblclick();
  await page.click('[data-testid="stream-poll"]');
  await acceptConfirm(page);
  await expect(page.locator('[data-testid="stream-row"]').first()).toBeVisible({ timeout: 15_000 });
  await (await findRow(page, 'queue:empty-queue')).dblclick();
  await expect(tabs).toHaveCount(2);

  await tabs.nth(0).click();
  await page.click('[data-testid="stream-search-toggle"]');
  await page.fill('[data-testid="stream-search-input"]', 'msg-1');
  await expect(page.locator('[data-testid="stream-search-count"]')).toContainText('1 of 1');
  await page.click('[data-testid="stream-search-filter-rows"]');
  await expect(page.locator('[data-testid="stream-row"]')).toHaveCount(1);

  await tabs.nth(1).click();
  await expect(page.locator('[data-testid="stream-search-input"]')).toHaveCount(0);
  await tabs.nth(0).click();

  await expect(page.locator('[data-testid="stream-search-input"]')).toHaveValue('msg-1');
  await expect(page.locator('[data-testid="stream-search-filter-rows"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('[data-testid="stream-search-count"]')).toContainText('1 of 1');
  await expect(page.locator('[data-testid="stream-row"]')).toHaveCount(1);
});
