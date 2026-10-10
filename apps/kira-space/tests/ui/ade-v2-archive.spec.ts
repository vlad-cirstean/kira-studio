import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { emitAgentEvent, openPlan } from './support/adeV2';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';

// Archiving a task: straight when nothing is at risk, else the Claude dialog; archived sessions.

const t = (id: string) => `[data-testid="${id}"]`;

async function openArchive(page: Page): Promise<void> {
  await page
    .locator('[data-testid="ade-card"][data-task-id="T_cart"] [data-testid="ade-card-head"]')
    .click();
  await page.locator(t('ade-panel-archive')).click();
}

function calls(control: { log(): { channel: string; args?: unknown }[] }, channel: string) {
  return control.log().filter((e) => e.channel === channel);
}

const branchRisk = (over: Record<string, unknown> = {}) => ({
  branchId: 'b_cart',
  worktree: '~/wt/web-app/cart',
  dirty: [],
  unmerged: 0,
  blocked: '',
  ...over,
});

const risk = (branches: Record<string, unknown>[]) => ({ taskId: 'T_cart', branches });

const AT_RISK = risk([branchRisk({ dirty: [{ code: 'M', path: 'src/cart.ts' }], unmerged: 2 })]);

test('nothing at risk archives directly', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskArchiveRisk, response: risk([branchRisk()]) },
  ]);
  await openArchive(page);
  await expect.poll(() => calls(control, IPC.adeTaskArchiveTask)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskArchiveTask)[0]?.args).toEqual({ taskId: 'T_cart' });
  await expect(page.locator(t('ade-dialog'))).toHaveCount(0);
});

test('work at risk opens the dialog and Delete anyway archives', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskArchiveRisk, response: AT_RISK },
  ]);
  await openArchive(page);
  await expect(page.locator(t('ade-dialog-title'))).toHaveText('Archive: work would be lost');
  await expect(page.locator(t('ade-dialog-risk'))).toContainText(
    '1 uncommitted, 2 unmerged commits',
  );
  expect(calls(control, IPC.adeTaskArchiveTask)).toHaveLength(0);
  await page.locator(t('ade-dialog-delete')).click();
  await expect.poll(() => calls(control, IPC.adeTaskArchiveTask)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskArchiveTask)[0]?.args).toEqual({ taskId: 'T_cart' });
  await expect(page.locator(t('ade-dialog'))).toBeHidden();
});

test('send then archive re-reads the risk after the turn and reopens when still at risk', async ({
  relaunch,
}) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskArchiveRisk, response: AT_RISK },
  ]);
  await openArchive(page);
  await page.locator(t('ade-dialog-send')).click();
  await expect.poll(() => calls(control, IPC.adeTaskStartBranch)).toHaveLength(1);
  await expect(page.locator(t('ade-dialog'))).toBeHidden();
  expect(calls(control, IPC.adeTaskArchiveRisk)).toHaveLength(1);
  await emitAgentEvent(page, 'term-tk01', 'Stop');
  await expect.poll(() => calls(control, IPC.adeTaskArchiveRisk)).toHaveLength(2);
  await expect(page.locator(t('ade-dialog-title'))).toHaveText('Archive: work would be lost');
  expect(calls(control, IPC.adeTaskArchiveTask)).toHaveLength(0);
});

test('a blocked worktree is an action error, not a dialog', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskArchiveRisk, response: risk([branchRisk({ blocked: 'locked' })]) },
  ]);
  await openArchive(page);
  await expect(page.locator(t('ade-panel-action-error'))).toContainText("Can't archive:");
  await expect(page.locator(t('ade-panel-action-error'))).toContainText('locked');
  await expect(page.locator(t('ade-dialog'))).toHaveCount(0);
  expect(calls(control, IPC.adeTaskArchiveTask)).toHaveLength(0);
});

test('a history row opens the archived panel with its sessions', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await page.locator(t('ade-load-history')).click();
  await expect(page.locator(t('ade-history-row'))).toHaveCount(5);
  await page.locator(t('ade-history-row')).first().click();
  await expect(page.locator(t('ade-panel-title'))).toBeVisible();
  await expect(page.locator(t('ade-sessions-tab'))).toBeVisible();
  await expect(page.locator(t('ade-session-takeover'))).toHaveCount(0);
  await expect(page.locator(t('ade-stopped-takeover'))).toHaveCount(0);
});

// Contract ade-task. Backend half: adeflow TestArchiveRisk. The task and branch ids are the
// fixture's; the worktree path, counts and dirty files are the backend's.
for (const [key, atRisk] of [
  ['clean', false],
  ['at-risk', true],
] as const) {
  test(`contract: archive with ${key} worktree`, async ({ relaunch }) => {
    const backend = contract<{ branches: Record<string, unknown>[] }>(
      'ade-task',
      `AdeTaskService.ArchiveRisk#${key}`,
    );
    const sentArgs = contract<Record<string, unknown>>(
      'ade-task',
      'args:AdeTaskService.ArchiveTask',
    );
    const { window: page, control } = await openPlan(relaunch, [
      {
        channel: IPC.adeTaskArchiveRisk,
        response: risk(backend.branches.map((b) => branchRisk(b))),
      },
    ]);
    await openArchive(page);
    if (atRisk) {
      await expect(page.locator(t('ade-dialog-title'))).toHaveText('Archive: work would be lost');
      await expect(page.locator(t('ade-dialog-risk'))).toContainText(
        '1 uncommitted, 1 unmerged commit',
      );
      await page.locator(t('ade-dialog-delete')).click();
    }
    await expect.poll(() => calls(control, IPC.adeTaskArchiveTask)).toHaveLength(1);
    const sent = calls(control, IPC.adeTaskArchiveTask)[0]?.args as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(Object.keys(sentArgs).sort());
  });
}
