import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { adeBoard, openPlan, openTask } from './support/adeV2';
import { contract } from './support/contract';
import { calls } from './support/ipcCalls';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// Customizable task statuses and manual moves. Backend half: adeflow TestTaskStatuses.

const t = (id: string) => `[data-testid="${id}"]`;
const card = (id: string) => `[data-testid="ade-card"][data-task-id="${id}"]`;
const item = (id: string) => t(`menu-item-${id}`);

interface StatusDef {
  id: string;
  name: string;
  tone: string;
  category: string;
}
interface Saved {
  statuses: StatusDef[];
}
interface SaveArgs extends Saved {
  reassign: Record<string, string>;
}

async function openPane(page: Page): Promise<void> {
  await emitWailsEvent(page, IPC.openSettings, undefined);
  await page.locator(t('settings-section-Task statuses')).click();
  await expect(page.locator(t('ade-status-list'))).toBeVisible();
}

test('contract: the menu Status submenu sends the backend patch', async ({ relaunch }) => {
  const args = contract<{ patch: unknown }>('ade-task-statuses', 'args:AdeTaskService.UpdateTask');
  const { window: page, control } = await openPlan(relaunch);
  await page.locator(card('T_alerts')).click({ button: 'right', position: { x: 60, y: 30 } });
  await page.locator(item('ade-task-status')).click();
  await page.locator(item('ade-task-status-in-review')).click();
  await expect.poll(() => calls(control, IPC.adeTaskUpdateTask)).toHaveLength(1);
  const sent = calls(control, IPC.adeTaskUpdateTask)[0]?.args as { taskId: string; patch: unknown };
  expect(sent.taskId).toBe('T_alerts');
  expect(sent.patch).toEqual(args.patch);
});

test('contract: the saved set renders its renamed and added statuses', async ({ relaunch }) => {
  const saved = contract<Saved>('ade-task-statuses', 'AdeTaskService.SaveStatuses#saved');
  const { window: page } = await openPlan(relaunch, [
    {
      channel: IPC.adeTaskBoard,
      response: adeBoard((b) => {
        b.statuses = saved.statuses;
        const tk = b.tasks.find((x) => x.id === 'T_alerts');
        if (!tk) throw new Error('fixture task missing');
        tk.statusId = 'qa';
      }),
    },
  ]);
  await openTask(page, 'T_alerts');
  await expect(page.locator(t('ade-status-pick'))).toContainText('QA');
  await page.locator(t('ade-status-pick')).click();
  await expect(page.locator(t('ade-status-option-in-review'))).toContainText('Code review');
});

test('the panel moves a task back and forth, by arrows and by picker', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await openTask(page, 'T_alerts');
  await expect(page.locator(t('ade-status-pick'))).toContainText('In progress');
  const sent = () =>
    calls(control, IPC.adeTaskUpdateTask).map(
      (c) => (c.args as { patch: { statusId: string } }).patch.statusId,
    );

  await page.locator(t('ade-status-next')).click();
  await expect.poll(sent).toEqual(['in-review']);
  await expect(page.locator(t('ade-task-status-why'))).toBeVisible();
  await page.locator(t('ade-status-back')).click();
  await expect.poll(sent).toHaveLength(2);
  await page.locator(t('ade-status-pick')).click();
  await page.locator(t('ade-status-option-done')).click();
  await expect.poll(sent).toHaveLength(3);
  expect(sent()[2]).toBe('done');
});

test('back is off on the first status', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await page.locator(t('ade-load-all')).click();
  await page.locator(card('T_csv')).scrollIntoViewIfNeeded();
  await openTask(page, 'T_csv');
  await expect(page.locator(t('ade-status-pick'))).toContainText('To do');
  await expect(page.locator(t('ade-status-back'))).toBeDisabled();
});

test('a stuck task shows Blocked beside its status', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await openTask(page, 'T_cart');
  await expect(page.locator(t('ade-status-pick'))).toContainText('In review');
  await expect(page.locator(t('ade-task-blocked'))).toBeVisible();
});

