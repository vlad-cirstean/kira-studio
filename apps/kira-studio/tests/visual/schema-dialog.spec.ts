import type { Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from '../ui/fixtures';
import { IPC } from '../ui/support/ipcChannels';
import { orderItemsFixture, postgresConnectionSummary } from '../ui/support/postgresFixture';
import { connectionRow, openRowMenu } from '../ui/support/tree';

// v1.4 P6 (docs/v1.4/plans/P6-visual-regression.md §3.5): the Schema (DDL) editor at rest — P3/P4
// this chapter both touched this surface's own formatting/completion; a pixel baseline is cheap
// insurance against a future edit silently regressing its layout. Mirrors sql-schema.spec.ts's own
// connectAndExpandPostgres + "menu-item-schema" opening sequence.

const CONNECTION_ID = 'conn-visual-schema-dialog';
const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Visual Schema', 'green');

function postgresCreateArgs(name: string, color: string) {
  return {
    name,
    kind: 'postgres',
    color,
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
  };
}

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: postgresCreateArgs('Visual Schema', 'green'),
    response: CONNECTION_SUMMARY,
  },
  ...orderItemsFixture(CONNECTION_ID).control,
];

async function connectAndExpandPostgres(page: Page): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Visual Schema');
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
}

test('Schema (DDL) editor at rest (P6)', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: CONTROL });
  await connectAndExpandPostgres(page);

  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-schema"]');
  const dialog = page.locator('[data-testid="schema-dialog"]');
  await expect(dialog).toBeVisible();

  await expect(page).toHaveScreenshot('schema-dialog.png');
});
