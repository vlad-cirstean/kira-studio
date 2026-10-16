import { expect, test } from './fixtures';
import { openDocker, setupDocker } from './support/dockerFixture';

test('container list: arrows, Home/End, Left/Right on a compose group, Enter opens, Shift+F10 menu returns focus', async ({
  relaunch,
}) => {
  const { page } = await setupDocker(relaunch);
  await openDocker(page);

  const group = page.locator('[data-testid="docker-group"]');
  const rows = page.locator('[data-testid="docker-row"]');
  await group.focus();
  await expect(group).toBeFocused();

  await page.keyboard.press('ArrowLeft');
  await expect(rows).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect(rows).toHaveCount(4);

  await page.keyboard.press('ArrowDown');
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(group).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="docker-container-detail"]')).toBeVisible();

  const solo = page.locator('[data-testid="docker-row"][data-name="solo"]');
  await solo.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.locator('[data-testid="context-menu"]');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(solo).toBeFocused();
});

test('image, network and volume lists: arrows and Home/End move focus, Enter selects', async ({
  relaunch,
}) => {
  const { page } = await setupDocker(relaunch);
  await openDocker(page);

  for (const [tab, list, count] of [
    ['images', 'docker-image-list', 2],
    ['networks', 'docker-network-list', 1],
    ['volumes', 'docker-volume-list', 1],
  ] as const) {
    await page.locator(`[data-testid="docker-section-${tab}"]`).click();
    const rows = page.locator(`[data-testid="${list}"] [data-testid="docker-row"]`);
    await expect(rows).toHaveCount(count);
    await rows.first().focus();
    if (count > 1) {
      await page.keyboard.press('ArrowDown');
      await expect(rows.nth(1)).toBeFocused();
      await page.keyboard.press('Home');
      await expect(rows.first()).toBeFocused();
      await page.keyboard.press('End');
      await expect(rows.last()).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await expect(rows.last()).toHaveAttribute('aria-selected', 'true');
  }
});

test('overview container table: arrows, Home/End and Enter open the container', async ({
  relaunch,
}) => {
  const { page } = await setupDocker(relaunch);
  await openDocker(page);

  const rows = page.locator('[data-testid="docker-table-row"]');
  await expect(rows).toHaveCount(4);
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await expect(page.locator('[data-testid="docker-table-row"][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('End');
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(rows.first()).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="docker-container-detail"]')).toBeVisible();
});
