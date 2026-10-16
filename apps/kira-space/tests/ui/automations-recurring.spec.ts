import { registerRecurringScenarios } from '@workbench/testing/ui/scenarios/automationsRecurring';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';

// P242 Part 4: recurring scripts on the mocked bridge: the editor's schedule, rows, the confirm popup.

registerRecurringScenarios(
  { test, contract, ipc: IPC },
  {
    product: 'Kira Space',
    extraBase: [{ channel: IPC.windowsEnsure, response: { mode: 'git' } }],
    scheduleWhere: true,
  },
  ({ BASE, SCRIPT, dialog, openPanel }) => {
    test('contract: the editor targets an ADE task through the task picker', async ({
      relaunch,
    }) => {
      const adePreview = contract<{ needs: { tasks: { id: string; title: string }[] } }>(
        'schedule-task-picker',
        'ScriptRunsService.Preview#list-tasks',
      );
      const sent = contract<{ fields: { schedule: { taskId: string } } }>(
        'schedule-task-picker',
        'args:CustomScriptsService.Update#task',
      );
      const picked = adePreview.needs.tasks[0];
      expect(picked?.id).toBe(sent.fields.schedule.taskId);
      const { window: page, control } = await relaunch({
        control: [
          ...BASE,
          { channel: IPC.scriptRunsPreview, response: adePreview },
          { channel: IPC.customScriptsUpdate, response: SCRIPT },
        ],
      });
      await openPanel(page);
      await page.locator(`[data-testid="script-${SCRIPT.id}"]`).click({ button: 'right' });
      await page.locator('[data-testid="menu-item-edit-schedule"]').click();
      await dialog(page).locator('[data-testid="schedule-where-task"]').click();
      await dialog(page).locator('[data-testid="run-task"]').click();
      await page.locator(`[data-testid="run-task-option-${picked?.id}"]`).click();
      await dialog(page).locator('[data-testid="script-dialog-save"]').click();
      await expect
        .poll(() => control.log().find((e) => e.channel === IPC.customScriptsUpdate)?.args)
        .toMatchObject({
          id: SCRIPT.id,
          fields: { schedule: { taskId: sent.fields.schedule.taskId } },
        });
    });

    test('contract: an unsaved script asks to save before it lists tasks', async ({ relaunch }) => {
      const unsaved = contract<{ error: string; tasks: unknown }>(
        'schedule-task-picker',
        'ScriptRunsService.Preview#unsaved',
      );
      expect(unsaved.error).toContain('scriptId is required');
      const { window: page, control } = await relaunch({
        control: [
          ...BASE.filter((s) => s.channel !== IPC.customScriptsList),
          { channel: IPC.customScriptsList, response: { collections: [], scripts: [] } },
        ],
      });
      await openPanel(page);
      await page.locator('[data-testid="automations-add"]').click();
      await page.locator('[data-testid="menu-item-new-script"]').click();
      await dialog(page).locator('[data-testid="script-dialog-tab-schedule"]').click();
      await dialog(page).locator('[data-testid="script-schedule"]').click();
      await dialog(page).locator('[data-testid="schedule-where-task"]').click();
      await expect(dialog(page).locator('[data-testid="schedule-task-save"]')).toBeVisible();
      expect(
        control
          .log()
          .filter((e) => e.channel === IPC.scriptRunsPreview)
          .filter((e) => (e.args as { listTasks?: boolean } | undefined)?.listTasks),
      ).toHaveLength(0);
    });
  },
);
