import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openCommitDetail } from './support/gitUiPortFixtures';

// P264: the git detail pane and the commit grid columns resize through the one ResizeHandle: pointer
// drag, arrow steps, Home and End, with the size on aria-valuenow.

const now = async (handle: Locator): Promise<number> =>
  Number(await handle.getAttribute('aria-valuenow'));

async function dragBy(page: Page, handle: Locator, dx: number): Promise<void> {
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y);
  await page.mouse.up();
}

test('detail pane — drag, arrows, Home and End resize within bounds', async ({ relaunch }) => {
  const page = await openCommitDetail(relaunch);
  const handle = page.getByRole('separator', { name: 'Resize detail pane', exact: true });
  await expect(handle).toBeVisible();
  const start = await now(handle);
  const min = Number(await handle.getAttribute('aria-valuemin'));
  const max = Number(await handle.getAttribute('aria-valuemax'));

  // The pane sits on the right: dragging the handle left widens it.
  await dragBy(page, handle, -60);
  await expect.poll(() => now(handle)).toBeGreaterThan(start + 40);
  const dragged = await now(handle);

  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => now(handle)).toBeLessThan(dragged);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => now(handle)).toBe(dragged);

  await page.keyboard.press('Home');
  await expect.poll(() => now(handle)).toBe(min);
  await page.keyboard.press('End');
  await expect.poll(() => now(handle)).toBe(max);
});

test('commit grid columns — drag and arrows resize the graph column, Home hits the minimum', async ({
  relaunch,
}) => {
  const page = await openCommitDetail(relaunch);
  const handle = page.getByRole('separator', { name: 'Resize graph column', exact: true });
  await expect(handle).toBeVisible();
  const start = await now(handle);
  const min = Number(await handle.getAttribute('aria-valuemin'));

  await dragBy(page, handle, 30);
  await expect.poll(() => now(handle)).toBeGreaterThan(start);
  const dragged = await now(handle);

  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => now(handle)).toBeLessThan(dragged);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => now(handle)).toBe(dragged);

  await page.keyboard.press('Home');
  await expect.poll(() => now(handle)).toBe(min);
});
