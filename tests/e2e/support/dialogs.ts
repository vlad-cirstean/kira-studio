import { expect, type Page } from '@playwright/test';

// ConfirmDialog.vue's replacement for window.confirm() (see state/confirmDialog.ts) — an ordinary
// Teleported HTML dialog rather than a native OS panel, so it's just another locator to click
// instead of a page.on('dialog') handler racing Electron's own (unreliable, CDP-invisible) native
// dialog manager.
export async function acceptConfirm(page: Page): Promise<void> {
  const dialog = page.locator('[data-testid="confirm-dialog"]');
  await expect(dialog).toBeVisible();
  await page.click('[data-testid="confirm-dialog-confirm"]');
  await expect(dialog).toHaveCount(0);
}

export async function cancelConfirm(page: Page): Promise<void> {
  const dialog = page.locator('[data-testid="confirm-dialog"]');
  await expect(dialog).toBeVisible();
  await page.click('[data-testid="confirm-dialog-cancel"]');
  await expect(dialog).toHaveCount(0);
}
