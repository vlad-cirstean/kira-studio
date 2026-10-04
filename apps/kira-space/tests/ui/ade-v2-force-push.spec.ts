import { expect, test } from './fixtures';
import { adeFixture, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';

// Force push: a branch rebased locally (`plan.unpushed`) offers it; the dialog names the repo.

interface BoardFx {
  plan: { unpushed: Record<string, boolean> };
}

function unpushedBoard(): BoardFx {
  const board = adeFixture<BoardFx>('board');
  board.plan.unpushed = { b_deps: true };
  return board;
}

test('asks first, names the repo and sends the branch', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: unpushedBoard() },
    { channel: IPC.adeTaskForcePush, response: adeFixture('force-push') },
  ]);
  await page.locator('[data-testid="ade-force-push"]').click();
  const dialog = page.locator('[data-testid="ade-confirm-dialog"]');
  await expect(dialog).toContainText('Force push chore/deps-bump (repo web-app) with lease?');
  expect(control.log().filter((e) => e.channel === IPC.adeTaskForcePush)).toHaveLength(0);
  await dialog.locator('[data-testid="ade-confirm-yes"]').click();
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.adeTaskForcePush))
    .toHaveLength(1);
  expect(control.log().find((e) => e.channel === IPC.adeTaskForcePush)?.args).toEqual({
    branchId: 'b_deps',
  });
  await expect(dialog).toHaveCount(0);
});

test('shows the backend error and keeps the dialog open', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: unpushedBoard() },
    {
      channel: IPC.adeTaskForcePush,
      response: {
        branchId: 'b_deps',
        error: { kind: 'stale-lease', message: 'remote has newer commits', remoteMessage: null },
      },
    },
  ]);
  await page.locator('[data-testid="ade-force-push"]').click();
  const dialog = page.locator('[data-testid="ade-confirm-dialog"]');
  await dialog.locator('[data-testid="ade-confirm-yes"]').click();
  await expect(dialog.locator('[data-testid="ade-confirm-error"]')).toContainText(
    'remote has newer commits',
  );
  await expect(dialog).toBeVisible();
});
