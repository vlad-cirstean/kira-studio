import { expect, test } from '../ui/fixtures';
import { openPlan } from '../ui/support/adeV2';

// P437: the Sessions dropdown of a task, a stopped row highlighted.

test('sessions dropdown with a stopped row highlighted', async ({ relaunch }) => {
  const { window } = await openPlan(relaunch);
  await window.setViewportSize({ width: 1400, height: 900 });
  await window
    .locator('[data-testid="ade-card"][data-task-id="T_bill"] [data-testid="ade-card-head"]')
    .click();
  await window.locator('[data-testid="ade-panel-tab-sessions"]').click();
  await window.locator('[data-testid="ade-sessions-menu-trigger"]').click();
  const row = window.locator('[data-testid="ade-sessions-row"][data-session-id="sp11"]');
  await row.hover();
  await expect(row).toHaveAttribute('data-highlighted', '');
  await expect(window.locator('[data-testid="ade-sessions-menu-popover"]')).toHaveScreenshot(
    'ade-sessions-menu.png',
  );
});
