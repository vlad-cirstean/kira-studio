import { expect, test } from '../ui/fixtures';
import { IPC } from '../ui/support/ipcChannels';

// v1.4 P6 (docs/v1.4/plans/P6-visual-regression.md §3.4): the three-tab connection dialog at rest
// — the densest single "form" surface in the app, most token/spacing/icon-alignment area per
// pixel. Mirrors connection-dialog-tabs.spec.ts's own opening sequence, which asserts tab-switch
// behaviour only, never how any of the three tabs actually renders.

test('connection dialog at rest, General tab (P6)', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });

  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Visual Connection Dialog');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'testdb');
  await page.fill('[data-testid="connection-username"]', 'testuser');

  await expect(page.locator('[data-testid="connection-tab-general"]')).toHaveClass(/is-active/);
  await expect(page).toHaveScreenshot('connection-dialog.png');
});
