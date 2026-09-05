import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  ORDER_ITEMS_PATH,
  orderItemsFixture,
  postgresConnectionSummary,
} from './support/postgresFixture';
import { connectionRow, expandRow, findRow, openRowMenu } from './support/tree';

// P1 C9/§6.2: the mode seam, observed from outside. Studio's own connect/expand/open flow is
// ported straight from tabs.spec.ts's own createAndConnect (C1-C8 promise Studio's rendered
// output doesn't change) — what's new here is Http mode existing at all, and the five properties
// §6.2 names: two mode tabs; Http is genuinely empty with its own left-panel title; switching back
// restores Studio's tab untouched; switching mode writes nothing; the left panel's width survives;
// ⌘B still works in either mode.

const CONNECTION_ID = 'conn-mode-switch';
const FIXTURE = orderItemsFixture(CONNECTION_ID);
const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Mode DB', 'blue');

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Mode DB',
      kind: 'postgres',
      color: 'blue',
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
];

async function createAndConnect(page: import('@playwright/test').Page): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Mode DB');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
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
  await expandRow(page, 'database:kira_test');
  await expandRow(page, 'database:kira_test/schema:app');
}

function modeTab(page: import('@playwright/test').Page, mode: 'studio' | 'api') {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

test('mode switch — two mode tabs, an empty Http mode, and Studio state that survives the round trip', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({ control: CONTROL });

  // 1. two mode tabs, Studio active by default.
  await expect(page.locator('[data-testid="mode-tab"]')).toHaveCount(2);
  await expect(modeTab(page, 'studio')).toHaveClass(/is-active/);
  await expect(modeTab(page, 'api')).not.toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="project-panel"]')).toContainText('Connections');

  // Build a real Studio tab with non-default state (page size 1000) to prove it survives.
  await createAndConnect(page);
  const orderItemsRow = await findRow(page, ORDER_ITEMS_PATH);
  await orderItemsRow.dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await page.click('[data-testid="page-size-1000"]');
  await expect(page.locator('[data-testid="page-size-1000"]')).toHaveClass(/on/);

  const studioTab = page.locator('[data-testid="tab"]');
  await expect(studioTab).toHaveCount(1);
  const studioTabId = await studioTab.getAttribute('data-tab-id');

  const panelWidthBefore = (await page.locator('[data-testid="project-panel"]').boundingBox())
    ?.width;
  const tabsSaveCallsBeforeSwitch = control
    .log()
    .filter((entry) => entry.channel === IPC.tabsSave).length;

  // 2. clicking Http shows the empty tab-strip state and Http's own empty content, with the left
  //    panel no longer titled "Connections".
  await modeTab(page, 'api').click();
  await expect(modeTab(page, 'api')).toHaveClass(/is-active/);
  await expect(modeTab(page, 'studio')).not.toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="tab-strip-empty"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="api-start"]')).toBeVisible();
  await expect(page.locator('[data-testid="project-panel"]')).not.toContainText('Connections');
  await expect(page.locator('[data-testid="project-panel"]')).toContainText('Collections');

  // "mode switching writes nothing" (D5), observed: no tabsSave call happened just from the two
  // clicks above — clicking a mode tab is a plain selection, not a mutation.
  const tabsSaveCallsAfterSwitch = control
    .log()
    .filter((entry) => entry.channel === IPC.tabsSave).length;
  expect(tabsSaveCallsAfterSwitch).toBe(tabsSaveCallsBeforeSwitch);

  // 3. clicking Studio restores the same tab, still active, with its state intact.
  await modeTab(page, 'studio').click();
  await expect(modeTab(page, 'studio')).toHaveClass(/is-active/);
  const restoredTab = page.locator('[data-testid="tab"]');
  await expect(restoredTab).toHaveCount(1);
  await expect(restoredTab).toHaveAttribute('data-tab-id', studioTabId ?? '');
  await expect(restoredTab).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="page-size-1000"]')).toHaveClass(/on/);

  // 4. the left panel's width is preserved across the switch (D8: both modes share one width).
  const panelWidthAfter = (await page.locator('[data-testid="project-panel"]').boundingBox())
    ?.width;
  expect(panelWidthAfter).toBe(panelWidthBefore);

  // 5. ⌘B still collapses/expands the panel in either mode. There is no real Wails window in
  //    tests/ui to dispatch the native ⌘B menu accelerator through, so this drives the status
  //    bar's own toggle button — the exact same toggleProjectPanel() the accelerator itself
  //    invokes (App.vue's control.onToggleProjectPanel(toggleProjectPanel)).
  await page.click('[data-testid="toggle-project-panel"]');
  await expect(page.locator('[data-testid="project-panel"]')).toHaveCount(0);
  await page.click('[data-testid="toggle-project-panel"]');
  await expect(page.locator('[data-testid="project-panel"]')).toBeVisible();

  await modeTab(page, 'api').click();
  await page.click('[data-testid="toggle-project-panel"]');
  await expect(page.locator('[data-testid="project-panel"]')).toHaveCount(0);
  await page.click('[data-testid="toggle-project-panel"]');
  await expect(page.locator('[data-testid="project-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="project-panel"]')).toContainText('Collections');
});
