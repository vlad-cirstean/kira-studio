import { registerSmartScenarios } from '@workbench/testing/ui/scenarios/automationsSmart';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';

// P242 Part 2: smart scripts on the mocked bridge: the editor, the run dialog, the run tab.

registerSmartScenarios({ test, contract, ipc: IPC }, ({ BASE, openPanel }) => {
  test('the script editor has no worktree Switch in Studio', async ({ relaunch }) => {
    const { window: page } = await relaunch({ control: BASE });
    await openPanel(page);
    await page.locator('[data-testid="automations-add"]').click();
    await page.locator('[data-testid="menu-item-new-script"]').click();
    await expect(page.locator('[data-testid="script-dialog"]')).toBeVisible();
    await expect(page.locator('[data-testid="script-use-ade-dir"]')).toHaveCount(0);
  });
});
