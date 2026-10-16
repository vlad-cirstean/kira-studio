import { expect, type Page } from '@playwright/test';
import { settleFrames } from './tree';

// Same race openRowMenu() guards against, but against the tab strip's own scroll.
export async function closeAllTabs(page: Page): Promise<void> {
  const firstTab = page.locator('[data-testid="tab"]').first();
  await firstTab.scrollIntoViewIfNeeded();
  await settleFrames(page);
  await firstTab.click({ button: 'right' });
  await page.click('[data-testid="menu-item-close-all"]');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(0);
}

export function tabLocator(page: import('@playwright/test').Page, tabId: string) {
  return page.locator(`[data-testid="tab"][data-tab-id="${tabId}"]`);
}

export async function dragTab(
  page: import('@playwright/test').Page,
  source: import('@playwright/test').Locator,
  target: import('@playwright/test').Locator,
): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('dragTab: chip has no box');
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  // Aim past the target's midpoint in the drag direction so Sortable's swap threshold is met.
  const tx = to.x + to.width * (to.x < from.x ? 0.25 : 0.75);
  const ty = to.y + to.height / 2;
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(fx + 10, fy, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 15 });
  await page.mouse.move(tx, ty, { steps: 2 });
  // Sortable's fallback mode emulates dragover on a 50ms interval, one swap per tick.
  await page.waitForTimeout(300);
  await page.mouse.up();
}
