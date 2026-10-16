import { registerEditorScenarios } from '@workbench/testing/ui/scenarios/automationsEditor';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';

// P254: the three-tab script editor on the mocked bridge. Backend half: termflow
// TestScriptEditorSave stores the contract script-editor fixtures. Shared scenarios live in the
// workbench; only the ADE built-ins differ per app.

registerEditorScenarios(
  { test, contract, ipc: IPC },
  ({ COMMON, dialog, openNew, suggestions, typeBody }) => {
    test('Studio offers no ADE built-ins', async ({ relaunch }) => {
      const { window: page } = await relaunch({
        control: [
          ...COMMON,
          { channel: IPC.customScriptsList, response: { collections: [], scripts: [] } },
        ],
      });
      await openNew(page, 'new-smart-script');
      await typeBody(page, 'Fix {ta');
      await expect(suggestions(page)).toHaveCount(0);
      await dialog(page).locator('[data-testid="script-dialog-tab-script"]').click();
      await typeBody(page, 'Fix {');
      await expect(suggestions(page)).toHaveCount(0);
    });
  },
);
