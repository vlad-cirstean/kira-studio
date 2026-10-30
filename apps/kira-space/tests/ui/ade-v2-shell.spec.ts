import { expect, test } from './fixtures';
import { adeFixture, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';

// The ADE tab bar: no bottom delimiter, capture box and Add centred.

test('the tab bar has no bottom delimiter', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  const bar = page.locator('[data-testid="ade-shell-bar"]');
  expect(await bar.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe('0px');
  const barBox = await bar.boundingBox();
  const planBox = await page.locator('[data-testid="ade-plan"]').boundingBox();
  expect((barBox?.y ?? 0) + (barBox?.height ?? 0)).toBeLessThanOrEqual(planBox?.y ?? 0);
  expect((planBox?.y ?? 0) - ((barBox?.y ?? 0) + (barBox?.height ?? 0))).toBeLessThanOrEqual(1);
});

test('capture box and Add sit in the middle of the tab bar', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskCaptureTask, response: adeFixture('task') },
  ]);
  const box = async (id: string) => {
    const b = await page.locator(`[data-testid="${id}"]`).boundingBox();
    if (!b) throw new Error(`no box for ${id}`);
    return b;
  };
  const bar = await box('ade-shell-bar');
  const capture = await box('ade-capture');
  const add = await box('ade-add');
  const groupCentre = (capture.x + add.x + add.width) / 2;
  expect(Math.abs(groupCentre - (bar.x + bar.width / 2))).toBeLessThanOrEqual(1);
  const barMid = bar.y + bar.height / 2;
  expect(Math.abs(capture.y + capture.height / 2 - barMid)).toBeLessThanOrEqual(1);
  expect(Math.abs(add.y + add.height / 2 - barMid)).toBeLessThanOrEqual(1);

  const input = page.locator('[data-testid="ade-capture"]');
  await input.fill('Rate limit exports');
  await input.press('Enter');
  await expect(page.locator('[data-testid="ade-capture-note"]')).toBeVisible();
  expect((await box('ade-capture')).x).toBe(capture.x);
  expect((await box('ade-add')).x).toBe(add.x);
});
