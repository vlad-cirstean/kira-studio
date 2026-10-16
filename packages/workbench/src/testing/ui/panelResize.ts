import { expect, type Locator, type Page } from '@playwright/test';

export async function center(handle: Locator): Promise<{ x: number; y: number }> {
  const box = await handle.boundingBox();
  if (!box) throw new Error('handle has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function expectIdle(page: Page, handle: Locator): Promise<void> {
  await expect(handle).not.toHaveAttribute('data-state', 'drag');
  await expect(page.locator('[data-testid="main-panel"]')).not.toHaveCSS('pointer-events', 'none');
}

export async function openDock(page: Page): Promise<void> {
  await page.click('[data-testid="toggle-operations-panel"]');
  await expect(page.locator('[data-testid="operations-panel"]')).toBeVisible();
}
