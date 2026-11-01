import { expect, test } from '../ui/fixtures';
import { modeTab } from '../ui/support/apiMode';
import { contract } from '../ui/support/contract';
import { IPC } from '../ui/support/ipcChannels';
import { settleFonts } from './support/settle';

// P133 §5.2: the moved successor of settings.spec.ts's own dropped Scripts-pane baseline --
// full script editing now lives in ScriptDialog.vue, opened from the Automations module.

test('script dialog, empty state (P133)', async ({ kira }) => {
  const { window } = kira;
  await modeTab(window, 'automations').click();
  await window.click('[data-testid="automations-add"]');
  await window.click('[data-testid="menu-item-new-script"]');
  await expect(window.locator('[data-testid="script-dialog"]')).toBeVisible();
  await expect(window.locator('[data-testid="script-dialog"]')).toHaveScreenshot(
    'script-dialog.png',
  );
});

// P441: the Runs restore dialog on the shared design: ready, needs-input and already-running rows.
test('runs restore dialog', async ({ relaunch }) => {
  const pending = contract<{ items: Record<string, unknown>[] }>(
    'runs-restore',
    'ScriptRunsService.RestoreState#pending',
  );
  const offer = {
    items: pending.items.map((i) =>
      i.scriptName === 'param'
        ? { ...i, status: 'running', reason: 'param is already running.' }
        : i,
    ),
  };
  const { window } = await relaunch({
    control: [
      { channel: IPC.scriptRunsList, response: [] },
      { channel: IPC.scriptRunsRestoreState, response: offer },
    ],
  });
  await window.setViewportSize({ width: 1400, height: 900 });
  await modeTab(window, 'automations').click();
  await window.click('[data-testid="runs-restore-review"]');
  const dialog = window.locator('[data-testid="restore-dialog"]');
  await expect(dialog).toBeVisible();
  await window.click('[data-testid="restore-unavailable-toggle"]');
  await expect(window.locator('[data-testid="restore-unavailable"]')).toContainText('param');
  await settleFonts(window);
  await expect(dialog).toHaveScreenshot('runs-restore-dialog.png');
});
