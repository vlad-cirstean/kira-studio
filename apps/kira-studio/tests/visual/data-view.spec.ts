import type { Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from '../ui/fixtures';
import { IPC } from '../ui/support/ipcChannels';
import {
  DB_PATH,
  mariadbConnectionSummary,
  ORDER_ITEMS_PATH,
  orderItemsFixture,
} from '../ui/support/mariadbFixture';
import { connectionRow, expandRow, findRow, openRowMenu } from '../ui/support/tree';

// v1.4 P6 (docs/v1.4/plans/P6-visual-regression.md §3.2): the data grid at rest on a small,
// representative table — mixed column types, no scroll/edit in progress. Same boot shape
// font-roles.spec.ts's own connectAndOpenGrid already established (a handful of rows, not the
// heavier 1M-row postgres fixture data-view.spec.ts's own interaction tests use — this spec only
// needs one stable rendered frame, not real pagination).

const CONNECTION_ID = 'conn-visual-data-view';
const CONNECTION_SUMMARY = mariadbConnectionSummary(CONNECTION_ID, 'VisualDataView', 'amber');
const FIXTURE = orderItemsFixture(CONNECTION_ID);

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'VisualDataView',
      kind: 'mariadb',
      color: 'amber',
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

async function connectAndOpenGrid(page: Page): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-mariadb"]');
  await page.fill('[data-testid="connection-name"]', 'VisualDataView');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '3306');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'kira');
  await page.click('[data-testid="color-amber"]');
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
  await expandRow(page, DB_PATH);

  const row = await findRow(page, ORDER_ITEMS_PATH);
  await row.dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]').first()).toBeVisible({ timeout: 15_000 });
}

test('data grid at rest (P6)', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });
  await connectAndOpenGrid(page);

  await expect(page).toHaveScreenshot('data-grid.png');
});
