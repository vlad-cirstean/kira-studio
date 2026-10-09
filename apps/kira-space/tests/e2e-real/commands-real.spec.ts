import { expect, test } from './fixtures';

interface Library {
  collections: { id: string; name: string }[];
  scripts: { id: string; name: string; command: string; collectionId: string | null }[];
}

test('a collection and a script moved into it survive a reload', async ({ kira }) => {
  const page = kira.window;
  await page.locator('[data-testid="mode-tab"][data-mode="automations"]').click();
  await expect(page.locator('[data-testid="automations-panel"]')).toBeVisible();

  await page.locator('[data-testid="automations-new-collection"]').click();
  await page.locator('[data-testid="script-collection-rename-input"]').fill('Builds');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="script-group"][data-name="Builds"]')).toBeVisible();

  await page.locator('[data-testid="automations-add"]').click();

  await page.locator('[data-testid="menu-item-new-script"]').click();
  const dialog = page.locator('[data-testid="script-dialog"]');
  await dialog.locator('[data-testid="script-dialog-name"]').fill('Build all');
  await dialog.locator('[data-testid="script-dialog-command"]').fill('echo one');
  await dialog.locator('[data-testid="script-dialog-save"]').click();
  await expect(dialog).toHaveCount(0);

  const row = page.locator('button[data-testid^="script-"]', { hasText: 'Build all' });
  await row.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to collection' }).click();
  await page.getByRole('menuitem', { name: 'Builds' }).click();

  const stored = async () => kira.call<Library>('CustomScriptsService', 'List');
  await expect
    .poll(async () => {
      const lib = await stored();
      const col = lib.collections.find((c) => c.name === 'Builds');
      return lib.scripts.find((x) => x.name === 'Build all')?.collectionId === col?.id;
    })
    .toBe(true);

  await kira.reload();
  await page.locator('[data-testid="mode-tab"][data-mode="automations"]').click();
  const group = page.locator('[data-testid="script-group"][data-name="Builds"]');
  await expect(group).toBeVisible();
  await expect(group).toContainText('1');
  await expect(
    page.locator('button[data-testid^="script-"]', { hasText: 'Build all' }).first(),
  ).toBeVisible();
});
