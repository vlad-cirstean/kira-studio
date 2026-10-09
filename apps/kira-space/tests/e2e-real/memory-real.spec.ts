import { expect, test } from './fixtures';
import { acceptingGate, GATED_FACT } from './support/memoryGate';

test('a memory added through the gate is listed and found by search', async ({ kira }) => {
  await acceptingGate(kira);
  const page = kira.window;
  await page.locator('[data-testid="mode-tab"][data-mode="memory"]').click();
  await expect(page.locator('[data-testid="memory-panel"]')).toBeVisible();

  await page.locator('[data-testid="memory-add"]').click();
  const dialog = page.locator('[data-testid="add-memory-dialog"]');
  await dialog.locator('[data-testid="add-memory-text"]').fill('billing runs postgres 16');
  await dialog.locator('[data-testid="add-memory-submit"]').click();
  await expect(dialog.locator('[data-testid="add-memory-outcome-0"]')).toHaveText('Added');
  await dialog.locator('[data-testid="add-memory-done"]').click();

  const rows = page.locator('[data-testid^="memory-row-"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(GATED_FACT);

  await page.locator('[data-testid="memory-search"]').fill('postgres');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(GATED_FACT);
  await page.locator('[data-testid="memory-search"]').fill('zzzunrelated');
  await expect(rows).toHaveCount(0);
});
