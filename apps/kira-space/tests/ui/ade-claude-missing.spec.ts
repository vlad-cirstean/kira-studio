import { expect, test } from './fixtures';
import { adeFixture, openPlan } from './support/adeV2';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';

// Contract ade-claude-missing. Backend half: adeflow TestLaunchWithoutClaude.
test('contract: launching a step without the claude CLI shows the install message', async ({
  relaunch,
}) => {
  const failure = contract<{ code: string; message: string }>(
    'ade-claude-missing',
    'AdeTaskService.LaunchStep#claudeMissing',
  );
  expect(failure.message).toContain('Claude Code CLI not found');
  const sessions = adeFixture<{ sessions: { id: string }[] }>('sessions');
  const { window: page } = await openPlan(relaunch, [
    {
      channel: IPC.adeTaskSessions,
      response: { ...sessions, sessions: sessions.sessions.filter((s) => s.id !== '9ab0') },
    },
    { channel: IPC.adeTaskLaunchStep, error: failure },
  ]);
  await page
    .locator(
      '[data-testid="ade-task"][data-task-id="T_auth"] [data-testid="ade-task-action-session"]',
    )
    .click();
  await page.locator('[data-testid="ade-dialog-send"]').click();
  await expect(page.locator('[data-testid="ade-dialog-error"]')).toContainText(failure.message);
});