test('the pane adds, renames and recolours a status', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await openPane(page);
  await expect(page.locator(t('ade-status-row'))).toHaveCount(4);

  await page.locator(t('ade-status-add')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveStatuses)).toHaveLength(1);
  const added = calls(control, IPC.adeTaskSaveStatuses)[0]?.args as SaveArgs;
  expect(added.statuses).toHaveLength(5);
  expect(added.statuses[4]).toEqual({
    id: '',
    name: 'New status',
    tone: 'grey',
    category: 'active',
  });

  const first = page.locator(`${t('ade-status-row')}[data-status-id="in-progress"]`);
  await first.locator(t('ade-status-name')).fill('Working');
  await first.locator(t('ade-status-name')).press('Enter');
  await expect.poll(() => calls(control, IPC.adeTaskSaveStatuses)).toHaveLength(2);
  const renamed = calls(control, IPC.adeTaskSaveStatuses)[1]?.args as SaveArgs;
  expect(renamed.statuses.map((s) => s.name)).toEqual(['To do', 'Working', 'In review', 'Done']);

  await first.locator(t('ade-status-tone')).click();
  await page.locator(t('ade-status-tone-purple')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveStatuses)).toHaveLength(3);
  const toned = calls(control, IPC.adeTaskSaveStatuses)[2]?.args as SaveArgs;
  expect(toned.statuses[1]?.tone).toBe('purple');
});

test('the pane reorders with the keyboard', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await openPane(page);
  await page
    .locator(`${t('ade-status-row')}[data-status-id="in-review"] ${t('ade-status-handle')}`)
    .focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => calls(control, IPC.adeTaskSaveStatuses)).toHaveLength(1);
  const sent = calls(control, IPC.adeTaskSaveStatuses)[0]?.args as SaveArgs;
  expect(sent.statuses.map((s) => s.id)).toEqual(['todo', 'in-review', 'in-progress', 'done']);
});

test('contract: deleting a status in use asks where its tasks go', async ({ relaunch }) => {
  const args = contract<SaveArgs>('ade-task-statuses', 'args:AdeTaskService.SaveStatuses');
  const saved = contract<Saved>('ade-task-statuses', 'AdeTaskService.SaveStatuses#saved');
  const qa = saved.statuses.find((s) => s.id === 'qa');
  if (!qa) throw new Error('contract set has no qa');
  const { window: page, control } = await openPlan(relaunch, [
    {
      channel: IPC.adeTaskBoard,
      response: adeBoard((b) => {
        b.statuses = [
          { id: 'todo', name: 'To do', tone: 'grey', category: 'todo' },
          { id: 'in-progress', name: 'In progress', tone: 'amber', category: 'active' },
          qa,
          { id: 'in-review', name: 'Code review', tone: 'blue', category: 'review' },
          { id: 'done', name: 'Done', tone: 'green', category: 'done' },
        ];
      }),
    },
  ]);
  await openPane(page);
  await page
    .locator(`${t('ade-status-row')}[data-status-id="in-progress"] ${t('ade-status-delete')}`)
    .click();
  await expect(page.locator(t('ade-status-delete-dialog'))).toBeVisible();
  await expect(page.locator(t('ade-status-reassign'))).toHaveValue('qa');
  await page.locator(t('ade-status-delete-confirm')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveStatuses)).toHaveLength(1);
  const sent = calls(control, IPC.adeTaskSaveStatuses)[0]?.args as SaveArgs;
  expect(sent.reassign).toEqual(args.reassign);
  expect(sent.statuses).toEqual(saved.statuses);
});

test('the last status of a category cannot be deleted', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await openPane(page);
  for (const id of ['todo', 'in-progress', 'in-review', 'done']) {
    await expect(
      page.locator(`${t('ade-status-row')}[data-status-id="${id}"] ${t('ade-status-delete')}`),
    ).toBeDisabled();
  }
});

test('the step inspector lists the set and opens the pane', async ({ relaunch }) => {
  const saved = contract<Saved>('ade-task-statuses', 'AdeTaskService.SaveStatuses#saved');
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: adeBoard((b) => (b.statuses = saved.statuses)) },
  ]);
  await page.locator(t('ade-tab-workflows')).click();
  await page.locator(t('ade-workflows')).waitFor();
  await page.locator(t('ade-wf-row')).first().click();
  await page.locator(t('ade-wf-node')).first().click();
  const toggle = page.locator(t('ade-wf-step-advanced'));
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const select = page.locator(t('ade-wf-step-status'));
  const options = await select.locator('option').allTextContents();
  expect(options.some((o) => o.includes('QA'))).toBe(true);
  await page.locator(t('ade-step-edit-statuses')).click();
  await expect(page.locator(t('ade-status-list'))).toBeVisible();
});
