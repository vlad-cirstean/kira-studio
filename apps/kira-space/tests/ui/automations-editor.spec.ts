import { registerEditorScenarios } from '@workbench/testing/ui/scenarios/automationsEditor';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';

// P254: the three-tab script editor on the mocked bridge. Backend half: termflow
// TestScriptEditorSave stores the contract script-editor fixtures. Shared scenarios live in the
// workbench; only the ADE built-ins differ per app.

registerEditorScenarios(
  { test, contract, ipc: IPC },
  ({ COMMON, command, dialog, openNew, suggestions, typeBody }) => {
    test('Space offers the ADE built-ins', async ({ relaunch }) => {
      const { window: page } = await relaunch({
        control: [
          ...COMMON,
          { channel: IPC.customScriptsList, response: { collections: [], scripts: [] } },
        ],
      });
      await openNew(page, 'new-smart-script');
      await typeBody(page, 'Fix {ta');
      await expect(suggestions(page)).toContainText('task');
      await command(page).press('Tab');
      await expect(command(page)).toHaveValue('Fix {task}');
      await dialog(page).locator('[data-testid="script-dialog-cancel"]').click();

      await openNew(page, 'new-script');
      await typeBody(page, 'echo $KIRA_T');
      await expect(suggestions(page)).toContainText('KIRA_TASK');
    });
  },
);
