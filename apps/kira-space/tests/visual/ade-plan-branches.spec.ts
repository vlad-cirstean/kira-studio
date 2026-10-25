import { expect, test } from '../ui/fixtures';
import { adeBoard, openPlan } from '../ui/support/adeV2';
import { IPC } from '../ui/support/ipcChannels';

// P355: branch chips on the Plan board and branch panel.

const card = (id: string) => `[data-testid="ade-card"][data-task-id="${id}"]`;

test('plan branch chips and branch panel', async ({ relaunch }) => {
  const board = adeBoard((b) => {
    const auth = b.branches.find((x) => x.id === 'b_auth');
    if (!auth) throw new Error('fixture branch missing');
    auth.basePendingFrom = 'develop';
  });
  const { window } = await openPlan(relaunch, [{ channel: IPC.adeTaskBoard, response: board }]);
  await window.setViewportSize({ width: 1400, height: 900 });
  await expect(window.locator(card('T_search'))).toHaveScreenshot('plan-branches-stacked.png');
  await expect(window.locator(card('R_li'))).toHaveScreenshot('plan-branches-review.png');
  await expect(window.locator(card('T_auth'))).toHaveScreenshot('plan-branches-pending.png');
  await window.locator('[data-testid="ade-branch-row"][data-branch-id="b_search"]').click();
  await expect(window.locator('[data-testid="ade-branch-details"]')).toHaveScreenshot(
    'branch-panel-details.png',
  );
});
