import type { Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from '../ui/fixtures';
import { IPC } from '../ui/support/ipcChannels';
import { DB_PATH, mariadbConnectionSummary, orderItemsFixture } from '../ui/support/mariadbFixture';
import { connectionRow, expandRow, openRowMenu } from '../ui/support/tree';

// v1.4 P6 (docs/v1.4/plans/P6-visual-regression.md §3.3): the SQL console at rest with
// syntax-highlighted content — CodeMirror's own decoration/theme layer has no existing pixel guard;
// console.spec.ts/console-format.spec.ts/console-explain.spec.ts all assert *behaviour* only.

const CONNECTION_ID = 'conn-visual-console';
const CONNECTION_SUMMARY = mariadbConnectionSummary(CONNECTION_ID, 'VisualConsole', 'blue');
const FIXTURE = orderItemsFixture(CONNECTION_ID);

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'VisualConsole',
      kind: 'mariadb',
      color: 'blue',
      mode: 'fields',
      readOnly: false,
      host: '127.0.0.1',
      port: 3306,
      database: 'kira_test',
      username: 'kira',
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
];

async function connectAndExpand(page: Page): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-mariadb"]');
  await page.fill('[data-testid="connection-name"]', 'VisualConsole');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '3306');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'kira');
  await page.click('[data-testid="color-blue"]');
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
}

const SAMPLE_QUERY = [
  '-- order totals by customer',
  'select customer_id, sum(quantity * unit_price) as total',
  'from order_items',
  "where status = 'shipped'",
  'group by customer_id',
  'order by total desc;',
].join('\n');

test('SQL console at rest with syntax-highlighted content (P6)', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });
  await connectAndExpand(page);

  await openRowMenu(page, DB_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  await view.locator('.cm-content').click();
  await page.keyboard.type(SAMPLE_QUERY);
  await expect(view.locator('.cm-content')).toContainText('order by total desc');

  await expect(page).toHaveScreenshot('console.png');
});
