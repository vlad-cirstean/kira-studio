import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { adeBoard, adeFixture, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';

// Stage and start launches, the task's Take over and the `!` targets.

const t = (id: string) => `[data-testid="${id}"]`;
const row = (id: string) => `[data-testid="ade-branch-row"][data-branch-id="${id}"]`;
const taskEl = (id: string) => `[data-testid="ade-task"][data-task-id="${id}"]`;

function calls(control: { log(): { channel: string; args?: unknown }[] }, channel: string) {
  return control.log().filter((e) => e.channel === channel);
}

interface SessionFx {
  id: string;
  branchId: string;
}

/** The sessions snapshot without the given session ids and without any session of `branches`. */
function sessionsWithout(ids: string[], branches: string[] = []) {
  const fx = adeFixture<{ sessions: SessionFx[] }>('sessions');
  return {
    ...fx,
    sessions: fx.sessions.filter((s) => !ids.includes(s.id) && !branches.includes(s.branchId)),
  };
}

async function editedSend(page: Page, text: string): Promise<void> {
  await page.locator(t('ade-dialog-message')).fill(text);
  await page.locator(t('ade-dialog-send')).click();
}

test('▶ <Stage> opens the dialog and an unedited message goes as an empty string', async ({
  relaunch,
}) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskSessions, response: sessionsWithout(['9ab0']) },
  ]);
  await page.locator(`${taskEl('T_auth')} ${t('ade-task-action-stage')}`).click();
  await expect(page.locator(t('ade-dialog'))).toBeVisible();
  await expect(page.locator(t('ade-dialog-message'))).not.toHaveValue('');
  await page.locator(t('ade-dialog-send')).click();
  await expect.poll(() => calls(control, IPC.adeTaskLaunchStage)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskLaunchStage)[0]?.args).toEqual({
    taskId: 'T_auth',
    message: '',
  });
  await expect.poll(() => calls(control, IPC.terminalOpen)).toHaveLength(1);
  await expect(page.locator(t('ade-dialog'))).toBeHidden();
});

test('▶ <Stage> sends an edited message as written', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskSessions, response: sessionsWithout(['9ab0']) },
  ]);
  await page.locator(`${taskEl('T_auth')} ${t('ade-task-action-stage')}`).click();
  await editedSend(page, 'Review only the auth module.');
  await expect.poll(() => calls(control, IPC.adeTaskLaunchStage)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskLaunchStage)[0]?.args).toEqual({
    taskId: 'T_auth',
    message: 'Review only the auth module.',
  });
});

test('▶ Start launches the branch with the default and with an edited message', async ({
  relaunch,
}) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskSessions, response: sessionsWithout([], ['b_authui']) },
  ]);
  await page.locator(row('b_authui')).click();
  await page.locator(t('ade-panel-action-start')).click();
  await page.locator(t('ade-dialog-send')).click();
  await expect.poll(() => calls(control, IPC.adeTaskStartBranch)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskStartBranch)[0]?.args).toEqual({
    branchId: 'b_authui',
    message: '',
  });
  await page.locator(t('ade-panel-action-start')).click();
  await editedSend(page, 'Start with the tests.');
  await expect.poll(() => calls(control, IPC.adeTaskStartBranch)).toHaveLength(2);
  expect(calls(control, IPC.adeTaskStartBranch)[1]?.args).toEqual({
    branchId: 'b_authui',
    message: 'Start with the tests.',
  });
});

function stuckBoard() {
  return adeBoard((b) => {
    for (const task of b.tasks) {
      for (const run of task.runs)
        if (String(run.id).startsWith('r_T_bill_impl_')) run.state = 'stuck';
    }
  });
}

test('a stuck step puts Take over on the task, taken over directly', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: stuckBoard() },
  ]);
  await page.locator(`${taskEl('T_bill')} ${t('ade-task-action-takeOver')}`).click();
  await expect.poll(() => calls(control, IPC.adeTaskTakeOver)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskTakeOver)[0]?.args).toMatchObject({ stopIfRunning: true });
});

test('a double click on Take over launches once', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: stuckBoard() },
  ]);
  await page.locator(`${taskEl('T_bill')} ${t('ade-task-action-takeOver')}`).dblclick();
  await expect.poll(() => calls(control, IPC.adeTaskTakeOver)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskTakeOver)).toHaveLength(1);
});

test('the ! circle on a stuck branch takes the run over', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: stuckBoard() },
  ]);
  await page.locator(`${row('b_bill')} ${t('ade-attention')}`).click();
  await expect.poll(() => calls(control, IPC.adeTaskTakeOver)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskTakeOver)[0]?.args).toMatchObject({ sessionId: 'b1c2' });
});
