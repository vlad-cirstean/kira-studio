import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function openMemory(page: Page): Promise<void> {
  await page.locator('[data-testid="mode-tab"][data-mode="memory"]').click();
  await expect(page.locator('[data-testid="memory-panel"]')).toBeVisible();
}
