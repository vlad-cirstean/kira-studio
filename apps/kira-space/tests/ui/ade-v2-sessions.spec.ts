import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { adeBoard, emitOpenSession, openPlan } from './support/adeV2';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';

// The Sessions tab of a task and of a branch, Take over and the terminal pane.

const t = (id: string) => `[data-testid="${id}"]`;
const row = (id: string) => `[data-testid="ade-branch-row"][data-branch-id="${id}"]`;

function calls(control: { log(): { channel: string; args?: unknown }[] }, channel: string) {
  return control.log().filter((e) => e.channel === channel);
}

async function openSessions(page: Page, taskId: string): Promise<void> {
  await page
    .locator(`[data-testid="ade-card"][data-task-id="${taskId}"] [data-testid="ade-card-head"]`)
    .click();
  await page.locator(t('ade-panel-tab-sessions')).click();
  await expect(page.locator(t('ade-sessions-tab'))).toBeVisible();
}

test('the task strip lists interactive sessions first, then the most recent runs', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch);
  await openSessions(page, 'T_bill');
  const tabs = page.locator(`${t('ade-session-strip')} button`);
  await expect(tabs).toHaveCount(4);
  const ids = await tabs.evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-testid')?.replace('ade-session-tab-', '')),
  );
  expect(ids).toEqual(['tk01', 'b1c2', 'm111', '9d10']);
  const badges = await page.locator(t('ade-session-badge')).allTextContents();
  expect(badges).toEqual(['TUI', 'claude -p', 'claude -p', 'claude -p']);
  await expect(page.locator(t('ade-session-tab-tk01'))).toContainText('(resumed)');
  await expect(page.locator(t('ade-session-tab-tk01'))).toHaveAttribute('data-selected', 'true');
  await expect(page.locator(t('ade-stopped-row'))).toHaveCount(2);
});

test('tabs are named after the stage; the pane shows the full Claude session id with a copy button', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch);
  await openSessions(page, 'T_bill');
  await expect(page.locator(t('ade-session-tab-tk01'))).toContainText('Implement · ');
  await expect(page.locator(t('ade-session-tab-b1c2'))).toContainText('Implement · Implement · ');
  await expect(page.locator(t('ade-session-tab-tk01'))).not.toContainText('claude ');

  await page.evaluate(() => {
    const w = window as unknown as { __clipboard: string[] };
    w.__clipboard = [];
    navigator.clipboard.write = async (items: ClipboardItem[]) => {
      for (const item of items) w.__clipboard.push(await (await item.getType('text/plain')).text());
    };
  });
  await expect(page.locator(t('ade-session-id-text'))).toHaveText('claude-tk01');
  await page.locator(t('ade-session-id-copy')).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __clipboard: string[] }).__clipboard))
    .toEqual(['claude-tk01']);
});

test('a branch scope shows only that branch', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await page.locator(row('b_billdash')).click();
  await page.locator(t('ade-panel-tab-sessions')).click();
  const tabs = page.locator(`${t('ade-session-strip')} button`);
  await expect(tabs).toHaveCount(2);
  await expect(page.locator(t('ade-session-tab-9d10'))).toBeVisible();
  await expect(page.locator(t('ade-session-tab-tk01'))).toBeVisible();
});

test('a headless run shows its status bar and log, and Stop sends the run id', async ({
  relaunch,
}) => {
  const { window: page, control } = await openPlan(relaunch);
  await openSessions(page, 'T_bill');
  await page.locator(t('ade-session-tab-b1c2')).click();
  await expect(page.locator(t('ade-headless-label'))).toContainText('headless run · step');
  await expect(page.locator(t('ade-run-log-line')).first()).toBeVisible();
  await page.locator(t('ade-session-stop')).click();
  await expect.poll(() => calls(control, IPC.adeTaskStopRun)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskStopRun)[0]?.args).toEqual({ runId: 'r_T_bill_impl_b_bill' });
});

test('Take over of a running run confirms, stops it and selects the resumed session', async ({
  relaunch,
}) => {
  const { window: page, control } = await openPlan(relaunch);
  await openSessions(page, 'T_bill');
  await page.locator(t('ade-session-tab-9d10')).click();
  await page.locator(t('ade-session-takeover')).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Take over a running run?');
  await expect(dialog).toContainText(
    'is still running on feat/billing-dashboard. Taking over stops it first; it becomes stuck and continues in Claude Code.',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(calls(control, IPC.adeTaskTakeOver)).toHaveLength(0);
  await page.locator(t('ade-session-takeover')).click();
  await page.getByRole('button', { name: 'Stop and take over' }).click();
  await expect.poll(() => calls(control, IPC.adeTaskTakeOver)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskTakeOver)[0]?.args).toEqual({
    sessionId: '9d10',
    stopIfRunning: true,
  });
  await expect(page.locator(t('ade-session-tab-tk01'))).toHaveAttribute('data-selected', 'true');
});

test('Take over of a stuck run skips the confirm', async ({ relaunch }) => {
  const board = adeBoard((b) => {
    for (const task of b.tasks) {
      for (const run of task.runs) if (run.id === 'r_T_bill_impl_b_bill') run.state = 'stuck';
    }
  });
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: board },
  ]);
  await openSessions(page, 'T_bill');
  await page.locator(t('ade-session-tab-b1c2')).click();
  await expect(page.locator(t('ade-session-stop'))).toHaveCount(0);
  await page.locator(t('ade-session-takeover')).click();
  await expect.poll(() => calls(control, IPC.adeTaskTakeOver)).toHaveLength(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a stopped session takes over from the list', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await openSessions(page, 'T_bill');
  await page.locator(t('ade-stopped-takeover')).last().click();
  await expect.poll(() => calls(control, IPC.adeTaskTakeOver)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskTakeOver)[0]?.args).toMatchObject({ sessionId: 'sp11' });
});

test('contract: an open-session event selects that session in its Sessions tab', async ({
  relaunch,
}) => {
  const open = contract<{ taskId: string; branchId: string; sessionId: string }>(
    'notify-reveal',
    'event:kira:adetask:open-session',
  );
  expect(Object.keys(open).sort()).toEqual(['branchId', 'sessionId', 'taskId']);
  const { window: page } = await openPlan(relaunch);
  await emitOpenSession(page, {
    ...open,
    taskId: 'T_bill',
    branchId: 'b_meter',
    sessionId: 'm111',
  });
  await expect(page.locator(t('ade-session-tab-m111'))).toHaveAttribute('data-selected', 'true');
});

test('Show focuses the window holding the terminal, or says none does', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskFocusSession, response: false },
  ]);
  await openSessions(page, 'T_bill');
  await page.locator(t('ade-tui-show')).click();
  await expect.poll(() => calls(control, IPC.adeTaskFocusSession)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskFocusSession)[0]?.args).toMatchObject({ sessionId: 'tk01' });
  await expect(page.locator(t('ade-tui-missing'))).toHaveText(
    "This session's terminal is not open in any window.",
  );
});
