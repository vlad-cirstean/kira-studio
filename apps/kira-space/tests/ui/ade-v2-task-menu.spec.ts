import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';

// The task context menu: right-click, Shift+F10 and the panel's More button.

const t = (id: string) => `[data-testid="${id}"]`;
const card = (id: string) => `[data-testid="ade-card"][data-task-id="${id}"]`;
const item = (id: string) => t(`menu-item-${id}`);

function calls(control: { log(): { channel: string; args?: unknown }[] }, channel: string) {
  return control.log().filter((e) => e.channel === channel);
}

async function menuIds(page: Page): Promise<string[]> {
  return page
    .locator(`${t('context-menu')} [data-testid^="menu-item-"]`)
    .evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').slice(10)));
}

test('right-click moves the task to another stage', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await page.locator(card('T_alerts')).click({ button: 'right', position: { x: 60, y: 30 } });
  await expect(page.locator(t('ade-panel'))).toBeVisible();
  await page.locator(item('ade-task-stage')).click();
  await expect(page.locator(item('ade-task-stage-spec'))).toBeVisible();
  await page.locator(item('ade-task-stage-review')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSetTaskStage)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskSetTaskStage)[0]?.args).toEqual({
    taskId: 'T_alerts',
    stageId: 'review',
  });
});

test('Mark as not merging, Copy task id and Archive call their backends', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await page.evaluate(() => {
    const w = window as unknown as { __clipboard: string[] };
    w.__clipboard = [];
    navigator.clipboard.write = async (items: ClipboardItem[]) => {
      for (const it of items) w.__clipboard.push(await (await it.getType('text/plain')).text());
    };
  });
  const open = () =>
    page.locator(card('T_alerts')).click({ button: 'right', position: { x: 60, y: 30 } });

  await open();
  await page.locator(item('ade-task-park')).click();
  await expect.poll(() => calls(control, IPC.adeTaskUpdateTask)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskUpdateTask)[0]?.args).toMatchObject({
    taskId: 'T_alerts',
    patch: { kind: 'parked' },
  });

  await open();
  await page.locator(item('ade-task-copy')).click();
  await page.locator(item('ade-task-copy-id')).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __clipboard: string[] }).__clipboard))
    .toEqual(['T_alerts']);

  await open();
  await page.locator(item('ade-task-archive')).click();
  await expect.poll(() => calls(control, IPC.adeTaskArchiveRisk)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskArchiveRisk)[0]?.args).toEqual({ taskId: 'T_alerts' });
});

test('a review item gets the reduced set', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await page.locator(t('ade-load-all')).click();
  await page.locator(card('R_sara')).scrollIntoViewIfNeeded();
  await page
    .locator(`[data-testid="ade-task"][data-task-id="R_sara"] ${t('ade-task-cells')} > *`)
    .first()
    .click({ button: 'right' });
  await expect(page.locator(t('context-menu'))).toBeVisible();
  const ids = await menuIds(page);
  expect(ids).toContain('ade-task-sessions');
  expect(ids).toContain('ade-task-archive');
  expect(ids).not.toContain('ade-task-stage');
  expect(ids).not.toContain('ade-task-park');
  expect(ids).not.toContain('ade-task-plan');
});

test('Shift+F10 on the card head and the panel More button open it', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await page.locator(`${card('T_bill')} ${t('ade-card-head')}`).focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator(item('ade-task-sessions'))).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(t('context-menu'))).toHaveCount(0);

  await page.locator(t('ade-panel-more')).click();
  await expect(page.locator(item('ade-task-sessions'))).toBeVisible();
});
